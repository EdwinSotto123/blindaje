import { sha256 } from "@noble/hashes/sha2.js";

import { toHex } from "@/lib/bytes";

/** SHA-256 en hexadecimal: la huella de integridad que el servidor recalcula al recibir. */
export function sha256Hex(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}
