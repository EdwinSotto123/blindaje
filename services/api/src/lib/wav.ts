/**
 * Recorte de WAV PCM16 por rango de milisegundos, sin decodificar: se copian los bytes del rango
 * alineados al tamaño de cuadro y se escribe un encabezado RIFF nuevo.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

export function parseWav(buf: ArrayBuffer): WavInfo | null {
  if (buf.byteLength < 44) return null;
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let off = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (off + 8 <= buf.byteLength) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        format: v.getUint16(body, true),
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        bits: v.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) return null;
      const dataLength = Math.min(size, buf.byteLength - body);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: 16, dataOffset: body, dataLength };
    }
    off = body + size + (size % 2);
  }
  return null;
}

export function wavDurationMs(info: WavInfo): number {
  const frame = info.channels * (info.bitsPerSample / 8);
  return Math.floor((info.dataLength / frame / info.sampleRate) * 1000);
}

export function trimWav(buf: ArrayBuffer, startMs: number, endMs: number): ArrayBuffer | null {
  const info = parseWav(buf);
  if (!info) return null;
  const frame = info.channels * 2;
  const totalFrames = Math.floor(info.dataLength / frame);
  const startFrame = Math.max(0, Math.min(totalFrames, Math.floor((startMs / 1000) * info.sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(totalFrames, Math.ceil((endMs / 1000) * info.sampleRate)));
  const dataLen = (endFrame - startFrame) * frame;
  const out = new ArrayBuffer(44 + dataLen);
  const v = new DataView(out);
  const w = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, info.channels, true);
  v.setUint32(24, info.sampleRate, true);
  v.setUint32(28, info.sampleRate * frame, true);
  v.setUint16(32, frame, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, dataLen, true);
  new Uint8Array(out, 44).set(new Uint8Array(buf, info.dataOffset + startFrame * frame, dataLen));
  return out;
}

/** WAV PCM16 mono de silencio (para pruebas). */
export function makeWav(durationMs: number, sampleRate = 16000): ArrayBuffer {
  const frames = Math.floor((durationMs / 1000) * sampleRate);
  const dataLen = frames * 2;
  const out = new ArrayBuffer(44 + dataLen);
  const v = new DataView(out);
  const w = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, dataLen, true);
  for (let i = 0; i < frames; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 10) * 1000), true);
  return out;
}
