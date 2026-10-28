import type { MiddlewareHandler } from "hono";
import type { Role } from "@blindaje/shared";
import { ApiError } from "../lib/errors";
import { verifyAccessToken } from "../lib/jwt";
import type { AppEnv, AuthContext } from "../types";

/** Exige `Authorization: Bearer <access_token>` válido y deja los claims en `c.var.auth`. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header);
  if (!m) throw new ApiError("unauthorized", "Falta el token de acceso");
  const claims = await verifyAccessToken(c.env.JWT_SECRET, m[1]!);
  const auth: AuthContext = { sub: claims.sub, role: claims.role, org: claims.org, ...(claims.pse ? { pse: claims.pse } : {}) };
  c.set("auth", auth);
  await next();
};

/** Guarda por rol. Úsala después de requireAuth. */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set<Role>(roles);
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) throw new ApiError("unauthorized", "Falta el token de acceso");
    if (!allowed.has(auth.role)) throw new ApiError("forbidden", "Tu rol no tiene acceso a esta acción");
    await next();
  };
}

export function getAuth(c: { get(key: "auth"): AuthContext | undefined }): AuthContext {
  const auth = c.get("auth");
  if (!auth) throw new ApiError("unauthorized", "Falta el token de acceso");
  return auth;
}
