import { gcm } from "@noble/ciphers/aes.js";

import { concat } from "@/lib/bytes";
import { randomBytes } from "@/security/random";

/**
 * AES-256-GCM para la cola local y los archivos pendientes.
 * Formato: [versión 1 byte = 1][IV 12 bytes][texto cifrado + tag 16 bytes].
 * Cada llamada a `seal` usa un IV nuevo de 96 bits del generador seguro del sistema.
 */
const VERSION = 1;
const IV_LEN = 12;

export function seal(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array, iv: Uint8Array = randomBytes(IV_LEN)): Uint8Array {
  if (key.length !== 32) throw new Error("La llave debe tener 32 bytes");
  if (iv.length !== IV_LEN) throw new Error("IV inválido");
  const ct = gcm(key, iv, aad).encrypt(plaintext);
  return concat(Uint8Array.of(VERSION), iv, ct);
}

export function open(key: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (sealed.length < 1 + IV_LEN + 16 || sealed[0] !== VERSION) throw new Error("Formato desconocido");
  const iv = sealed.subarray(1, 1 + IV_LEN);
  const ct = sealed.subarray(1 + IV_LEN);
  return gcm(key, iv, aad).decrypt(ct);
}

export function ivOf(sealed: Uint8Array): Uint8Array {
  return sealed.slice(1, 1 + IV_LEN);
}
