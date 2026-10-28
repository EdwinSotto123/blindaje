import { Hono } from "hono";
import { PilotRequest } from "@blindaje/shared";
import { ApiError } from "../lib/errors";
import { hmacHex } from "../lib/crypto";
import { clientIp, readJson } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

export const API_VERSION = "0.1.0";

export const publicRoutes = new Hono<AppEnv>();

const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Verifica un token de Turnstile. En local se usa la clave secreta de prueba que siempre aprueba. */
export async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  let res: Response;
  try {
    res = await fetch(TURNSTILE_URL, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    log("error", "turnstile_unreachable", errorFields(err));
    throw new ApiError("upstream_error", "No se pudo verificar el formulario. Intenta de nuevo.");
  }
  if (!res.ok) throw new ApiError("upstream_error", "No se pudo verificar el formulario. Intenta de nuevo.");
  const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
  if (!data.success) log("warn", "turnstile_rejected", { codes: data["error-codes"] ?? [] });
  return data.success === true;
}

publicRoutes.post("/pilot-requests", rateLimit("pilot"), async (c) => {
  const body = await readJson(c, PilotRequest);
  const ip = clientIp(c);
  const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET, body.turnstile_token, ip);
  if (!ok) throw new ApiError("forbidden", "No pudimos verificar que seas una persona. Recarga la página e intenta de nuevo.");
  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO pilot_requests (id, org_name, contact_name, contact, sector, district, members, message, lang, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.org_name,
      body.contact_name,
      body.contact,
      body.sector ?? null,
      body.district ?? null,
      body.members ?? null,
      body.message ?? null,
      body.lang,
      (await hmacHex(c.env.JWT_SECRET, `pilot-ip:${ip}`)).slice(0, 32),
      nowIso(),
    )
    .run();
  log("info", "pilot_request_created", { lang: body.lang });
  return c.json({ id }, 201);
});
