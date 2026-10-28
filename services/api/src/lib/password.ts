import { b64ToBytes, bytesToB64, utf8 } from "./encoding";
import { randomBytes } from "./crypto";

/**
 * Contraseñas de consola: PBKDF2-SHA256 con WebCrypto. Formato:
 *   pbkdf2-sha256$<iteraciones>$<salt_b64>$<hash_b64>
 * Workers limita PBKDF2 a 100,000 iteraciones como máximo, así que usamos exactamente ese valor
 * (el mínimo pedido). La verificación acepta cualquier número de iteraciones guardado.
 */

export const PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", utf8(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const salt = b64ToBytes(parts[2]!);
  const expected = b64ToBytes(parts[3]!);
  const actual = await derive(password, salt, iterations);
  if (actual.byteLength !== expected.byteLength) return false;
  return crypto.subtle.timingSafeEqual(actual, expected);
}

/** Hash ficticio para igualar tiempos cuando el usuario no existe. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("blindaje-usuario-inexistente");
  return dummyHash;
}
