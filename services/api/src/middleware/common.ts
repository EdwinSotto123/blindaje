import type { ErrorHandler, MiddlewareHandler } from "hono";
import { ZodError } from "zod";
import { ApiError, errorBody } from "../lib/errors";
import { zodDetails } from "../lib/http";
import { errorFields, log } from "../lib/log";
import { RequestTiming, runWithTiming, timedD1 } from "../lib/timing";
import type { AppEnv } from "../types";

/**
 * Id de petición, tiempos por recurso (Server-Timing) y log estructurado de cada petición (sin
 * rutas con datos ni IPs).
 */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const reqId = c.req.header("cf-ray") ?? crypto.randomUUID();
  c.set("reqId", reqId);
  const timing = new RequestTiming();
  c.env = { ...c.env, DB: timedD1(c.env.DB) };
  await runWithTiming(timing, next);
  c.header("x-request-id", reqId);
  c.header("server-timing", timing.header());
  log(c.res.status >= 500 ? "error" : "info", "request", {
    req_id: reqId,
    method: c.req.method,
    route: c.req.routePath,
    status: c.res.status,
    ms: Date.now() - timing.started,
    db_ms: timing.totals.db.ms,
    db_n: timing.totals.db.n,
    do_ms: timing.totals.do.ms,
    ext_ms: timing.totals.ext.ms,
    role: c.get("auth")?.role ?? null,
  });
};

/** Cabeceras de seguridad para una API JSON. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("x-frame-options", "DENY");
  c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
};

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
    if (err.status >= 500) log("error", "api_error", { code: err.code, route: c.req.routePath, ...errorFields(err) });
    return c.json(errorBody(err.code, err.message, err.details), err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json(errorBody("bad_request", "Datos inválidos", zodDetails(err)), 400);
  }
  log("error", "unhandled_error", { route: c.req.routePath, req_id: c.get("reqId"), ...errorFields(err) });
  return c.json(errorBody("internal", "Error interno. Intenta de nuevo."), 500);
};
