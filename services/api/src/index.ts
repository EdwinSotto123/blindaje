import type { Env } from "./env";
import { app } from "./app";
import { runVigia } from "./agents";
import { errorFields, log } from "./lib/log";
import { handleIngesta, handleVinculacion, INGESTA_QUEUE, VINCULACION_QUEUE } from "./pipeline/queues";
import type { IngestaMessage, VinculacionMessage } from "./pipeline/types";

export { RateLimiter } from "./do/rate-limiter";
export { AuditChain } from "./do/audit-chain";
export { ProcesarCaso } from "./pipeline/workflow";
export { MlContainer } from "./ml/container";

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<IngestaMessage | VinculacionMessage>, env: Env): Promise<void> {
    switch (batch.queue) {
      case INGESTA_QUEUE:
        return handleIngesta(batch as MessageBatch<IngestaMessage>, env);
      case VINCULACION_QUEUE:
        return handleVinculacion(batch as MessageBatch<VinculacionMessage>, env);
      default:
        log("warn", "queue_unknown", { queue: batch.queue, size: batch.messages.length });
        batch.ackAll();
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runVigia(env, { trigger: "cron", cron: controller.cron }).then(
        (alerts) => log("info", "vigia_cron_done", { cron: controller.cron, alerts: alerts.length }),
        (err) => log("error", "vigia_cron_failed", { cron: controller.cron, ...errorFields(err) }),
      ),
    );
  },
} satisfies ExportedHandler<Env, IngestaMessage | VinculacionMessage>;
