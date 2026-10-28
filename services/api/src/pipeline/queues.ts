import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { errorFields, log } from "../lib/log";
import { findCandidates, loadCalibration, upsertLink } from "../linking";
import { runVinculador } from "../agents";
import { processEvidence } from "./steps";
import type { IngestaMessage, VinculacionMessage } from "./types";

export const INGESTA_QUEUE = "blindaje-ingesta";
export const VINCULACION_QUEUE = "blindaje-vinculacion";

function retryDelay(attempts: number): number {
  return Math.min(300, 10 * 2 ** Math.max(0, attempts - 1));
}

/** Errores que no tiene sentido reintentar (stub, presupuesto, datos inválidos). */
function isPermanent(err: unknown): boolean {
  return err instanceof ApiError && ["not_implemented", "budget_exceeded", "bad_request", "not_found"].includes(err.code);
}

/** Consumer de INGESTA: procesa cada evidencia al llegar ("Lo que encontramos" en vivo). */
export async function handleIngesta(batch: MessageBatch<IngestaMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const evidenceId = msg.body?.evidence_id;
    if (!evidenceId) {
      log("warn", "ingesta_bad_message", { id: msg.id });
      msg.ack();
      continue;
    }
    try {
      const exists = await env.DB.prepare("SELECT status FROM evidence WHERE id = ?").bind(evidenceId).first<{ status: string }>();
      if (!exists) {
        // La evidencia se borró (por ejemplo, la víctima borró su caso): nada que hacer.
        msg.ack();
        continue;
      }
      if (exists.status === "procesado") {
        msg.ack();
        continue;
      }
      const res = await processEvidence(env, evidenceId);
      if (res.status === "processed") {
        await env.DB.prepare("UPDATE evidence SET status = 'procesado', error = NULL WHERE id = ?").bind(evidenceId).run();
      } else {
        log("info", "ingesta_skipped", { evidence_id: evidenceId, reason: res.reason });
      }
      msg.ack();
    } catch (err) {
      const permanent = isPermanent(err);
      log(permanent ? "warn" : "error", "ingesta_failed", { evidence_id: evidenceId, attempts: msg.attempts, permanent, ...errorFields(err) });
      if (permanent) {
        await env.DB.prepare("UPDATE evidence SET status = 'error', error = ? WHERE id = ?")
          .bind(err instanceof ApiError ? err.code : "error", evidenceId)
          .run();
        msg.ack();
      } else {
        msg.retry({ delaySeconds: retryDelay(msg.attempts) });
      }
    }
  }
}

/** Consumer de VINCULACION: busca candidatos de un caso indexado y guarda los vínculos propuestos. */
export async function handleVinculacion(batch: MessageBatch<VinculacionMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const caseId = msg.body?.case_id;
    if (!caseId) {
      msg.ack();
      continue;
    }
    try {
      const c = await env.DB.prepare("SELECT indexed FROM cases WHERE id = ?").bind(caseId).first<{ indexed: number }>();
      if (!c || !c.indexed) {
        msg.ack();
        continue;
      }
      const calibration = await loadCalibration(env);
      const pairs = await findCandidates(env, caseId);
      for (const pair of pairs) {
        const adj = await runVinculador(env, pair);
        await upsertLink(env, {
          case_x: pair.case_id,
          case_y: pair.other_case_id,
          signals: pair.signals,
          score_raw: pair.score_raw,
          score: adj?.output.puntaje_ajustado ?? pair.score_raw,
          vinculador: adj?.output ?? null,
          vinculador_valid: adj?.valid ?? null,
          calibration,
        });
      }
      log("info", "vinculacion_done", { case_id: caseId, candidates: pairs.length, reason: msg.body.reason });
      msg.ack();
    } catch (err) {
      const permanent = isPermanent(err);
      log(permanent ? "warn" : "error", "vinculacion_failed", { case_id: caseId, attempts: msg.attempts, ...errorFields(err) });
      if (permanent) msg.ack();
      else msg.retry({ delaySeconds: retryDelay(msg.attempts) });
    }
  }
}
