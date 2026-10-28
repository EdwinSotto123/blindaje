import type { RateLimiter } from "./do/rate-limiter";
import type { AuditChain } from "./do/audit-chain";
import type { MlContainer } from "./ml/container";
import type { IngestaMessage, ProcesarCasoParams, VinculacionMessage } from "./pipeline/types";

/** Bindings del Worker blindaje-api (ver wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  INDICES: R2Bucket;
  CONFIG: KVNamespace;
  INGESTA: Queue<IngestaMessage>;
  VINCULACION: Queue<VinculacionMessage>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  AUDIT_CHAIN: DurableObjectNamespace<AuditChain>;
  PROCESAR_CASO: Workflow<ProcesarCasoParams>;
  /** Binding de Containers. Solo existe cuando se activa la sección `containers` del wrangler.jsonc. */
  ML?: DurableObjectNamespace<MlContainer>;

  // Variables
  ENVIRONMENT: string;
  DEMO_MODE: string;
  META_BUDGET_USD: string;
  /** Si tiene valor, el Worker habla con el contenedor ML por HTTP (desarrollo y evaluación). */
  ML_URL?: string;
  /** Orígenes permitidos por CORS, separados por coma. */
  ALLOWED_ORIGINS?: string;

  // Secretos (wrangler secret put / .dev.vars)
  MODEL_API_KEY: string;
  HMAC_ALLIANCE_KEY: string;
  EVIDENCE_ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  DEMO_SECRET: string;
  TURNSTILE_SECRET: string;
  ML_TOKEN?: string;
}

type BlindajeEnv = Env;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends BlindajeEnv {}
  }
}
