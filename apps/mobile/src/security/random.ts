import * as ExpoCrypto from "expo-crypto";

/** Bytes aleatorios del generador seguro del sistema. */
export function randomBytes(n: number): Uint8Array {
  return ExpoCrypto.getRandomBytes(n);
}
