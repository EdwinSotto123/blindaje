import { fromHex, toHex } from "@/lib/bytes";
import { randomBytes } from "@/security/random";
import { getSecret, KEYS, setSecret } from "@/security/secureStore";

/**
 * Llaves simétricas de 256 bits guardadas en el almacenamiento seguro del sistema.
 * - k_db: llave de SQLCipher para notas.db
 * - k_files: llave AES-GCM de la cola local y los archivos pendientes
 */
const cache = new Map<string, Uint8Array>();

async function getOrCreate(name: typeof KEYS.dbKey | typeof KEYS.fileKey): Promise<Uint8Array> {
  const hit = cache.get(name);
  if (hit) return hit;
  let hex = await getSecret(name);
  if (!hex) {
    hex = toHex(randomBytes(32));
    await setSecret(name, hex);
  }
  const key = fromHex(hex);
  cache.set(name, key);
  return key;
}

export const getDbKey = () => getOrCreate(KEYS.dbKey);
export const getFileKey = () => getOrCreate(KEYS.fileKey);

/** Olvida las llaves en memoria (borrado de emergencia). */
export function forgetKeys(): void {
  for (const k of cache.values()) k.fill(0);
  cache.clear();
}
