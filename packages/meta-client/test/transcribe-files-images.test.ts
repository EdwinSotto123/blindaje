import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MetaClient,
  MetaGuardError,
  assertTranscribableWav,
  normalizeTranscription,
  readSse,
  readWavInfo,
  type UsageEvent,
} from "../src";
import { fixturesDir } from "./helpers/env";
import { jsonResponse, mockFetch } from "./helpers/mock-fetch";

const wav = new Uint8Array(readFileSync(join(fixturesDir, "dialogo.wav")));
const transcribeJson = JSON.parse(readFileSync(join(fixturesDir, "transcribe-diarization.json"), "utf8")) as Record<string, unknown>;

function makeWav(sampleRate: number, channels: number, seconds = 1): Uint8Array {
  const dataBytes = sampleRate * channels * 2 * seconds;
  const b = new Uint8Array(44 + dataBytes);
  const v = new DataView(b.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  return b;
}

describe("WAV", () => {
  it("lee el encabezado del fixture", () => {
    expect(readWavInfo(wav)).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, audioFormat: 1 });
    expect(readWavInfo(wav)!.durationMs).toBeGreaterThan(13_000);
  });
  it("rechaza lo que la API rechazaría", () => {
    expect(() => assertTranscribableWav(makeWav(44100, 1))).toThrow(MetaGuardError);
    expect(() => assertTranscribableWav(makeWav(16000, 2))).toThrow(/canal/);
    expect(() => assertTranscribableWav(new Uint8Array([1, 2, 3]))).toThrow(/WAV/);
    expect(assertTranscribableWav(makeWav(24000, 1)).durationMs).toBe(1000);
  });
});

describe("transcribe", () => {
  it("normaliza la respuesta real y descarta el turno vacío", () => {
    const res = normalizeTranscription(transcribeJson);
    expect(res.audioDurationMs).toBe(14000);
    expect(res.turns.map((t) => t.speaker)).toEqual(["A", "B"]);
    expect(res.turns[0]).toMatchObject({ startMs: 140, endMs: 6940 });
    expect(normalizeTranscription(transcribeJson, { keepEmptyTurns: true }).turns).toHaveLength(3);
  });

  it("manda multipart con request JSON y audio WAV, y registra segundos enteros", async () => {
    const events: UsageEvent[] = [];
    const fetch = mockFetch(() => jsonResponse(transcribeJson));
    const c = new MetaClient({ apiKey: "k", fetch, hooks: { onUsage: (e) => void events.push(e) } });
    const res = await c.transcribe(wav, { languageBias: ["Spanish"], keywords: ["Yape", "cupo"], sessionId: "caso 1" });
    expect(res.transcript).toMatch(/yapear quinientos soles/);
    const call = fetch.calls[0]!;
    expect(call.url).toBe("https://api.meta.ai/v1/asr/transcribe?sessionId=caso%201");
    const contentType = call.init.headers["Content-Type"]!;
    const boundary = /boundary=(.+)$/.exec(contentType)![1]!;
    const parts = call.text.split(`--${boundary}`).slice(1, -1);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('Content-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n');
    const requestJson = JSON.parse(parts[0]!.split("\r\n\r\n")[1]!.trim()) as Record<string, unknown>;
    expect(requestJson).toEqual({
      model: "muse-voice-transcribe-1.0",
      mode: "DIARIZATION",
      audioEncoding: "WAV",
      languageBias: ["Spanish"],
      keywords: ["Yape", "cupo"],
    });
    expect(parts[1]).toContain('name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav');
    expect(parts[1]).toContain("RIFF");
    expect(events[0]).toMatchObject({ model: "muse-voice-transcribe-1.0", operation: "transcribe", units: { audio_seconds: 14 }, status: "ok" });
    expect(events[0]!.cost_usd).toBeCloseTo((14 * 0.18) / 3600, 10);
  });

  it("no sube audio inválido", async () => {
    const fetch = mockFetch(() => jsonResponse({}));
    const c = new MetaClient({ apiKey: "k", fetch });
    await expect(c.transcribe(makeWav(48000, 1))).rejects.toThrow(MetaGuardError);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("files", () => {
  it("upload: purpose primero, expiración, y file al final", async () => {
    const fetch = mockFetch(() => jsonResponse({ id: "file-1", object: "file", bytes: 3, created_at: 1, filename: "clip.mp4", purpose: "user_data" }));
    const c = new MetaClient({ apiKey: "k", fetch });
    const file = await c.files.upload(new Uint8Array([1, 2, 3]), { filename: "clip.mp4", expiresAfterSeconds: 3600 });
    expect(file.id).toBe("file-1");
    const text = fetch.calls[0]!.text;
    const order = ['name="purpose"', 'name="expires_after[anchor]"', 'name="expires_after[seconds]"', 'name="file"; filename="clip.mp4"'].map((s) =>
      text.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("Content-Type: video/mp4");
    expect(text).toContain("user_data");
  });

  it("delete", async () => {
    const fetch = mockFetch(() => jsonResponse({ id: "file-1", object: "file", deleted: true }));
    const c = new MetaClient({ apiKey: "k", fetch });
    expect(await c.files.delete("file-1")).toEqual({ id: "file-1", object: "file", deleted: true });
    expect(fetch.calls[0]!.init.method).toBe("DELETE");
    expect(fetch.calls[0]!.url).toBe("https://api.meta.ai/v1/files/file-1");
  });
});

describe("images.generate", () => {
  it("apaga la búsqueda integrada, es no esencial y cuesta 0.01 por imagen", async () => {
    const events: UsageEvent[] = [];
    const fetch = mockFetch(() => jsonResponse({ created: 1, data: [{ b64_json: "AAA" }, { b64_json: "BBB" }], output_format: "png" }));
    const c = new MetaClient({ apiKey: "k", fetch, hooks: { onUsage: (e) => void events.push(e) } });
    const res = await c.images.generate({ prompt: "tarjeta de alerta", n: 2, size: "1024x1024" });
    expect(res.images).toEqual([
      { b64: "AAA", mimeType: "image/png" },
      { b64: "BBB", mimeType: "image/png" },
    ]);
    expect(fetch.calls[0]!.json).toMatchObject({
      model: "muse-image-1.0",
      n: 2,
      size: "1024x1024",
      tool_enablement: { enable_web_search: false, enable_image_search: false },
    });
    expect(events[0]).toMatchObject({ essential: false, units: { images: 2 }, cost_usd: 0.02 });
  });
});

describe("readSse", () => {
  it("une varias líneas data, ignora comentarios y acepta CRLF partido entre trozos", async () => {
    const raw = ": keep-alive\r\nevent: a\r\ndata: uno\r\ndata: dos\r\n\r\ndata: tres\n\n";
    const bytes = new TextEncoder().encode(raw);
    const cut = raw.indexOf("\r\n\r\n") + 1; // corta entre \r y \n
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const messages = [];
    for await (const m of readSse(stream)) messages.push(m);
    expect(messages).toEqual([
      { event: "a", data: "uno\ndos" },
      { event: null, data: "tres" },
    ]);
  });
});
