import type { VictimReport } from "@blindaje/shared";
import type { Env } from "../env";
import { parseJsonColumn } from "../lib/db";
import { nowIso } from "../lib/ids";
import { readEvidenceText } from "./text";
import type { FramesContent, LecturaContent, RedactadaContent, SegmentacionContent, TranscripcionContent } from "./types";

/**
 * Complementos del reporte de la víctima (todo de SU caso, nada de otros):
 *  - el texto de los mensajes pegados y del relato como un solo turno en `transcripcion`, para que
 *    la app lo muestre sin guardarlo en el celular;
 *  - "Lo que encontramos" en vivo: hallazgos de cada evidencia procesada, antes de la ficha.
 */

interface DerivativeRow {
  evidence_id: string;
  tipo: string;
  content_json: string | null;
}

function liveFindings(report: VictimReport, ders: DerivativeRow[]): string[] {
  const out: string[] = [];
  const label = new Map(report.evidencia.map((e) => [e.id, e.label]));
  const audios = new Set(ders.filter((d) => d.tipo === "transcripcion").map((d) => d.evidence_id));
  if (audios.size) out.push(audios.size === 1 ? "Transcribimos 1 audio" : `Transcribimos ${audios.size} audios`);
  for (const d of ders) {
    const l = label.get(d.evidence_id);
    if (!l) continue;
    if (d.tipo === "transcripcion" && parseJsonColumn<TranscripcionContent>(d.content_json)?.turns.some((t) => t.es_victima)) {
      out.push(`En ${l} separamos tu voz de la de quien te habla`);
    } else if (d.tipo === "segmentacion") {
      const objs = [...new Set((parseJsonColumn<SegmentacionContent>(d.content_json)?.objetos ?? []).map((o) => o.concepto))].filter(
        (c) => c !== "rostro" && c !== "niño",
      );
      if (objs.length) out.push(`En ${l} encontramos: ${objs.join(", ")}`);
    } else if (d.tipo === "redactada" && (parseJsonColumn<RedactadaContent>(d.content_json)?.regiones ?? 0) > 0) {
      out.push(`En ${l} tapamos rostros antes de compartir`);
    } else if (d.tipo === "lectura") {
      const lec = parseJsonColumn<LecturaContent>(d.content_json);
      if (lec?.texto) out.push(`La nota de ${l} dice: «${lec.texto}»`);
      for (const p of lec?.placas ?? []) out.push(`Placa leída en ${l}: ${p}`);
    } else if (d.tipo === "frames" && parseJsonColumn<FramesContent>(d.content_json)?.placa) {
      out.push(`En ${l} encontramos una placa de vehículo`);
    }
  }
  return out;
}

export async function enrichVictimReport(env: Env, report: VictimReport): Promise<VictimReport> {
  const [{ results: ders }, { results: texts }] = await Promise.all([
    env.DB.prepare("SELECT evidence_id, tipo, content_json FROM derivatives WHERE case_id = ? AND tipo IN ('transcripcion','segmentacion','redactada','lectura','frames')")
      .bind(report.case_id)
      .all<DerivativeRow>(),
    env.DB.prepare("SELECT id, r2_key FROM evidence WHERE case_id = ? AND tipo = 'texto'").bind(report.case_id).all<{ id: string; r2_key: string }>(),
  ]);
  const evidencia = await Promise.all(
    report.evidencia.map(async (e) => {
      if (e.tipo !== "texto" || e.transcripcion) return e;
      const row = texts.find((t) => t.id === e.id);
      const text = row ? await readEvidenceText(env, row) : null;
      return text ? { ...e, transcripcion: [{ speaker: null, start_ms: 0, end_ms: 0, text, es_victima: false }] } : e;
    }),
  );
  const hallazgos = [...new Set([...report.hallazgos, ...liveFindings(report, ders)])];
  return { ...report, evidencia, hallazgos };
}

/** Datos para la plantilla `denuncia` del contenedor (docs/ML_API.md). */
export async function denunciaPdfData(
  env: Env,
  report: VictimReport,
  extra: { seudonimo: string; demo: boolean },
): Promise<Record<string, unknown>> {
  const relatoRow = await env.DB.prepare("SELECT id FROM evidence WHERE case_id = ? AND tipo = 'texto' AND source = 'relato' ORDER BY seq DESC LIMIT 1")
    .bind(report.case_id)
    .first<{ id: string }>();
  const relato = relatoRow ? report.evidencia.find((e) => e.id === relatoRow.id) : undefined;
  const transcripciones = report.evidencia
    .filter((e) => e.transcripcion?.length && e.id !== relato?.id)
    .map((e) =>
      e.tipo === "texto"
        ? { evidencia: e.label, titulo: "Mensaje", texto: e.transcripcion!.map((t) => t.text).join("\n") }
        : {
            evidencia: e.label,
            titulo: "Audio",
            turnos: e.transcripcion!.map((t) => ({
              speaker: t.es_victima ? "Denunciante" : t.speaker ? `Voz ${t.speaker}` : "",
              start_ms: t.start_ms,
              end_ms: t.end_ms,
              texto: t.text,
            })),
          },
    );
  return {
    caso: report.code,
    seudonimo: extra.seudonimo,
    resumen: report.ficha?.resumen ?? null,
    narrativa: relato?.transcripcion?.map((t) => t.text).join("\n") ?? null,
    ficha: report.ficha ? { ...report.ficha, resumen_mo: report.ficha.resumen } : null,
    hallazgos: report.hallazgos,
    cronologia: report.cronologia,
    evidencia: report.evidencia.map((e) => ({
      label: e.label,
      tipo: e.tipo,
      size_bytes: e.size_bytes,
      sha256: e.sha256,
      received_utc: e.received_utc,
      captured_at: e.captured_at,
    })),
    transcripciones,
    demo: extra.demo,
    generado_utc: nowIso(),
  };
}
