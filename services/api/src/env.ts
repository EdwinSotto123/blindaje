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
  /**
   * "off" ignora el binding `ML` mientras la imagen del contenedor no esté desplegada: sin esto cada
   * búsqueda espera a que el contenedor inexistente falle (de 5 a 25 s). Cualquier otro valor lo usa.
   */
  ML_CONTAINER?: string;
  /** Región fijada del Worker (la de `placement` en wrangler.jsonc), para el panel de monitoreo. */
  WORKER_REGION?: string;
  /** Orígenes permitidos por CORS, separados por coma. */
  ALLOWED_ORIGINS?: string;
  /** Base de Chroma Cloud ("blindaje"). Con CHROMA_API_KEY y CHROMA_TENANT, la búsqueda vectorial usa Chroma. */
  CHROMA_DATABASE?: string;
  /** Por defecto https://api.trychroma.com (o un Chroma autoalojado). */
  CHROMA_URL?: string;
  /** "false" deja entrar casos reales a Chroma; cualquier otro valor, solo casos ficticios del demo. */
  CHROMA_SOLO_DEMO?: string;

  // Secretos (wrangler secret put / .dev.vars)
  MODEL_API_KEY: string;
  HMAC_ALLIANCE_KEY: string;
  EVIDENCE_ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  DEMO_SECRET: string;
  TURNSTILE_SECRET: string;
  ML_TOKEN?: string;
  CHROMA_API_KEY?: string;
  CHROMA_TENANT?: string;
}

type BlindajeEnv = Env;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends BlindajeEnv {}
  }
}
