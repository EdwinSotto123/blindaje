import type { ConsoleUser, Role, TokenPair } from "@blindaje/shared";
import type { Env } from "../env";
import { audit } from "../audit";
import { ApiError } from "../lib/errors";
import { randomToken, sha256Hex } from "../lib/crypto";
import { addSeconds, newId, nowIso } from "../lib/ids";
import { ACCESS_TOKEN_TTL_SEC, signAccessToken } from "../lib/jwt";
import { log } from "../lib/log";

export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 3600;

export type SubjectType = "device" | "user" | "business";

/**
 * Las sesiones de negocio viven en su propia tabla (migración 0002): así un refresh token de negocio
 * nunca sirve en la consola ni al revés, y no hubo que reconstruir `refresh_tokens` por su CHECK.
 */
function tokenTable(subjectType: SubjectType): "refresh_tokens" | "business_refresh_tokens" {
  return subjectType === "business" ? "business_refresh_tokens" : "refresh_tokens";
}

export interface TokenSubject {
  sub: string;
  role: Role;
  org: string;
  pse?: string;
}

/** Emite un access token (15 min) y un refresh token rotativo (30 días; se guarda su SHA-256). */
export async function issueTokens(env: Env, subject: TokenSubject, subjectType: SubjectType): Promise<TokenPair> {
  const access = await signAccessToken(env.JWT_SECRET, {
    sub: subject.sub,
    role: subject.role,
    org: subject.org,
    ...(subject.pse ? { pse: subject.pse } : {}),
  });
  const refresh = randomToken(32);
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO ${tokenTable(subjectType)} (id, subject_type, subject_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId(), subjectType, subject.sub, await sha256Hex(refresh), addSeconds(now, REFRESH_TOKEN_TTL_SEC), now)
    .run();
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TOKEN_TTL_SEC };
}

interface RefreshRow {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

const invalidRefresh = () => new ApiError("unauthorized", "Sesión vencida. Vuelve a ingresar.");

/**
 * Consume un refresh token (rotación). Si alguien presenta un token ya rotado, se asume robo y
 * se revocan todas las sesiones de ese sujeto.
 */
export async function consumeRefreshToken(env: Env, token: string, subjectType: SubjectType, expectedSubject?: string): Promise<string> {
  if (!token || token.length > 200) throw invalidRefresh();
  const hash = await sha256Hex(token);
  const table = tokenTable(subjectType);
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE token_hash = ?`).bind(hash).first<RefreshRow>();
  if (!row || row.subject_type !== subjectType) throw invalidRefresh();
  if (expectedSubject && row.subject_id !== expectedSubject) throw invalidRefresh();
  const now = nowIso();
  if (row.revoked_at) {
    await revokeAllForSubject(env, row.subject_type, row.subject_id);
    log("warn", "refresh_token_reuse", { subject_type: row.subject_type });
    await audit(env, {
      actor_type: "system",
      actor_id: "auth",
      action: "auth.refresh_reuse_detected",
      target_type: row.subject_type,
      target_id: row.subject_id,
      details: null,
    });
    throw invalidRefresh();
  }
  if (row.expires_at <= now) throw invalidRefresh();
  const upd = await env.DB.prepare(`UPDATE ${table} SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(now, row.id).run();
  if (!upd.meta.changes) throw invalidRefresh();
  return row.subject_id;
}

export async function revokeAllForSubject(env: Env, subjectType: SubjectType, subjectId: string): Promise<void> {
  await env.DB.prepare(`UPDATE ${tokenTable(subjectType)} SET revoked_at = ? WHERE subject_type = ? AND subject_id = ? AND revoked_at IS NULL`)
    .bind(nowIso(), subjectType, subjectId)
    .run();
}

export async function revokeRefreshToken(env: Env, token: string, subjectId: string, subjectType?: SubjectType): Promise<boolean> {
  const hash = await sha256Hex(token);
  const table = tokenTable(subjectType ?? "user");
  const res = await env.DB.prepare(`UPDATE ${table} SET revoked_at = ? WHERE token_hash = ? AND subject_id = ? AND revoked_at IS NULL`)
    .bind(nowIso(), hash, subjectId)
    .run();
  return Boolean(res.meta.changes);
}

export interface UserRow {
  id: string;
  org_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: "reviewer" | "analyst" | "admin";
  disabled: number;
  is_demo: number;
  created_at: string;
  org_name: string;
}

/**
 * La cuenta de jurado del demo (jurado@demo.blindaje.test, contraseña pública en el README): rol de
 * administración para ver todo, pero de solo lectura. consoleRoutes le rechaza todo lo que no sea leer.
 */
export const DEMO_READONLY_USER_ID = "usr-demo-jurado";

export function consoleUserView(u: UserRow): ConsoleUser {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    org: { id: u.org_id, name: u.org_name },
    ...(u.id === DEMO_READONLY_USER_ID ? { solo_lectura: true } : {}),
  };
}

export async function getUserById(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT u.*, o.name AS org_name FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = ?")
    .bind(id)
    .first<UserRow>();
}

export async function getUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT u.*, o.name AS org_name FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = ?")
    .bind(email.trim().toLowerCase())
    .first<UserRow>();
}
