import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseImageStream, recordsOfKind } from "@meta-sam/parser";
import { describe, expect, it } from "vitest";
import {
  MetaApiError,
  MetaClient,
  decodeMask,
  expandBox,
  maskToBox,
  parseMaskToken,
  parseSamOutput,
  pixelateRGBA,
  readResponsesEvents,
  type UsageEvent,
} from "../src";
import { fixturesDir } from "./helpers/env";
import { mockFetch, sseResponse, sseText } from "./helpers/mock-fetch";
import { circleAndSquarePng } from "./helpers/png";

const fixture = (name: string) => readFileSync(join(fixturesDir, name), "utf8");
const LOSSLESS = "sam-image-lossless-conf.sse";
const ONE_BIT = "sam-image-onebit.sse";

function outputTextOf(sse: string): string {
  const done = sse.split("\n").find((l) => l.startsWith("data: ") && l.includes('"response.output_text.done"'));
  return (JSON.parse(done!.slice(6)) as { text: string }).text;
}

describe("parseSamOutput (capturas reales)", () => {
  it("lee el círculo con confianza y máscara lossless", () => {
    const { frames, problems } = parseSamOutput(outputTextOf(fixture(LOSSLESS)));
    expect(problems).toEqual([]);
    expect(frames).toHaveLength(1);
    const [obj] = frames[0]!.objects;
    expect(obj).toMatchObject({ id: 0, box: { x1: 33, y1: 49, x2: 127, y2: 143, w: 256, h: 192 } });
    expect(obj!.confidence).toBeGreaterThan(0.5);
    expect(obj!.mask).toMatch(/^<\|mask;x=0;y=0;c=[\d.]+;data=95,95,~.+\|>$/);
  });

  it("coincide con @meta-sam/parser (cajas y dimensiones de máscara)", async () => {
    for (const name of [LOSSLESS, ONE_BIT]) {
      const sse = fixture(name);
      const events = sse
        .split("\n")
        .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
        .map((l) => JSON.parse(l.slice(6)) as { type: string });
      async function* source() {
        yield* events;
      }
      const official = await parseImageStream(source()).finalResult;
      expect(official.outcome.status).toBe("completed");
      expect(official.diagnostics).toEqual([]);
      const ours = parseSamOutput(outputTextOf(sse)).frames.flatMap((f) => f.objects);
      const boxes = recordsOfKind(official.records, "box");
      const masks = recordsOfKind(official.records, "mask");
      expect(ours.map((o) => String(o.id))).toEqual(boxes.map((b) => b.objectId));
      ours.forEach((o, i) => {
        expect({ left: o.box.x1, top: o.box.y1, right: o.box.x2 + 1, bottom: o.box.y2 + 1 }).toMatchObject({
          left: boxes[i]!.left,
          top: boxes[i]!.top,
          right: boxes[i]!.right,
          bottom: boxes[i]!.bottom,
        });
        const token = parseMaskToken(o.mask);
        expect({ width: token.width, height: token.height, payload: token.payload }).toEqual({
          width: masks[i]!.mask.width,
          height: masks[i]!.mask.height,
          payload: masks[i]!.mask.payload,
        });
      });
    }
  });

  it("decodifica la máscara (base85) a un raster que dibuja el círculo", () => {
    for (const name of [LOSSLESS, ONE_BIT]) {
      const obj = parseSamOutput(outputTextOf(fixture(name))).frames[0]!.objects[0]!;
      const mask = decodeMask(obj);
      expect(mask).toMatchObject({ width: 95, height: 95, left: 33, top: 49 });
      expect(mask.data.length).toBe(95 * 95);
      const on = mask.data.reduce((n, v) => n + v, 0);
      // Área del círculo de radio 48 ≈ 7238 píxeles.
      expect(on).toBeGreaterThan(6500);
      expect(on).toBeLessThan(7600);
      // Centro encendido, esquina apagada.
      expect(mask.data[47 * 95 + 47]).toBe(1);
      expect(mask.data[0]).toBe(0);
      const tight = maskToBox(obj)!;
      expect(Math.abs(tight.x1 - 32)).toBeLessThanOrEqual(2);
      expect(Math.abs(tight.x2 - 128)).toBeLessThanOrEqual(2);
      expect(Math.abs(tight.y1 - 48)).toBeLessThanOrEqual(2);
      expect(Math.abs(tight.y2 - 144)).toBeLessThanOrEqual(2);
    }
  });
});

describe("parseSamOutput (gramática)", () => {
  const box = (x1: number, c?: number) => `<|box;x1=${x1};y1=1;x2=${x1 + 9};y2=10;w=320;h=240${c !== undefined ? `;c=${c}` : ""}|>`;
  const mask = "<|mask;x=0;y=0;data=10,10,!abc|>";

  it("varios frames, ids dispersos, frames salteados y desordenados", () => {
    const text = `<2f>5${box(1)}${mask},7${box(50)}${mask}\n<0f>5${box(2)}${mask}\n`;
    const { frames, problems } = parseSamOutput(text);
    expect(problems).toEqual([]);
    expect(frames.map((f) => f.frame)).toEqual([0, 2]);
    expect(frames[1]!.objects.map((o) => o.id)).toEqual([5, 7]);
  });

  it("líneas pegadas sin salto de línea entre deltas", () => {
    const { frames } = parseSamOutput(`<0f>1${box(1)}${mask}<1f>1${box(3)}${mask}`);
    expect(frames.map((f) => f.objects[0]!.box.x1)).toEqual([1, 3]);
  });

  it("confianza en la caja o en la máscara, por clave", () => {
    const { frames } = parseSamOutput(`<0f>1${box(1, 0.75)}<|mask;x=0;y=0;c=0.75;data=10,10,~zz|>`);
    expect(frames[0]!.objects[0]!.confidence).toBe(0.75);
  });

  it("registros incompletos van a problems sin inventar datos", () => {
    const { frames, problems } = parseSamOutput(`<0f>1${box(1)},2${mask},3${box(5)}${mask}`);
    expect(frames[0]!.objects.map((o) => o.id)).toEqual([3]);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("texto vacío = cero coincidencias", () => {
    expect(parseSamOutput("")).toEqual({ frames: [], problems: [] });
  });
});

describe("segmentImage / segmentVideo con fetch simulado", () => {
  it("envía el concepto y la imagen como data URL por SSE y devuelve objetos", async () => {
    const events: UsageEvent[] = [];
    const fetch = mockFetch(() => sseResponse(fixture(LOSSLESS)));
    const c = new MetaClient({ apiKey: "k", fetch, hooks: { onUsage: (e) => void events.push(e) } });
    const res = await c.segmentImage({ image: circleAndSquarePng(), concept: "circle", includeConfidence: true });
    expect(res.objects).toHaveLength(1);
    expect(res).toMatchObject({ width: 256, height: 192, responseId: expect.stringMatching(/^resp_/), problems: [] });
    expect(res.usage?.images_processed).toBe(1);
    const body = fetch.calls[0]!.json!;
    expect(body).toMatchObject({ model: "sam-3.1", stream: true, store: false, metadata: { include_confidence: "true" } });
    const content = (body.input as Array<{ content: Array<Record<string, string>> }>)[0]!.content;
    expect(content[0]).toEqual({ type: "input_text", text: "circle" });
    expect(content[1]!.image_url).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(fetch.calls[0]!.init.headers.Accept).toBe("text/event-stream");
    expect(events[0]).toMatchObject({ model: "sam-3.1", operation: "sam_image", units: { images: 1 }, cost_usd: 0.0025, status: "ok" });
  });

  it("cero coincidencias: stream completo con texto vacío", async () => {
    const text = sseText([
      { type: "response.created", response: { id: "resp_e", status: "in_progress" } },
      { type: "response.completed", response: { id: "resp_e", status: "completed", output: [], usage: { images_processed: 1 } } },
    ]);
    const c = new MetaClient({ apiKey: "k", fetch: mockFetch(() => sseResponse(text)) });
    const res = await c.segmentImage({ image: "https://example.com/a.png", concept: "gato" });
    expect(res.objects).toEqual([]);
    expect(res.width).toBeNull();
  });

  it("response.failed se reintenta y luego sale como MetaApiError", async () => {
    const failed = sseText([{ type: "response.failed", response: { id: "r", status: "failed", error: { code: "server_error", message: "falló" } } }]);
    const fetch = mockFetch(() => sseResponse(failed));
    const c = new MetaClient({ apiKey: "k", fetch, maxRetries: 1, sleep: async () => {} });
    const error = (await c.segmentImage({ image: "https://example.com/a.png", concept: "gato" }).catch((e: unknown) => e)) as MetaApiError;
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error.inStream).toBe(true);
    expect(fetch.calls).toHaveLength(2);
  });

  it("un stream cortado sin evento terminal se reintenta", async () => {
    const cut = fixture(ONE_BIT).split("event: response.completed")[0]!;
    const fetch = mockFetch(() => sseResponse(cut), () => sseResponse(fixture(ONE_BIT)));
    const c = new MetaClient({ apiKey: "k", fetch, sleep: async () => {} });
    const res = await c.segmentImage({ image: "https://example.com/a.png", concept: "circle" });
    expect(res.objects).toHaveLength(1);
    expect(fetch.calls).toHaveLength(2);
  });

  it("video por file_id: frames en orden, one_bit por defecto, costo por frames facturados", async () => {
    const events: UsageEvent[] = [];
    const line = (f: number, x: number) => `<${f}f>0<|box;x1=${x};y1=10;x2=${x + 20};y2=30;w=160;h=120|><|mask;x=0;y=0;data=21,21,!abc|>\n`;
    const text = sseText([
      { type: "response.created", response: { id: "resp_v" } },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: line(0, 10) },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: line(1, 14) },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: line(3, 22) },
      { type: "response.completed", response: { id: "resp_v", status: "completed", usage: { video_frames_processed: 50 } } },
    ]);
    const fetch = mockFetch(() => sseResponse(text));
    const c = new MetaClient({ apiKey: "k", fetch, hooks: { onUsage: (e) => void events.push(e) } });
    const res = await c.segmentVideo({ fileId: "file-123", concept: "pelota" });
    expect(res.frames.map((f) => [f.frame, f.objects[0]!.box.x1])).toEqual([
      [0, 10],
      [1, 14],
      [3, 22],
    ]);
    expect(res.framesProcessed).toBe(50);
    const body = fetch.calls[0]!.json!;
    expect(body.metadata).toEqual({ mask_encoding: "one_bit" });
    expect((body.input as Array<{ content: unknown[] }>)[0]!.content[1]).toEqual({ type: "input_video", file_id: "file-123" });
    expect(events[0]).toMatchObject({ operation: "sam_video", units: { frames: 50 }, cost_usd: 0.01 });
  });

  it("valida la entrada antes de llamar", async () => {
    const fetch = mockFetch(() => sseResponse(""));
    const c = new MetaClient({ apiKey: "k", fetch });
    await expect(c.segmentImage({ image: new Uint8Array([1, 2, 3]), concept: "x" })).rejects.toThrow(/mimeType/);
    await expect(c.segmentImage({ image: "ftp://x", concept: "x" })).rejects.toThrow(/data URL/);
    await expect(c.segmentImage({ image: "https://e.com/a.png", concept: "  " })).rejects.toThrow(/concepto/);
    await expect(c.segmentVideo({ concept: "x" })).rejects.toThrow(/fileId o videoUrl/);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("eventos de la Responses API", () => {
  it("un evento error a mitad de stream es MetaApiError reintentable", async () => {
    const res = sseResponse(sseText([{ type: "error", code: "server_shutting_down", message: "apagando" }], false));
    const consume = async () => {
      for await (const evt of readResponsesEvents(res.body!, "req")) void evt;
    };
    const error = (await consume().catch((e: unknown) => e)) as MetaApiError;
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error.code).toBe("server_shutting_down");
    expect(error.retryable).toBe(true);
  });
});

describe("pixelado", () => {
  it("pixela solo los bloques que tocan la máscara", () => {
    const w = 8;
    const h = 4;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([i * 8, 0, 0, 255], i * 4);
    const mask = { width: 2, height: 2, data: new Uint8Array([1, 1, 1, 1]), left: 0, top: 0 };
    pixelateRGBA(rgba, w, h, { x1: 0, y1: 0, x2: 7, y2: 3 }, 4, mask);
    // Bloque 0 (x 0–3) toca la máscara: todos sus píxeles quedan iguales.
    const block0 = [0, 1, 2, 3, 8, 9, 10, 11].map((p) => rgba[p * 4]);
    expect(new Set(block0).size).toBe(1);
    // Bloque 1 (x 4–7) no la toca: queda intacto.
    expect(rgba[4 * 4]).toBe(32);
    expect(rgba[7 * 4]).toBe(56);
  });

  it("expandBox agrega margen sin salir de la imagen", () => {
    expect(expandBox({ x1: 0, y1: 10, x2: 9, y2: 19, w: 20, h: 25 }, 0.5)).toEqual({ x1: 0, y1: 5, x2: 14, y2: 24, w: 20, h: 25 });
  });
});
