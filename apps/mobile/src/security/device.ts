import { p256 } from "@noble/curves/nist.js";

import { fromHex, toBase64Url, toHex, utf8 } from "@/lib/bytes";
import { randomBytes } from "@/security/random";
import { getSecret, KEYS, setSecret } from "@/security/secureStore";

/**
 * Llave del dispositivo (ECDSA P-256). La privada vive en el almacenamiento seguro; la pública
 * se registra como JWK en /v1/auth/device/register. Cada refresh firma
 * `refresh:${device_id}:${timestamp}` (SHA-256, firma IEEE P1363 en base64url).
 */
export type DevicePublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };

export function publicJwkFromSecret(secretKey: Uint8Array): DevicePublicJwk {
  const pub = p256.getPublicKey(secretKey, false); // 0x04 | x | y
  return { kty: "EC", crv: "P-256", x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33, 65)) };
}

export function generateDeviceSecret(): Uint8Array {
  return p256.utils.randomSecretKey(randomBytes(48));
}

export async function getOrCreateDeviceKey(): Promise<{ secret: Uint8Array; jwk: DevicePublicJwk }> {
  let hex = await getSecret(KEYS.deviceKey);
  if (!hex) {
    hex = toHex(generateDeviceSecret());
    await setSecret(KEYS.deviceKey, hex);
  }
  const secret = fromHex(hex);
  return { secret, jwk: publicJwkFromSecret(secret) };
}

export function refreshMessage(deviceId: string, timestamp: number): string {
  return `refresh:${deviceId}:${timestamp}`;
}

/** Firma compacta r||s (64 bytes, IEEE P1363) del SHA-256 del mensaje, en base64url. */
export function signRefresh(secret: Uint8Array, deviceId: string, timestamp: number): string {
  const sig = p256.sign(utf8(refreshMessage(deviceId, timestamp)), secret, { prehash: true });
  return toBase64Url(sig);
}
