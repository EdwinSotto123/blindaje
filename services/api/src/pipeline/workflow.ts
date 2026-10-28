import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers";
import type { Env } from "../env";
import { audit } from "../audit";
import { nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { indexCase } from "../linking";
import { isPermanentPipelineError } from "./errors";
import { buildFicha, ensureTextEmbedding, processEvidence, storeIdentifiers } from "./steps";
import type { EvidenceProcessResult, ProcesarCasoOutput, ProcesarCasoParams } from "./types";

const RETRY: WorkflowStepConfig = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "10 minutes" };
const RETRY_LIGHT: WorkflowStepConfig = { retries: { limit: 5, delay: "2 seconds", backoff: "exponential" }, timeout: "1 minute" };
/** Cuánto espera el Workflow a que la cola termine una evidencia antes de tomarla él. */
const WAIT_FOR_QUEUE_MS = 6 * 60_000;
const POLL_MS = 3_000;

/**
 * Procesa una evidencia desde el Workflow. Si la cola la está procesando, espera; si pasa el
 * plazo, la toma. Un error permanente (archivo ilegible, presupuesto) no tumba el caso: la
 * evidencia queda en `error` y el Workflow sigue.
 */
async function processFromWorkflow(env: ProcesarCaso["env"], evidenceId: string): Promise<"processed" | "skipped" | "error"> {
  const deadline = Date.now() + WAIT_FOR_QUEUE_MS;
  for (;;) {
    let r: EvidenceProcessResult;
    try {
      r = await processEvidence(env, evidenceId, { takeover: Date.now() >= deadline });
    } catch (err) {
      if (isPermanentPipelineError(err)) return "error";
      throw err;
    }
    if (r.status === "processed") return "processed";
    if (r.reason !== "en_proceso") return "skipped";
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * Workflow `procesar-caso` ("Preparar mi denuncia", sección 5.4). Pasos con nombre, idempotentes
 * y con reintentos. Los pasos con Meta o el contenedor viven en `steps.ts`, `ficha.ts` y `linking/`.
 *
 *  1. cadena-de-custodia     verifica que la evidencia del caso esté registrada y audita el inicio
 *  2. ingesta:<evidence_id>  procesa la evidencia que la cola todavía no terminó (o espera a la cola)
 *  3. ficha                  consolida la ficha con Muse Spark (error permanente = ficha pendiente)
 *  4. identificadores        HMAC y tabla de identificadores
 *  5. indexar                solo con consentimiento comunitario (vector del resumen_mo + FAISS)
 *  6. encolar-vinculacion    manda el caso a la cola de vinculación
 *  7. finalizar              estado "listo"
 * Si algo falla después de los reintentos: paso `marcar-error` y estado "error".
 */
export class ProcesarCaso extends WorkflowEntrypoint<Env, ProcesarCasoParams> {
  override async run(event: Readonly<WorkflowEvent<ProcesarCasoParams>>, step: WorkflowStep): Promise<ProcesarCasoOutput> {
    const { case_id: caseId, requested_by: requestedBy } = event.payload;
    const pending: string[] = [];
    try {
      const evidenceIds = await step.do("cadena-de-custodia", RETRY_LIGHT, async () => {
        const c = await this.env.DB.prepare("SELECT id FROM cases WHERE id = ?").bind(caseId).first();
        if (!c) throw new Error("case_not_found");
        const { results } = await this.env.DB.prepare("SELECT id, status FROM evidence WHERE case_id = ? ORDER BY seq")
          .bind(caseId)
          .all<{ id: string; status: string }>();
        await audit(this.env, {
          actor_type: "system",
          actor_id: "workflow:procesar-caso",
          action: "workflow.start",
          target_type: "case",
          target_id: caseId,
          details: { instance_id: event.instanceId, evidence: results.length, requested_by: requestedBy },
        });
        return results.filter((r) => r.status !== "procesado").map((r) => r.id);
      });

      for (const evidenceId of evidenceIds) {
        const res = await step.do(`ingesta:${evidenceId}`, RETRY, async () => processFromWorkflow(this.env, evidenceId));
        if (res !== "processed" && !pending.includes("ingesta")) pending.push("ingesta");
      }

      const hasFicha = await step.do("ficha", RETRY, async () => {
        let ficha: Awaited<ReturnType<typeof buildFicha>>;
        try {
          ficha = await buildFicha(this.env, caseId);
        } catch (err) {
          if (!isPermanentPipelineError(err)) throw err;
          log("warn", "ficha_pendiente", { case_id: caseId, ...errorFields(err) });
          return false;
        }
        if (!ficha) return false;
        await this.env.DB.prepare("UPDATE cases SET ficha_json = ?, updated_at = ? WHERE id = ?")
          .bind(JSON.stringify(ficha), nowIso(), caseId)
          .run();
        return true;
      });
      if (!hasFicha) pending.push("ficha");

      const ids = await step.do("identificadores", RETRY, async () => storeIdentifiers(this.env, caseId));
      if (ids.stub) pending.push("identificadores");

      const indexed = await step.do("indexar", RETRY, async () => {
        const c = await this.env.DB.prepare("SELECT consent_mode FROM cases WHERE id = ?").bind(caseId).first<{ consent_mode: string }>();
        if (c?.consent_mode !== "comunitario") return { indexed: false, stub: false };
        await ensureTextEmbedding(this.env, caseId, null);
        const r = await indexCase(this.env, caseId);
        if (r.indexed) await this.env.DB.prepare("UPDATE cases SET indexed = 1, updated_at = ? WHERE id = ?").bind(nowIso(), caseId).run();
        return r;
      });
      if (indexed.stub) pending.push("indexar");

      const queued = await step.do("encolar-vinculacion", RETRY_LIGHT, async () => {
        if (!indexed.indexed) return false;
        await this.env.VINCULACION.send({ case_id: caseId, reason: "submit" });
        return true;
      });

      await step.do("finalizar", RETRY_LIGHT, async () => {
        await this.env.DB.prepare("UPDATE cases SET estado = 'listo', error = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), caseId).run();
        await audit(this.env, {
          actor_type: "system",
          actor_id: "workflow:procesar-caso",
          action: "workflow.complete",
          target_type: "case",
          target_id: caseId,
          details: { instance_id: event.instanceId, ficha: hasFicha, indexed: indexed.indexed, pending_steps: pending },
        });
        return true;
      });

      return { case_id: caseId, ficha: hasFicha, indexed: indexed.indexed, queued_linking: queued, pending_steps: pending };
    } catch (err) {
      log("error", "workflow_failed", { case_id: caseId, instance_id: event.instanceId, ...errorFields(err) });
      await step.do("marcar-error", RETRY_LIGHT, async () => {
        await this.env.DB.prepare("UPDATE cases SET estado = 'error', error = ?, updated_at = ? WHERE id = ?")
          .bind("pipeline_error", nowIso(), caseId)
          .run();
        await audit(this.env, {
          actor_type: "system",
          actor_id: "workflow:procesar-caso",
          action: "workflow.error",
          target_type: "case",
          target_id: caseId,
          details: { instance_id: event.instanceId },
        });
        return true;
      });
      throw err;
    }
  }
}
