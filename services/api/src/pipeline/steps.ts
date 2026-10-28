import type { Env } from "../env";
import type { EvidenceRow } from "../evidence";
import { metaClientFor } from "../agents/common";
import { errorFields, log } from "../lib/log";
import { tryGetMlClient } from "../ml/client";
import { processAudio } from "./audio";
import { analyzeAuthenticity } from "./authenticity";
import type { EvidenceCtx } from "./context";
import { errorCode } from "./errors";
import { processImage } from "./image";
import { processText } from "./text";
import { processVideo } from "./video";
import type { EvidenceProcessResult } from "./types";

export { buildFicha, ensureTextEmbedding, storeIdentifiers } from "./ficha";

/**
 * Pasos del pipeline por evidencia (cola INGESTA, al llegar) y por caso (Workflow, al enviar).
 * Reglas:
 * - Idempotentes: la cola y el Workflow pueden reintentar. Cada procesador reemplaza en una sola
 *   transacción lo que dejó una corrida anterior de la misma evidencia.
 * - Meta con `metaClientFor(env, { case_id })` (presupuesto y costos por los hooks) y caché por
 *   SHA-256 con `withCostCache`: reprocesar no vuelve a pagar.
 * - Evidencia en claro solo en memoria; derivados binarios cifrados con AAD = id del derivado.
 * - La cola y el Workflow pueden llegar a la vez a la misma evidencia: el primero toma la
 *   evidencia (`status = 'procesando'`) y el otro recibe `skipped: en_proceso` y espera.
 * - Después del procesador, el paso `autenticidad` (¿hecho con IA?) para audio, imagen y video.
 *   Es de mejor esfuerzo: un fallo del ML o de Meta lo deja "no analizado" sin romper la evidencia.
 */

export async function processEvidence(env: Env, evidenceId: string, opts: { takeover?: boolean } = {}): Promise<EvidenceProcessResult> {
  const ev = await env.DB.prepare("SELECT * FROM evidence WHERE id = ?").bind(evidenceId).first<EvidenceRow>();
  if (!ev) return { status: "skipped", reason: "no_existe" };
  if (ev.status === "procesado") return { status: "processed" };
  const caso = await env.DB.prepare("SELECT id, code, device_id, is_demo FROM cases WHERE id = ?")
    .bind(ev.case_id)
    .first<EvidenceCtx["caso"]>();
  if (!caso) return { status: "skipped", reason: "no_existe" };

  const ml = ev.tipo === "texto" ? null : tryGetMlClient(env);
  if (ev.tipo !== "texto" && !ml) return { status: "skipped", reason: "ml_no_configurado" };

  const lease = await env.DB.prepare("UPDATE evidence SET status = 'procesando', error = NULL WHERE id = ? AND status IN ('recibido', 'error')")
    .bind(evidenceId)
    .run();
  if (!lease.meta.changes) {
    const now = await env.DB.prepare("SELECT status FROM evidence WHERE id = ?").bind(evidenceId).first<{ status: string }>();
    if (!now) return { status: "skipped", reason: "no_existe" };
    if (now.status === "procesado") return { status: "processed" };
    if (!opts.takeover) return { status: "skipped", reason: "en_proceso" };
    log("warn", "evidence_takeover", { evidence_id: evidenceId });
  }

  const ctx: EvidenceCtx = { env, ev, caso, ml, meta: metaClientFor(env, { case_id: caso.id }) };
  const started = Date.now();
  try {
    switch (ev.tipo) {
      case "audio":
        await processAudio(ctx);
        break;
      case "imagen":
        await processImage(ctx);
        break;
      case "video":
        await processVideo(ctx);
        break;
      case "texto":
        await processText(ctx);
        break;
    }
    // Paso `autenticidad` (audio, imagen y video): nunca lanza; si falla, queda "no analizado".
    await analyzeAuthenticity(ctx);
    await env.DB.prepare("UPDATE evidence SET status = 'procesado', error = NULL WHERE id = ?").bind(evidenceId).run();
    log("info", "evidence_processed", { evidence_id: evidenceId, tipo: ev.tipo, ms: Date.now() - started });
    return { status: "processed" };
  } catch (err) {
    log("warn", "evidence_failed", { evidence_id: evidenceId, tipo: ev.tipo, ...errorFields(err) });
    await env.DB.prepare("UPDATE evidence SET status = 'error', error = ? WHERE id = ?").bind(errorCode(err), evidenceId).run();
    throw err;
  }
}
