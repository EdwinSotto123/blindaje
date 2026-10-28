/**
 * Prueba de humo del cliente contra la Meta Model API real.
 *
 *   pnpm --filter @blindaje/meta-client smoke            # modelos (gratis) + una salida estructurada (~0.002 USD)
 *   pnpm --filter @blindaje/meta-client smoke -- --all   # además Transcribe (~0.0007) y SAM en imagen (0.0025)
 *
 * Lee MODEL_API_KEY del entorno o de services/api/.dev.vars y nunca la imprime.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MetaClient, MetaGuardError, decodeMask, type UsageEvent } from "../src";
import { fixturesDir, loadModelApiKey } from "../test/helpers/env";
import { circleAndSquarePng } from "../test/helpers/png";

const apiKey = loadModelApiKey();
if (!apiKey) {
  console.error("Falta MODEL_API_KEY (variable de entorno o services/api/.dev.vars)");
  process.exit(1);
}
const all = process.argv.includes("--all");
const usage: UsageEvent[] = [];
const client = new MetaClient({ apiKey, hooks: { onUsage: (e) => void usage.push(e) } });

const step = async (name: string, fn: () => Promise<string>) => {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`ok   ${name} (${Date.now() - started} ms): ${result}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};

await step("modelos", async () => (await client.listModels()).filter((m) => !m.includes("contributor")).join(", "));

await step("salvaguarda contributor", async () => {
  try {
    await client.responses.create({ model: "muse-spark-1.3-contributor", input: "x" });
    throw new Error("no se bloqueó");
  } catch (error) {
    if (error instanceof MetaGuardError && error.code === "contributor_model_forbidden") return "bloqueado localmente";
    throw error;
  }
});

await step("salida estructurada", async () => {
  const res = await client.responses.parse({
    model: "muse-spark-1.3",
    instructions: "Clasifica el mensaje ficticio.",
    input: 'Mensaje: "Yapea 200 soles hoy o ya sabes."',
    schema: z.object({ canal: z.enum(["yape", "plin", "otro"]), monto_soles: z.number().nullable() }).strict(),
    schemaName: "smoke",
    reasoningEffort: "minimal",
    max_output_tokens: 300,
  });
  return JSON.stringify(res.output);
});

if (all) {
  await step("transcribe", async () => {
    const wav = new Uint8Array(readFileSync(join(fixturesDir, "dialogo.wav")));
    const res = await client.transcribe(wav, { languageBias: ["Spanish"], keywords: ["Yape", "cupo"] });
    return res.turns.map((t) => `${t.speaker ?? "?"}[${t.startMs}-${t.endMs}]: ${t.transcript}`).join(" | ");
  });
  await step("SAM imagen", async () => {
    const res = await client.segmentImage({ image: circleAndSquarePng(), concept: "circle", includeConfidence: true });
    return res.objects
      .map((o) => `id=${o.id} caja=${o.box.x1},${o.box.y1}-${o.box.x2},${o.box.y2} c=${o.confidence?.toFixed(2)} máscara=${decodeMask(o).data.length}px`)
      .join("; ");
  });
}

const total = usage.reduce((n, e) => n + e.cost_usd, 0);
console.log(`\n${usage.length} llamadas facturables, costo estimado ${total.toFixed(6)} USD`);
for (const e of usage) console.log(`  ${e.model} ${e.operation} ${e.status} ${e.cost_usd.toFixed(6)} USD ${JSON.stringify(e.units)}`);
