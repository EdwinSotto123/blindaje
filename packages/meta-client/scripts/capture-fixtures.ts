/**
 * Captura el formato crudo de SAM 3.1 (SSE) y de Voice Transcribe (JSON) con `fetch` directo,
 * sin pasar por el cliente, y lo guarda en test/fixtures para los tests unitarios.
 * Costo aproximado: 2 imágenes SAM (0.005 USD) + 14 s de audio (0.0007 USD).
 *
 * Uso: pnpm --filter @blindaje/meta-client exec tsx scripts/capture-fixtures.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToDataUrl, buildMultipart } from "../src/bytes";
import { fixturesDir, loadModelApiKey } from "../test/helpers/env";
import { circleAndSquarePng } from "../test/helpers/png";

const key = loadModelApiKey();
if (!key) throw new Error("Falta MODEL_API_KEY (env o services/api/.dev.vars)");
const auth = { Authorization: `Bearer ${key}` };

async function captureSam(name: string, metadata: Record<string, string>) {
  const res = await fetch("https://api.meta.ai/v1/responses", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      model: "sam-3.1",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "circle" },
            { type: "input_image", image_url: bytesToDataUrl(circleAndSquarePng(), "image/png") },
          ],
        },
      ],
      stream: true,
      store: false,
      metadata,
    }),
  });
  const text = await res.text();
  console.log(`SAM ${name}: HTTP ${res.status}, content-type=${res.headers.get("content-type")}, x-request-id=${res.headers.get("x-request-id")}, ${text.length} bytes`);
  writeFileSync(join(fixturesDir, `sam-${name}.sse`), text);
}

async function captureTranscribe() {
  const wav = readFileSync(join(fixturesDir, "dialogo.wav"));
  const multipart = buildMultipart([
    {
      name: "request",
      value: JSON.stringify({
        model: "muse-voice-transcribe-1.0",
        mode: "DIARIZATION",
        audioEncoding: "WAV",
        languageBias: ["Spanish"],
        keywords: ["Yape", "yapear", "cupo", "soles", "el jefe"],
      }),
      contentType: "application/json",
    },
    { name: "audio", value: new Uint8Array(wav), filename: "dialogo.wav", contentType: "audio/wav" },
  ]);
  const res = await fetch("https://api.meta.ai/v1/asr/transcribe", {
    method: "POST",
    headers: { ...auth, "Content-Type": multipart.contentType, Accept: "application/json" },
    body: multipart.body,
  });
  const text = await res.text();
  console.log(`Transcribe: HTTP ${res.status}, content-type=${res.headers.get("content-type")}, x-request-id=${res.headers.get("x-request-id")}`);
  writeFileSync(join(fixturesDir, "transcribe-diarization.json"), text);
}

await captureSam("image-lossless-conf", { include_confidence: "true" });
await captureSam("image-onebit", { mask_encoding: "one_bit" });
await captureTranscribe();
