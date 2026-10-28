import { linkLabel, statusForScore } from "@blindaje/shared";
import type { Env } from "../env";
import { audit } from "../audit";
import { errorFields, log } from "../lib/log";
import { findCandidates, loadCalibration, upsertLink } from "../linking";
import { finalScore } from "../linking/signals";
import { runVinculador } from "../agents";
import { errorCode, isPermanentPipelineError } from "./errors";
import { processEvidence } from "./steps";
import type { IngestaMessage, VinculacionMessage } from "./types";

export const INGESTA_QUEUE = "blindaje-ingesta";
export const VINCULACION_QUEUE = "blindaje-vinculacion";

/** Intentos de la cola antes de tomar una evidencia que figura "procesando" (consumidor caído). */
const TAKEOVER_AFTER_ATTEMPTS = 3;

function retryDelay(attempts: number): number {
  return Math.min(300, 10 * 2 ** Math.max(0, attempts - 1));
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
      const res = await processEvidence(env, evidenceId, { takeover: msg.attempts > TAKEOVER_AFTER_ATTEMPTS });
      if (res.status === "skipped" && res.reason === "en_proceso") {
        // El Workflow la está procesando: volver a mirar más tarde.
        msg.retry({ delaySeconds: 30 });
        continue;
      }
      if (res.status === "skipped") log("info", "ingesta_skipped", { evidence_id: evidenceId, reason: res.reason });
      msg.ack();
    } catch (err) {
      const permanent = isPermanentPipelineError(err);
      log(permanent ? "warn" : "error", "ingesta_failed", { evidence_id: evidenceId, attempts: msg.attempts, permanent, code: errorCode(err), ...errorFields(err) });
      if (permanent) msg.ack();
      else msg.retry({ delaySeconds: retryDelay(msg.attempts) });
    }
  }
}

export interface LinkingSummary {
  case_id: string;
  candidates: number;
  links: Array<{ id: string; label: string; other_case_id: string; status: string; score: number; score_raw: number; vinculador_valid: boolean | null }>;
}

/**
 * Vinculación de un caso indexado (sección 9): candidatos con señales calibradas; si el puntaje
 * combinado llega al umbral de revisión, el Vinculador ajusta y explica; si no, el par se guarda
 * como `descartado_auto` (para recalibrar, no se muestra). Todo vínculo queda en la auditoría.
 */
export async function processCaseLinking(env: Env, caseId: string, reason: VinculacionMessage["reason"] = "submit"): Promise<LinkingSummary> {
  const calibration = await loadCalibration(env);
  const pairs = await findCandidates(env, caseId, calibration);
  const summary: LinkingSummary = { case_id: caseId, candidates: pairs.length, links: [] };
  for (const pair of pairs) {
    let score = pair.score_raw;
    let vinculador: Awaited<ReturnType<typeof runVinculador>> = null;
    let valid: boolean | null = null;
    if (pair.score_raw >= calibration.thresholds.revisar) {
      try {
        vinculador = await runVinculador(env, pair, calibration);
        valid = vinculador ? vinculador.valid : null;
        if (vinculador?.valid) score = finalScore(vinculador.output.puntaje_ajustado, pair.score_raw);
      } catch (err) {
        // Sin Vinculador el vínculo igual llega a la cola del revisor, con el puntaje del motor.
        log("warn", "vinculador_failed", { case_id: caseId, other: pair.other_case_id, ...errorFields(err) });
        valid = false;
      }
    }
    const saved = await upsertLink(env, {
      case_x: pair.case_id,
      case_y: pair.other_case_id,
      signals: pair.signals,
      score_raw: pair.score_raw,
      score,
      vinculador: vinculador?.output ?? null,
      vinculador_valid: valid,
      calibration,
    });
    if (!saved) continue;
    const label = linkLabel(saved.num);
    await audit(env, {
      actor_type: "system",
      actor_id: "motor:vinculacion",
      action: "link.propose",
      target_type: "link",
      target_id: saved.id,
      details: {
        label,
        reason,
        status: saved.status,
        auto_status: statusForScore(score, calibration),
        score: Math.round(score * 10_000) / 10_000,
        score_raw: pair.score_raw,
        signals: Object.keys(pair.signals),
        vinculador_valid: valid,
        agent_run_id: vinculador?.run_id ?? null,
        calibration: calibration.version,
      },
    });
    summary.links.push({ id: saved.id, label, other_case_id: pair.other_case_id, status: saved.status, score, score_raw: pair.score_raw, vinculador_valid: valid });
  }
  return summary;
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
      const summary = await processCaseLinking(env, caseId, msg.body.reason);
      log("info", "vinculacion_done", { case_id: caseId, candidates: summary.candidates, links: summary.links.length, reason: msg.body.reason });
      msg.ack();
    } catch (err) {
      const permanent = isPermanentPipelineError(err);
      log(permanent ? "warn" : "error", "vinculacion_failed", { case_id: caseId, attempts: msg.attempts, ...errorFields(err) });
      if (permanent) msg.ack();
      else msg.retry({ delaySeconds: retryDelay(msg.attempts) });
    }
  }
}
