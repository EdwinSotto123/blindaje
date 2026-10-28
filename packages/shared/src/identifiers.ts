import type { IdentifierType } from "./enums";

/**
 * Normalización y cifrado de identificadores (sección 7.5).
 *
 * Teléfonos y cuentas de billetera (Yape, Plin) comparten el grupo "tel": en Perú una cuenta de
 * Yape es un número de celular, así que la cuenta de cobro de un caso puede coincidir con el número
 * que llamó en otro. Cuentas bancarias y placas tienen su propio grupo.
 *
 * El HMAC usa la clave de la alianza (HMAC_ALLIANCE_KEY). Sin la clave no se puede revertir por
 * fuerza bruta; con la clave sí, porque los teléfonos tienen pocas combinaciones: la seguridad
 * depende de proteger la clave.
 */

export type IdentifierGroup = "tel" | "banco" | "placa";

export function identifierGroup(tipo: IdentifierType): IdentifierGroup {
  switch (tipo) {
    case "telefono":
    case "cuenta_yape":
    case "cuenta_plin":
      return "tel";
    case "cuenta_bancaria":
      return "banco";
    case "placa":
      return "placa";
  }
}

/** Devuelve el valor normalizado o null si no parece un identificador válido. */
export function normalizeIdentifier(tipo: IdentifierType, raw: string): string | null {
  const group = identifierGroup(tipo);
  if (group === "placa") {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return v.length >= 5 && v.length <= 8 ? v : null;
  }
  const digits = raw.replace(/\D/g, "");
  if (group === "banco") {
    return digits.length >= 8 && digits.length <= 24 ? digits : null;
  }
  // tel: E.164 peruano por defecto
  if (digits.length === 9 && digits.startsWith("9")) return `+51${digits}`;
  if (digits.length === 11 && digits.startsWith("51")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function lastThree(normalized: string): string {
  return normalized.replace(/[^A-Z0-9]/gi, "").slice(-3);
}

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Importa la clave de la alianza (base64url) para HMAC-SHA256. Funciona en Workers y en Node 22. */
export async function importAllianceKey(keyB64Url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64UrlToBytes(keyB64Url), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

/** HMAC-SHA256 en hex de `${grupo}:${valor_normalizado}`. */
export async function hmacIdentifier(key: CryptoKey, tipo: IdentifierType, normalized: string): Promise<string> {
  const data = new TextEncoder().encode(`${identifierGroup(tipo)}:${normalized}`);
  return toHex(await crypto.subtle.sign("HMAC", key, data));
}
