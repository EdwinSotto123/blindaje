import { Hono } from "hono";
import { z } from "zod";
import {
  ConsoleLoginRequest,
  ConsoleLoginResponse,
  ConsoleRefreshRequest,
  DeviceRefreshRequest,
  DeviceRegisterRequest,
  DeviceRegisterResponse,
  TokenPair,
} from "@blindaje/shared";
import { audit } from "../audit";
import {
  consoleUserView,
  consumeRefreshToken,
  getUserByEmail,
  getUserById,
  issueTokens,
  revokeRefreshToken,
} from "../auth/tokens";
import { ApiError } from "../lib/errors";
import { isUniqueViolation } from "../lib/db";
import { DEVICE_SIGNATURE_SKEW_MS, importDevicePublicKey, refreshMessage, verifyDeviceSignature } from "../lib/device-signature";
import { readJson, victimJson } from "../lib/http";
import { newId, nowIso, pseudonym } from "../lib/ids";
import { log } from "../lib/log";
import { dummyPasswordHash, verifyPassword } from "../lib/password";
import { getAuth, requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";
import { actorOf } from "../types";

export const authRoutes = new Hono<AppEnv>();

const invalidInvite = () => new ApiError("bad_request", "El código de invitación no es válido o ya venció");

authRoutes.post("/device/register", rateLimit("register"), async (c) => {
  const body = await readJson(c, DeviceRegisterRequest);
  try {
    await importDevicePublicKey(body.public_key);
  } catch {
    throw new ApiError("bad_request", "La llave pública del dispositivo no es válida");
  }
  const code = body.invite_code.trim().toUpperCase();
  const now = nowIso();
  const invite = await c.env.DB.prepare("SELECT code, org_id FROM invites WHERE code = ?").bind(code).first<{ code: string; org_id: string }>();
  if (!invite) throw invalidInvite();
  const used = await c.env.DB.prepare(
    "UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)",
  )
    .bind(code, now)
    .run();
  if (!used.meta.changes) throw invalidInvite();
  const org = await c.env.DB.prepare("SELECT id, name, is_demo FROM organizations WHERE id = ?")
    .bind(invite.org_id)
    .first<{ id: string; name: string; is_demo: number }>();
  if (!org) throw invalidInvite();

  const deviceId = newId();
  let pse = "";
  for (let attempt = 0; attempt < 5 && !pse; attempt++) {
    const candidate = pseudonym();
    try {
      await c.env.DB.prepare(
        `INSERT INTO devices (id, org_id, pseudonym, public_key_jwk, platform, invite_code, is_demo, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(deviceId, org.id, candidate, JSON.stringify(body.public_key), body.platform, code, org.is_demo, now, now)
        .run();
      pse = candidate;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  if (!pse) throw new ApiError("conflict", "No se pudo registrar el dispositivo, intenta de nuevo");

  const tokens = await issueTokens(c.env, { sub: deviceId, role: "victim", org: org.id, pse }, "device");
  await audit(c.env, {
    actor_type: "victim",
    actor_id: pse,
    action: "device.register",
    target_type: "device",
    target_id: deviceId,
    details: { org_id: org.id, platform: body.platform },
  });
  return victimJson(c, DeviceRegisterResponse, { ...tokens, device_id: deviceId, pseudonym: pse, org: { id: org.id, name: org.name } }, 201);
});

authRoutes.post("/device/refresh", rateLimit("auth"), async (c) => {
  const body = await readJson(c, DeviceRefreshRequest);
  const unauthorized = () => new ApiError("unauthorized", "No se pudo verificar el dispositivo");
  if (!Number.isFinite(body.timestamp) || Math.abs(Date.now() - body.timestamp) > DEVICE_SIGNATURE_SKEW_MS) {
    throw new ApiError("unauthorized", "La hora del dispositivo no coincide. Revisa la fecha y hora del celular.");
  }
  const device = await c.env.DB.prepare("SELECT id, org_id, pseudonym, public_key_jwk FROM devices WHERE id = ?")
    .bind(body.device_id)
    .first<{ id: string; org_id: string; pseudonym: string; public_key_jwk: string }>();
  if (!device) throw unauthorized();
  const ok = await verifyDeviceSignature(JSON.parse(device.public_key_jwk), refreshMessage(device.id, body.timestamp), body.signature);
  if (!ok) {
    log("warn", "device_signature_invalid");
    throw unauthorized();
  }
  await consumeRefreshToken(c.env, body.refresh_token, "device", device.id);
  await c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(nowIso(), device.id).run();
  const tokens = await issueTokens(c.env, { sub: device.id, role: "victim", org: device.org_id, pse: device.pseudonym }, "device");
  return victimJson(c, TokenPair, tokens);
});

const invalidLogin = () => new ApiError("unauthorized", "Correo o contraseña incorrectos");

authRoutes.post("/console/login", rateLimit("login"), async (c) => {
  const body = await readJson(c, ConsoleLoginRequest);
  const user = await getUserByEmail(c.env, body.email);
  if (!user) {
    await verifyPassword(body.password, await dummyPasswordHash());
    throw invalidLogin();
  }
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok || user.disabled) {
    log("warn", "console_login_failed", { disabled: Boolean(user.disabled) });
    throw invalidLogin();
  }
  const tokens = await issueTokens(c.env, { sub: user.id, role: user.role, org: user.org_id }, "user");
  await audit(c.env, {
    actor_type: user.role,
    actor_id: user.id,
    action: "auth.login",
    target_type: "user",
    target_id: user.id,
    details: null,
  });
  return c.json(ConsoleLoginResponse.parse({ ...tokens, user: consoleUserView(user) }));
});

authRoutes.post("/console/refresh", rateLimit("auth"), async (c) => {
  const body = await readJson(c, ConsoleRefreshRequest);
  const userId = await consumeRefreshToken(c.env, body.refresh_token, "user");
  const user = await getUserById(c.env, userId);
  if (!user || user.disabled) throw new ApiError("unauthorized", "Sesión vencida. Vuelve a ingresar.");
  const tokens = await issueTokens(c.env, { sub: user.id, role: user.role, org: user.org_id }, "user");
  return c.json(TokenPair.parse(tokens));
});

authRoutes.post("/logout", requireAuth, async (c) => {
  const body = await readJson(c, z.object({ refresh_token: z.string().min(1).max(200) }));
  const auth = getAuth(c);
  const revoked = await revokeRefreshToken(c.env, body.refresh_token, auth.sub);
  if (revoked) {
    await audit(c.env, { ...actorOf(auth), action: "auth.logout", target_type: auth.role === "victim" ? "device" : "user", target_id: auth.sub });
  }
  return c.body(null, 204);
});
