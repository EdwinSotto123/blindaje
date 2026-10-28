/**
 * Logs estructurados en JSON. Nunca registran contenido de evidencia, transcripciones,
 * identificadores, relatos, contraseñas ni tokens: las claves sensibles se reemplazan por
 * "[redactado]" aunque alguien las pase por error.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "signature",
  "secret",
  "narrative",
  "relato",
  "text",
  "texto",
  "transcripcion",
  "transcript",
  "turns",
  "valor",
  "value",
  "identificadores",
  "identifiers",
  "vector",
  "vectors",
  "cuerpo",
  "contact",
  "contact_name",
  "message_body",
  "email",
  "ip",
  "public_key",
]);

type Level = "debug" | "info" | "warn" | "error";

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[profundo]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redactado]" : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...(sanitize(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error_name: err.name, error_message: err.message.slice(0, 300) };
  return { error_message: String(err).slice(0, 300) };
}
