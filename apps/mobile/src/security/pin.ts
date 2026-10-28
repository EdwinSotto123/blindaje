import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { equalBytes, fromHex, toHex, utf8 } from "@/lib/bytes";
import { randomBytes } from "@/security/random";

/**
 * PIN y PIN señuelo. Se guardan como PBKDF2-SHA256 con sal propia dentro del almacenamiento
 * seguro del sistema (nunca en claro). Un PIN de 4 a 8 dígitos tiene pocas combinaciones: la
 * protección real es que el hash vive en el Keystore, no el costo del PBKDF2.
 */
export const PIN_MIN = 4;
export const PIN_MAX = 8;
const ITERATIONS = 12_000;
const PIN_RE = /^\d{4,8}$/;

export type PinRecord = {
  v: 1;
  iter: number;
  salt: string;
  real: string;
  decoy: string | null;
};

export type PinResult = "real" | "decoy" | null;

export function isValidPin(pin: string): boolean {
  return PIN_RE.test(pin);
}

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8(pin), salt, { c: iter, dkLen: 32 });
}

export async function createPinRecord(real: string, decoy: string | null, iter = ITERATIONS): Promise<PinRecord> {
  if (!isValidPin(real)) throw new Error("PIN inválido");
  if (decoy !== null && (!isValidPin(decoy) || decoy === real)) throw new Error("PIN señuelo inválido");
  const salt = randomBytes(16);
  return {
    v: 1,
    iter,
    salt: toHex(salt),
    real: toHex(await derive(real, salt, iter)),
    decoy: decoy === null ? null : toHex(await derive(decoy, salt, iter)),
  };
}

/** Compara contra los dos PIN siempre, para que el tiempo no delate cuál coincidió. */
export async function checkPin(record: PinRecord | null, pin: string): Promise<PinResult> {
  if (!record || !isValidPin(pin)) return null;
  const h = await derive(pin, fromHex(record.salt), record.iter);
  const isReal = equalBytes(h, fromHex(record.real));
  const isDecoy = record.decoy ? equalBytes(h, fromHex(record.decoy)) : false;
  if (isReal) return "real";
  if (isDecoy) return "decoy";
  return null;
}
