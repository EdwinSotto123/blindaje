import { duration, shortDateTime } from "@/lib/format";
import type { EvidenceType, VictimReport } from "@/shared";
import type { QueueItem } from "@/sync/queue";

/**
 * Filas de "Lo que recibiste": une lo que ya está en la nube (reporte del servidor) con lo que
 * todavía espera en la cola del celular. Cada fila dice con claridad dónde está.
 */
export type RowState = "nube" | "procesando" | "subiendo" | "pendiente" | "error";

export type NoteRow = {
  key: string;
  tipo: EvidenceType;
  title: string;
  subtitle: string;
  when: string;
  state: RowState;
  evidenceId: string | null;
  queueId: string | null;
  sortAt: number;
};

export function titleFor(tipo: EvidenceType, durationMs: number | null, source?: string | null): string {
  switch (tipo) {
    case "audio":
      if (source === "llamada") return durationMs ? `Grabación de llamada de ${duration(durationMs)}` : "Grabación de llamada";
      return durationMs ? `Audio de ${duration(durationMs)}` : "Audio";
    case "video":
      return durationMs ? `Video de ${duration(durationMs)}` : "Video";
    case "imagen":
      return source === "camara" ? "Foto" : "Imagen";
    case "texto":
      return source === "llamada" ? "Llamada" : "Mensaje de texto";
  }
}

function quote(text: string, max = 48): string {
  const t = text.replace(/\s+/g, " ").trim();
  return `“${t.length > max ? `${t.slice(0, max).trimEnd()}…` : t}”`;
}

export const STATE_LABEL: Record<RowState, string> = {
  nube: "Guardado en la nube",
  procesando: "Revisando…",
  subiendo: "Subiendo…",
  pendiente: "Esperando conexión",
  error: "No se pudo subir. Toca para reintentar",
};

export function buildRows(report: VictimReport | null, queue: QueueItem[], now = new Date()): NoteRow[] {
  const rows: NoteRow[] = [];
  const serverIds = new Set<string>();
  for (const e of report?.evidencia ?? []) {
    serverIds.add(e.id);
    const done = e.status === "procesado";
    let subtitle = done ? STATE_LABEL.nube : STATE_LABEL.procesando;
    if (done) {
      if (e.tipo === "audio" || e.tipo === "video") subtitle = e.transcripcion?.length ? "Transcrito" : STATE_LABEL.nube;
      if (e.tipo === "texto" && e.transcripcion?.[0]?.text) subtitle = quote(e.transcripcion[0].text);
      if (e.tipo === "imagen" && e.nota) subtitle = e.nota;
    }
    const at = e.captured_at ?? e.received_utc;
    rows.push({
      key: `s:${e.id}`,
      tipo: e.tipo,
      title: titleFor(e.tipo, e.duration_ms, e.origen),
      subtitle,
      when: shortDateTime(at, now),
      state: done ? "nube" : "procesando",
      evidenceId: e.id,
      queueId: null,
      sortAt: new Date(at).getTime(),
    });
  }
  for (const q of queue) {
    if (q.status === "retenido") continue;
    if (q.evidence_id && serverIds.has(q.evidence_id)) continue;
    const state: RowState =
      q.status === "subido" ? "procesando" : q.status === "subiendo" ? "subiendo" : q.status === "error" ? "error" : "pendiente";
    const at = q.captured_at ?? new Date(q.created_at).toISOString();
    rows.push({
      key: `q:${q.id}`,
      tipo: q.tipo,
      title: titleFor(q.tipo, q.duration_ms, q.source),
      subtitle: q.tipo === "texto" && q.preview && state === "pendiente" ? `${quote(q.preview, 30)} · ${STATE_LABEL.pendiente}` : STATE_LABEL[state],
      when: shortDateTime(at, now),
      state,
      evidenceId: q.evidence_id,
      queueId: q.id,
      sortAt: new Date(at).getTime(),
    });
  }
  return rows.sort((a, b) => b.sortAt - a.sortAt);
}

/** Estado general para el chip de arriba. */
export type Safety = { kind: "nube" | "esperando" | "subiendo" | "vacio"; pending: number };

export function overallSafety(queue: QueueItem[], online: boolean, hasServerItems: boolean): Safety {
  const pending = queue.filter((q) => q.status === "pendiente" || q.status === "subiendo" || q.status === "error").length;
  if (pending > 0) return { kind: online && queue.some((q) => q.status === "subiendo") ? "subiendo" : "esperando", pending };
  if (hasServerItems || queue.some((q) => q.status === "subido")) return { kind: "nube", pending: 0 };
  return { kind: "vacio", pending: 0 };
}

export function safetyLabel(s: Safety): string {
  switch (s.kind) {
    case "nube":
    case "vacio":
      return "Guardado cifrado, fuera de este celular";
    case "subiendo":
      return "Subiendo, cifrado…";
    case "esperando":
      return s.pending === 1 ? "1 nota espera conexión" : `${s.pending} notas esperan conexión`;
  }
}
