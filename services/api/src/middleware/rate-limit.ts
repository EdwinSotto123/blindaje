import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";
import type { RateLimitResult } from "../do/rate-limiter";
import { timingSafeEqualStr } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { clientIp } from "../lib/http";
import { errorFields, log } from "../lib/log";
import type { AppEnv } from "../types";

export interface Limit {
  limit: number;
  windowSec: number;
}

/**
 * Cupos por bucket. "ip" se aplica por dirección IP; "sub" por dispositivo o usuario autenticado.
 * Limitar por dispositivo también frena a un infiltrado que sube "evidencia de prueba" en masa.
 */
export const LIMITS = {
  global: { ip: { limit: 600, windowSec: 60 } },
  auth: { ip: { limit: 20, windowSec: 60 } },
  login: { ip: { limit: 10, windowSec: 60 } },
  register: { ip: { limit: 10, windowSec: 3600 } },
  pilot: { ip: { limit: 5, windowSec: 3600 } },
  /** Lecturas públicas sin cuenta (mapa, riesgo, alertas y consejos por distrito). */
  public: { ip: { limit: 60, windowSec: 60 } },
  victim: { sub: { limit: 120, windowSec: 60 } },
  upload: { sub: { limit: 60, windowSec: 3600 }, ip: { limit: 200, windowSec: 3600 } },
  submit: { sub: { limit: 20, windowSec: 3600 } },
  console: { sub: { limit: 600, windowSec: 60 } },
  business: { sub: { limit: 120, windowSec: 60 } },
  agents: { sub: { limit: 20, windowSec: 3600 } },
} satisfies Record<string, { ip?: Limit; sub?: Limit }>;

export type Bucket = keyof typeof LIMITS;

export async function hitLimit(env: Env, key: string, l: Limit): Promise<RateLimitResult> {
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key));
  return stub.hit(l.limit, l.windowSec);
}

/**
 * Middleware de rate limiting con el Durable Object RateLimiter. Si el Durable Object falla,
 * deja pasar (fail-open) y lo registra: preferimos no dejar a una víctima sin poder subir evidencia.
 */
export function rateLimit(bucket: Bucket): MiddlewareHandler<AppEnv> {
  const cfg = LIMITS[bucket] as { ip?: Limit; sub?: Limit };
  return async (c, next) => {
    const checks: Array<Promise<RateLimitResult>> = [];
    try {
      if (cfg.ip) checks.push(hitLimit(c.env, `${bucket}:ip:${clientIp(c)}`, cfg.ip));
      const auth = c.get("auth");
      if (cfg.sub && auth) checks.push(hitLimit(c.env, `${bucket}:sub:${auth.sub}`, cfg.sub));
      const results = await Promise.all(checks);
      const denied = results.find((r) => !r.allowed);
      if (denied) {
        log("warn", "rate_limited", { bucket, route: c.req.routePath, role: auth?.role ?? null });
        throw new ApiError("rate_limited", "Demasiadas solicitudes. Espera un momento e intenta de nuevo.", {
          headers: { "retry-after": String(denied.retry_after) },
          details: { retry_after: denied.retry_after },
        });
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      log("error", "rate_limiter_unavailable", { bucket, ...errorFields(err) });
    }
    await next();
  };
}

/** El script del demo (`demo:seed`) se identifica con DEMO_MODE=true y el header x-demo-secret. */
function isDemoScript(c: Parameters<MiddlewareHandler<AppEnv>>[0]): boolean {
  const secret = c.req.header("x-demo-secret");
  return c.env.DEMO_MODE === "true" && Boolean(c.env.DEMO_SECRET) && Boolean(secret) && timingSafeEqualStr(secret!, c.env.DEMO_SECRET);
}

/**
 * Como `rateLimit`, pero exime al script del demo: un `demo:seed` completo registra 9 dispositivos
 * desde la misma IP y el cupo de registro es 10 por hora. Para todo lo demás el límite sigue igual.
 */
export function rateLimitUnlessDemo(bucket: Bucket): MiddlewareHandler<AppEnv> {
  const limited = rateLimit(bucket);
  return async (c, next) => (isDemoScript(c) ? next() : limited(c, next));
}
