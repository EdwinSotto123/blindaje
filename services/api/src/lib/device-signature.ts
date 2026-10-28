import { DevicePublicKey } from "@blindaje/shared";
import { b64UrlToBytes, utf8 } from "./encoding";

/**
 * Firma del dispositivo: ECDSA P-256 / SHA-256 sobre `refresh:${device_id}:${timestamp}`,
 * en formato IEEE P1363 (r || s, 64 bytes) y base64url. WebCrypto usa P1363 de forma nativa.
 */

export const DEVICE_SIGNATURE_SKEW_MS = 5 * 60 * 1000;

export function refreshMessage(deviceId: string, timestamp: number): string {
  return `refresh:${deviceId}:${timestamp}`;
}

export async function importDevicePublicKey(jwk: unknown): Promise<CryptoKey> {
  const parsed = DevicePublicKey.parse(jwk);
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: parsed.x, y: parsed.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export async function verifyDeviceSignature(publicKeyJwk: unknown, message: string, signatureB64Url: string): Promise<boolean> {
  try {
    const key = await importDevicePublicKey(publicKeyJwk);
    const sig = b64UrlToBytes(signatureB64Url);
    if (sig.byteLength !== 64) return false;
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, utf8(message));
  } catch {
    return false;
  }
}
