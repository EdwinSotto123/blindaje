import {
  hallazgosParaVictima,
  type CaseSummary,
  type ConsentMode,
  type FichaStored,
  type TimelineEvent,
  type VictimReport,
} from "@blindaje/shared";
import type { Env } from "../env";
import { audit } from "../audit";
import { openString } from "../lib/crypto";
import { parseJsonColumn } from "../lib/db";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { notFound } from "../lib/errors";
import { caseR2Prefix, deleteR2Prefix, toEvidenceItem, type EvidenceRow } from "../evidence";
import { deindexCase, indexCase } from "../linking";
import { recomputeNetworks } from "../networks";
import type { CaseIdentifiersPlain, LecturaContent, TranscripcionContent } from "../pipeline/types";
import type { Actor } from "../types";

/** Versión del texto de consentimiento que muestra la app (se guarda en `consents`). */
export const CONSENT_TEXT_VERSION = "2026-10-28.1";

export interface CaseRow {
  id: string;
  code: string;
  org_id: string;
  device_id: string;
  seudonimo_victima: string;
  sector: string | null;
  zona_cuadricula: string | null;
  primer_contacto: string | null;
  estado: "borrador" | "procesando" | "listo" | "error";
  consent_mode: ConsentMode;
  ficha_json: string | null;
  identifiers_enc: string | null;
  narrative_enc: string | null;
  indexed: number;
  workflow_id: string | null;
  error: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

/** Caso de la víctima o 404 (nunca 403: no confirmamos que un caso ajeno exista). */
export async function getOwnedCase(env: Env, caseId: string, deviceId: string): Promise<CaseRow> {
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ? AND device_id = ?").bind(caseId, deviceId).first<CaseRow>();
  if (!row) throw notFound("Caso");
  return row;
}

export async function caseSummary(env: Env, c: CaseRow): Promise<CaseSummary> {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM evidence WHERE case_id = ?").bind(c.id).first<{ n: number }>();
  return toCaseSummary(c, n?.n ?? 0);
}

export function toCaseSummary(c: CaseRow, evidenceCount: number): CaseSummary {
  return {
    id: c.id,
    code: c.code,
    status: c.estado,
    consent_mode: c.consent_mode,
    created_at: c.created_at,
    updated_at: c.updated_at,
    evidence_count: evidenceCount,
  };
}

export function identifiersAad(caseId: string): string {
  return `identifiers:${caseId}`;
}

interface DerivativeRow {
  evidence_id: string;
  tipo: string;
  content_json: string | null;
}

const TIPO_TEXTO: Record<string, string> = {
  audio: "Audio recibido",
  imagen: "Imagen recibida",
  video: "Video recibido",
  texto: "Mensaje recibido",
};

/** Reporte propio de la víctima: ficha, cronología y evidencia de SU caso, nada más. */
export async function buildVictimReport(env: Env, c: CaseRow): Promise<VictimReport> {
  const [evRes, derRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM evidence WHERE case_id = ? ORDER BY seq").bind(c.id),
    env.DB.prepare(
      "SELECT evidence_id, tipo, content_json FROM derivatives WHERE case_id = ? AND tipo IN ('transcripcion','lectura','redactada','segmentacion')",
    ).bind(c.id),
  ]);
  const evidence = evRes!.results as unknown as EvidenceRow[];
  const derivatives = derRes!.results as unknown as DerivativeRow[];

  const ficha = parseJsonColumn<FichaStored>(c.ficha_json);
  let identificadores: Array<{ tipo: string; valor: string }> = [];
  if (c.identifiers_enc) {
    try {
      const plain = JSON.parse(await openString(env.EVIDENCE_ENCRYPTION_KEY, c.identifiers_enc, identifiersAad(c.id))) as CaseIdentifiersPlain;
      identificadores = (plain.identificadores ?? []).map((i) => ({ tipo: String(i.tipo), valor: String(i.valor) }));
    } catch (err) {
      log("error", "identifiers_decrypt_failed", { case_id: c.id, ...errorFields(err) });
    }
  }

  const cronologia: TimelineEvent[] = [];
  const primer = ficha?.primer_contacto ?? c.primer_contacto;
  if (primer) cronologia.push({ fecha: primer, texto: "Primer contacto", evidencia: [] });
  for (const e of evidence) {
    if (e.captured_at && e.source !== "relato") {
      cronologia.push({ fecha: e.captured_at, texto: TIPO_TEXTO[e.tipo] ?? "Evidencia", evidencia: [e.label] });
    }
  }
  for (const esc of ficha?.escalamiento ?? []) {
    if (esc.fecha) cronologia.push({ fecha: esc.fecha, texto: esc.tipo, evidencia: esc.evidencia });
  }
  cronologia.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  return {
    case_id: c.id,
    code: c.code,
    status: c.estado,
    consent_mode: c.consent_mode,
    hallazgos: ficha ? hallazgosParaVictima(ficha) : [],
    ficha: ficha
      ? {
          sector: ficha.sector ?? c.sector,
          zona: ficha.zona ?? c.zona_cuadricula,
          primer_contacto: ficha.primer_contacto ?? c.primer_contacto,
          amenaza: ficha.amenaza,
          monto_soles: ficha.monto_soles,
          plazo: ficha.plazo,
          canal_pago: ficha.canal_pago,
          grupo_que_dice_ser: ficha.grupo_que_dice_ser,
          frases_firma: ficha.frases_firma,
          identificadores,
          resumen: ficha.resumen_mo,
        }
      : null,
    cronologia,
    evidencia: evidence.map((e) => {
      const mine = derivatives.filter((d) => d.evidence_id === e.id);
      const tr = mine.find((d) => d.tipo === "transcripcion");
      const trContent = parseJsonColumn<TranscripcionContent>(tr?.content_json);
      const nota =
        mine
          .map((d) => parseJsonColumn<Partial<LecturaContent>>(d.content_json)?.nota)
          .find((n): n is string => typeof n === "string" && n.length > 0) ?? null;
      return {
        ...toEvidenceItem(e),
        transcripcion: trContent?.turns
          ? trContent.turns.map((t) => ({
              speaker: t.speaker ?? null,
              start_ms: t.start_ms,
              end_ms: t.end_ms,
              text: t.text,
              es_victima: Boolean(t.es_victima),
            }))
          : null,
        nota,
      };
    }),
    updated_at: c.updated_at,
  };
}

/** Cambia el consentimiento, guarda el historial y, si pasa a "solo mi denuncia", desindexa. */
export async function setConsent(env: Env, c: CaseRow, mode: ConsentMode, actor: Actor): Promise<CaseRow> {
  if (c.consent_mode === mode) return c;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE consents SET revoked_at = ? WHERE case_id = ? AND revoked_at IS NULL").bind(now, c.id),
    env.DB.prepare("INSERT INTO consents (id, case_id, device_id, mode, text_version, granted_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      newId(),
      c.id,
      c.device_id,
      mode,
      CONSENT_TEXT_VERSION,
      now,
    ),
    env.DB.prepare("UPDATE cases SET consent_mode = ?, updated_at = ? WHERE id = ?").bind(mode, now, c.id),
  ]);
  let deindex: Awaited<ReturnType<typeof deindexCase>> | null = null;
  if (mode === "solo_denuncia") {
    deindex = await deindexCase(env, c.id);
  } else if (c.estado === "listo") {
    const r = await indexCase(env, c.id);
    if (r.indexed) {
      await env.DB.prepare("UPDATE cases SET indexed = 1, updated_at = ? WHERE id = ?").bind(nowIso(), c.id).run();
      await env.VINCULACION.send({ case_id: c.id, reason: "consent" });
    }
  }
  await audit(env, {
    ...actor,
    action: "case.consent",
    target_type: "case",
    target_id: c.id,
    details: {
      mode,
      previous: c.consent_mode,
      text_version: CONSENT_TEXT_VERSION,
      ...(deindex ? { deindexed: true, links_removed: deindex.links_removed } : {}),
    },
  });
  const updated = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(c.id).first<CaseRow>();
  return updated ?? { ...c, consent_mode: mode, updated_at: now };
}

/**
 * Borrado completo de un caso: lo saca de los índices, borra sus vínculos, sus objetos en R2
 * (evidencia, derivados y caché de resultados), sus filas en D1 (en cascada) y recalcula las redes.
 */
export async function deleteCaseFully(
  env: Env,
  c: CaseRow,
  actor: Actor,
  opts: { recompute?: boolean } = {},
): Promise<{ r2_objects: number; links_removed: number }> {
  if (c.workflow_id && c.estado === "procesando") {
    try {
      const inst = await env.PROCESAR_CASO.get(c.workflow_id);
      await inst.terminate();
    } catch (err) {
      log("warn", "workflow_terminate_failed", { case_id: c.id, ...errorFields(err) });
    }
  }
  const evCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM evidence WHERE case_id = ?").bind(c.id).first<{ n: number }>();
  const deindex = await deindexCase(env, c.id, { recompute: false });

  let r2Objects = await deleteR2Prefix(env.EVIDENCE, caseR2Prefix(c.id));
  const { results: cached } = await env.DB.prepare("SELECT DISTINCT cache_key FROM api_costs WHERE case_id = ? AND cache_key IS NOT NULL")
    .bind(c.id)
    .all<{ cache_key: string }>();
  if (cached.length) {
    await env.EVIDENCE.delete(cached.map((r) => `cache/${r.cache_key}`));
    r2Objects += cached.length;
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE api_costs SET case_id = NULL WHERE case_id = ?").bind(c.id),
    env.DB.prepare("DELETE FROM cases WHERE id = ?").bind(c.id),
    env.DB.prepare("DELETE FROM identifiers WHERE hmac NOT IN (SELECT hmac FROM case_identifiers)"),
  ]);
  if (opts.recompute !== false) await recomputeNetworks(env);
  await audit(env, {
    ...actor,
    action: "case.delete",
    target_type: "case",
    target_id: c.id,
    details: { code: c.code, evidence: evCount?.n ?? 0, r2_objects: r2Objects, links_removed: deindex.links_removed },
  });
  return { r2_objects: r2Objects, links_removed: deindex.links_removed };
}
