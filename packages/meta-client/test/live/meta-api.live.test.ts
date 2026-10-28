/**
 * Pruebas contra la Meta Model API real (llamadas mínimas y baratas, < 0.05 USD por corrida).
 * Lee MODEL_API_KEY del entorno o de services/api/.dev.vars, sin imprimirla.
 * Corre con: pnpm --filter @blindaje/meta-client test:live
 * Pon LIVE_VIDEO=0 para saltar la prueba de video (0.01 USD).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { MetaClient, decodeMask, defineTool, maskToBox, type UsageEvent } from "../../src";
import { fixturesDir, loadModelApiKey } from "../helpers/env";
import { circleAndSquarePng } from "../helpers/png";

const apiKey = loadModelApiKey();
const usage: UsageEvent[] = [];
const client = apiKey ? new MetaClient({ apiKey, hooks: { onUsage: (e) => void usage.push(e) } }) : null;

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const observations: Array<{ label: string; data: unknown }> = [];
const log = (label: string, data: unknown) => void observations.push({ label, data });
const OBSERVATIONS_FILE = join(tmpdir(), "blindaje-meta-client-live.json");

describe.skipIf(!client)("Meta Model API (live)", () => {
  const c = client as MetaClient;

  afterAll(() => {
    const total = usage.reduce((n, e) => n + e.cost_usd, 0);
    log(
      "gasto",
      usage.map((e) => ({ model: e.model, operation: e.operation, status: e.status, units: e.units, cost_usd: e.cost_usd, request_id: e.request_id })),
    );
    // Vitest 4 no muestra el stdout de los tests que pasan: todo se imprime aquí y queda en un JSON.
    for (const o of observations) console.log(`[live] ${o.label}: ${JSON.stringify(o.data)}`);
    writeFileSync(OBSERVATIONS_FILE, JSON.stringify(observations, null, 2));
    console.log(`[live] costo total estimado: ${total.toFixed(6)} USD en ${usage.length} llamadas (detalle en ${OBSERVATIONS_FILE})`);
  });

  it("la llave funciona y lista los modelos (gratis)", async () => {
    const models = await c.listModels();
    log("modelos", models);
    expect(models).toContain("muse-spark-1.3");
    expect(models).toContain("sam-3.1");
  });

  it("salida estructurada strict con reasoning.effort minimal", async () => {
    const Ficha = z
      .object({
        canal: z.enum(["yape", "plin", "efectivo", "otro"]),
        monto_soles: z.number().nullable(),
        plazo_horas: z.number().nullable(),
        frases_firma: z.array(z.string()),
      })
      .strict();
    const res = await c.responses.parse(
      {
        model: "muse-spark-1.3",
        instructions: "Extrae los datos del mensaje ficticio. Usa null si un dato no aparece.",
        input: 'Mensaje (EV-A1): "Habla con el jefe. Yapea 500 soles de cupo en 48 horas o ya sabes."',
        schema: Ficha,
        schemaName: "ficha_minima",
        reasoningEffort: "minimal",
        max_output_tokens: 400,
      },
      { operation: "live_structured" },
    );
    log("structured", { output: res.output, usage: res.usage, cost: res.costUsd, outputTypes: res.response.output.map((o) => o.type) });
    expect(res.output.canal).toBe("yape");
    expect(res.output.monto_soles).toBe(500);
    expect(res.output.plazo_horas).toBe(48);
  });

  it("bucle de agente con dos herramientas y salida final con esquema", async () => {
    const casos: Record<string, { monto: number; canal: string }> = {
      "C-1": { monto: 300, canal: "yape" },
      "C-2": { monto: 450, canal: "yape" },
    };
    const result = await c.runAgent(
      {
        model: "muse-spark-1.3",
        instructions:
          "Eres un asistente de pruebas. Usa siempre las herramientas para obtener datos; no inventes. " +
          "Obtén los casos pedidos con obtener_caso (puedes pedir varios a la vez) y suma sus montos con sumar.",
        input: "¿Cuál es el monto total de los casos C-1 y C-2?",
        tools: [
          defineTool({
            name: "obtener_caso",
            description: "Devuelve el monto (en soles) y el canal de pago de un caso ficticio",
            parameters: z.object({ id: z.string().describe("Id del caso, por ejemplo C-1") }).strict(),
            handler: ({ id }) => casos[id] ?? { error: `No existe el caso ${id}` },
          }),
          defineTool({
            name: "sumar",
            description: "Suma una lista de números",
            parameters: z.object({ numeros: z.array(z.number()) }).strict(),
            handler: ({ numeros }) => ({ total: numeros.reduce((a, b) => a + b, 0) }),
          }),
        ],
        finalSchema: z.object({ casos: z.array(z.string()), total_soles: z.number() }).strict(),
        finalSchemaName: "total_casos",
        reasoningEffort: "low",
        maxTurns: 5,
      },
      { operation: "live_agent" },
    );
    log("agent", {
      output: result.output,
      turns: result.turns,
      trace: result.trace.map((t) => ({ turn: t.turn, name: t.name, args: t.arguments, ok: t.ok })),
      usage: result.usage,
    });
    expect(result.output.total_soles).toBe(750);
    expect(result.trace.some((t) => t.name === "obtener_caso")).toBe(true);
  });

  it("transcribe un WAV corto con diarización", async () => {
    const wav = new Uint8Array(readFileSync(join(fixturesDir, "dialogo.wav")));
    const res = await c.transcribe(
      wav,
      { mode: "DIARIZATION", languageBias: ["Spanish"], keywords: ["Yape", "yapear", "cupo", "soles", "el jefe"] },
      { operation: "live_transcribe" },
    );
    log("transcribe", res);
    expect(res.transcript.toLowerCase()).toContain("soles");
    expect(res.turns.length).toBeGreaterThanOrEqual(1);
    expect(res.audioDurationMs).toBeGreaterThan(13_000);
  });

  it("SAM 3.1 segmenta el círculo de una imagen generada", async () => {
    const res = await c.segmentImage(
      { image: circleAndSquarePng(), concept: "circle", includeConfidence: true },
      { operation: "live_sam_image" },
    );
    const summary = res.objects.map((o) => {
      const mask = decodeMask(o);
      return { id: o.id, box: o.box, confidence: o.confidence, mask: { w: mask.width, h: mask.height, on: mask.data.reduce((n, v) => n + v, 0) }, tight: maskToBox(o) };
    });
    log("sam_image", { objects: summary, usage: res.usage, problems: res.problems, rawPrefix: res.rawText.slice(0, 90) });
    expect(res.objects).toHaveLength(1);
    const box = res.objects[0]!.box;
    expect(Math.abs(box.x1 - 32)).toBeLessThanOrEqual(3);
    expect(Math.abs(box.x2 - 128)).toBeLessThanOrEqual(3);
    expect(box.w).toBe(256);
    expect(box.h).toBe(192);
  });

  it.skipIf(!hasFfmpeg || process.env.LIVE_VIDEO === "0")("SAM 3.1 en video: upload, segmentación por frames y borrado", async () => {
    // Clip de 2 s a 10 fps con la imagen de prueba fija (20 frames; se facturan 50).
    const dir = mkdtempSync(join(tmpdir(), "blindaje-sam-"));
    const png = join(dir, "frame.png");
    const mp4 = join(dir, "circulo.mp4");
    writeFileSync(png, circleAndSquarePng());
    try {
      execFileSync("ffmpeg", [
        "-loglevel", "error", "-y", "-loop", "1", "-framerate", "10", "-t", "2", "-i", png,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
      ]);
      const file = await c.files.upload(new Uint8Array(readFileSync(mp4)), { filename: "circulo.mp4", mimeType: "video/mp4", expiresAfterSeconds: 3600 });
      log("upload", file);
      try {
        const res = await c.segmentVideo({ fileId: file.id, concept: "circle" }, { operation: "live_sam_video" });
        log("sam_video", {
          frames: res.frames.length,
          frameIndexes: res.frames.map((f) => f.frame),
          firstFrame: res.frames[0] && { frame: res.frames[0].frame, objects: res.frames[0].objects.map((o) => ({ id: o.id, box: o.box })) },
          framesProcessed: res.framesProcessed,
          usage: res.usage,
          problems: res.problems,
        });
        expect(res.frames.length).toBeGreaterThanOrEqual(15);
        expect(res.frames[0]!.objects[0]!.box.w).toBe(256);
        expect(res.framesProcessed).toBe(50);
      } finally {
        const deleted = await c.files.delete(file.id);
        log("delete", deleted);
        expect(deleted.deleted).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("las salvaguardas bloquean contributor y web_search sin llamar a la API", async () => {
    await expect(c.responses.create({ model: "muse-spark-1.3-contributor", input: "x" })).rejects.toThrow(/Contributor/);
    await expect(c.responses.create({ model: "muse-spark-1.3", input: "x", tools: [{ type: "web_search" }] })).rejects.toThrow(/búsqueda web/);
  });
});
