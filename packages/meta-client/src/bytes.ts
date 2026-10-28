/**
 * Utilidades de bytes sin `Buffer` (Workers no lo tiene sin nodejs_compat).
 */

export type BinaryInput = Uint8Array | ArrayBuffer;

export function toUint8Array(input: BinaryInput): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** Copia a un ArrayBuffer propio (cuerpo de fetch sin problemas de tipos ni de offsets). */
export function toArrayBuffer(input: BinaryInput): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  return copy.buffer;
}

export function bytesToBase64(input: BinaryInput): string {
  const bytes = toUint8Array(input);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Detecta el tipo de imagen por sus primeros bytes. */
export function sniffImageMime(input: BinaryInput): string | null {
  const b = toUint8Array(input);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

export function bytesToDataUrl(input: BinaryInput, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(input)}`;
}

const encoder = new TextEncoder();

export interface MultipartPart {
  name: string;
  value: string | BinaryInput;
  filename?: string;
  contentType?: string;
}

/**
 * Arma un cuerpo multipart/form-data a mano. Se evita FormData para controlar exactamente los
 * encabezados de cada parte (Voice Transcribe espera `request` como JSON sin nombre de archivo).
 */
export function buildMultipart(parts: MultipartPart[], boundary = randomBoundary()): { body: ArrayBuffer; contentType: string } {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) header += `; filename="${part.filename.replace(/"/g, "")}"`;
    header += "\r\n";
    if (part.contentType) header += `Content-Type: ${part.contentType}\r\n`;
    header += "\r\n";
    chunks.push(encoder.encode(header));
    chunks.push(typeof part.value === "string" ? encoder.encode(part.value) : toUint8Array(part.value));
    chunks.push(encoder.encode("\r\n"));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { body: out.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

function randomBoundary(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `----blindaje${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
