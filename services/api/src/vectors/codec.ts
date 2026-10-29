/** Float32 little-endian en base64 → number[]. */
export function decodeVector(b64: string): number[] {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return Array.from(new Float32Array(buf));
}

/** number[] → Float32 little-endian en base64. */
export function encodeVector(v: number[]): string {
  const u8 = new Uint8Array(new Float32Array(v).buffer);
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin);
}
