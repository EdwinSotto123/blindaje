import type { z } from "zod";
import { VICTIM_FORBIDDEN_KEYS } from "@blindaje/shared";
import type { AppContext } from "../types";
import { ApiError } from "./errors";
import { log } from "./log";

export const JSON_BODY_LIMIT = 256 * 1024;

/** Convierte los issues de Zod en detalles sin incluir los valores enviados. */
export function zodDetails(err: z.ZodError): Array<{ path: string; message: string; code: string }> {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code }));
}

export async function readJson<S extends z.ZodType>(c: AppContext, schema: S): Promise<z.output<S>> {
  const len = Number(c.req.header("content-length") ?? "0");
  if (len > JSON_BODY_LIMIT) throw new ApiError("payload_too_large", "El cuerpo es demasiado grande");
  let raw: unknown;
  try {
    const text = await c.req.text();
    if (text.length > JSON_BODY_LIMIT) throw new ApiError("payload_too_large", "El cuerpo es demasiado grande");
    raw = text.length ? JSON.parse(text) : {};
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("bad_request", "El cuerpo no es JSON válido");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError("bad_request", "Datos inválidos", { details: zodDetails(parsed.error) });
  return parsed.data;
}

export function parseQuery<S extends z.ZodType>(c: AppContext, schema: S): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw new ApiError("bad_request", "Parámetros inválidos", { details: zodDetails(parsed.error) });
  return parsed.data;
}

export function clientIp(c: AppContext): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? "0.0.0.0";
}

// ---------------------------------------------------------------------------
// Respuestas para víctimas
// ---------------------------------------------------------------------------

const FORBIDDEN = new Set<string>(VICTIM_FORBIDDEN_KEYS);

/** Devuelve las rutas de las claves prohibidas que aparecen en `value`. */
export function findForbiddenKeys(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findForbiddenKeys(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.has(k.toLowerCase())) found.push(`${path}.${k}`);
      found.push(...findForbiddenKeys(v, `${path}.${k}`));
    }
  }
  return found;
}

/**
 * Única salida JSON para el rol victim: valida con el esquema del contrato (que descarta claves
 * desconocidas) y falla cerrado si quedara alguna clave de VICTIM_FORBIDDEN_KEYS.
 */
export function victimJson<S extends z.ZodType>(c: AppContext, schema: S, data: unknown, status: 200 | 201 | 202 = 200) {
  const parsed = schema.parse(data);
  const bad = findForbiddenKeys(parsed);
  if (bad.length) {
    log("error", "victim_response_blocked", { route: c.req.routePath, paths: bad });
    throw new ApiError("internal", "Respuesta bloqueada por la política de privacidad");
  }
  c.header("cache-control", "no-store");
  return c.json(parsed as object, status);
}
