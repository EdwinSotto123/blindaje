import type { AppContext } from "../types";
import { ApiError } from "./errors";

/**
 * Lee el cuerpo crudo con un límite. Si llega `content-length`, reserva el buffer una sola vez
 * (importante con archivos de 50 MB y 128 MB de memoria por isolate).
 */
export async function readBodyLimited(c: AppContext, maxBytes: number): Promise<ArrayBuffer> {
  const tooLarge = () => new ApiError("payload_too_large", `El archivo supera el límite de ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const declared = c.req.header("content-length");
  const declaredLen = declared ? Number(declared) : NaN;
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) throw tooLarge();
  const body = c.req.raw.body;
  if (!body) return new ArrayBuffer(0);
  const reader = body.getReader();
  if (Number.isFinite(declaredLen) && declaredLen >= 0) {
    const out = new Uint8Array(new ArrayBuffer(declaredLen));
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > declaredLen) {
        await reader.cancel();
        throw new ApiError("bad_request", "El cuerpo no coincide con content-length");
      }
      out.set(value, offset);
      offset += value.byteLength;
    }
    return offset === declaredLen ? out.buffer : out.buffer.slice(0, offset);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const ch of chunks) {
    out.set(ch, offset);
    offset += ch.byteLength;
  }
  return out.buffer;
}
