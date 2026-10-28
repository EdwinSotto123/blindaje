/** Codificaciones binarias sin dependencias de Node. */

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(b64url)) throw new Error("base64url inválido");
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return b64ToBytes(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
}

export function bytesToHex(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of u8) out += b.toString(16).padStart(2, "0");
  return out;
}

export function utf8(s: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(s);
  const out = new Uint8Array(new ArrayBuffer(enc.length));
  out.set(enc);
  return out;
}

export function fromUtf8(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
