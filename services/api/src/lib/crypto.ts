import { b64ToBytes, b64UrlToBytes, bytesToB64, bytesToB64Url, bytesToHex, fromUtf8, utf8 } from "./encoding";

/**
 * Criptografía con WebCrypto.
 *
 * Cifrado en reposo: AES-256-GCM con EVIDENCE_ENCRYPTION_KEY (32 bytes en base64url), IV aleatorio
 * de 12 bytes y AAD = identificador del objeto (id de la evidencia, del derivado, del dispositivo…).
 * El AAD ata el texto cifrado a su fila: copiar el objeto de una evidencia a otra hace fallar el
 * descifrado. Formato almacenado: iv (12 bytes) || ciphertext (incluye el tag de 16 bytes).
 */

export const IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;

type BinaryInput = ArrayBuffer | ArrayBufferView;

export async function sha256Hex(data: BinaryInput | string): Promise<string> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(out);
  return out;
}

export function randomToken(nBytes = 32): string {
  return bytesToB64Url(randomBytes(nBytes));
}

/** Comparación en tiempo constante de dos cadenas (para secretos y hashes). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = utf8(a);
  const bb = utf8(b);
  if (ab.byteLength !== bb.byteLength) {
    // Igual comparamos algo del mismo largo para no filtrar el largo por tiempo.
    crypto.subtle.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.subtle.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------

const keyCache = new Map<string, Promise<CryptoKey>>();

export function importAesKey(secretB64Url: string): Promise<CryptoKey> {
  let p = keyCache.get(secretB64Url);
  if (!p) {
    const raw = b64UrlToBytes(secretB64Url.trim());
    if (raw.byteLength !== 32) throw new Error("EVIDENCE_ENCRYPTION_KEY debe tener 32 bytes en base64url");
    p = crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    keyCache.set(secretB64Url, p);
  }
  return p;
}

export async function encrypt(
  keyB64Url: string,
  plaintext: BinaryInput,
  aad: string,
): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer }> {
  const key = await importAesKey(keyB64Url);
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, key, plaintext);
  return { iv, ciphertext };
}

/** Descifra `iv || ciphertext`. Lanza si la clave, el AAD o los datos no coinciden. */
export async function decryptSealed(keyB64Url: string, sealed: ArrayBuffer, aad: string): Promise<ArrayBuffer> {
  if (sealed.byteLength < IV_BYTES + GCM_TAG_BYTES) throw new Error("objeto cifrado demasiado corto");
  const key = await importAesKey(keyB64Url);
  const iv = new Uint8Array(sealed, 0, IV_BYTES);
  const ct = new Uint8Array(sealed, IV_BYTES);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, key, ct);
}

export async function seal(keyB64Url: string, plaintext: BinaryInput, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  const { iv, ciphertext } = await encrypt(keyB64Url, plaintext, aad);
  const out = new Uint8Array(new ArrayBuffer(IV_BYTES + ciphertext.byteLength));
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), IV_BYTES);
  return out;
}

/** Para columnas de D1: base64(iv || ciphertext) de un texto. */
export async function sealString(keyB64Url: string, text: string, aad: string): Promise<string> {
  return bytesToB64(await seal(keyB64Url, utf8(text), aad));
}

export async function openString(keyB64Url: string, sealedB64: string, aad: string): Promise<string> {
  const bytes = b64ToBytes(sealedB64);
  return fromUtf8(await decryptSealed(keyB64Url, bytes.buffer, aad));
}

/**
 * Cifra y guarda en R2 como `iv || ciphertext` sin concatenar en memoria: escribe el IV y el
 * texto cifrado en un FixedLengthStream (importante para archivos de hasta 50 MB).
 */
export async function putEncrypted(
  bucket: R2Bucket,
  r2Key: string,
  keyB64Url: string,
  plaintext: BinaryInput,
  aad: string,
  customMetadata: Record<string, string> = {},
): Promise<{ size: number }> {
  const { iv, ciphertext } = await encrypt(keyB64Url, plaintext, aad);
  const size = IV_BYTES + ciphertext.byteLength;
  const { readable, writable } = new FixedLengthStream(size);
  const writer = writable.getWriter();
  const put = bucket.put(r2Key, readable, {
    customMetadata: { enc: "aes-256-gcm", iv_bytes: String(IV_BYTES), ...customMetadata },
  });
  await writer.write(iv);
  await writer.write(new Uint8Array(ciphertext));
  await writer.close();
  await put;
  return { size };
}

/** Lee y descifra un objeto de R2. Devuelve null si no existe. */
export async function getDecrypted(
  bucket: R2Bucket,
  r2Key: string,
  keyB64Url: string,
  aad: string,
): Promise<ArrayBuffer | null> {
  const obj = await bucket.get(r2Key);
  if (!obj) return null;
  return decryptSealed(keyB64Url, await obj.arrayBuffer(), aad);
}

// ---------------------------------------------------------------------------
// HMAC genérico (por ejemplo, hash de IP para la landing)
// ---------------------------------------------------------------------------

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, utf8(message)));
}
