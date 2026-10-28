/**
 * Captura el formato crudo de SAM 3.1 (SSE) y de Voice Transcribe (JSON) con `fetch` directo,
 * sin pasar por el cliente, y lo guarda en test/fixtures para los tests unitarios.
 * Costo aproximado: 2 imágenes SAM (0.005 USD) + 14 s de audio (0.0007 USD) + un video (0.01 USD).
 *
 * Uso: pnpm --filter @blindaje/meta-client exec tsx scripts/capture-fixtures.ts [all|image|transcribe|video-still|video-moving]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * Video: sube un MP4 con la Files API, segmenta por file_id y borra el archivo. 0.01 USD (mínimo
 * de 50 frames). `source` es "still" (la imagen de prueba fija, 2 s a 10 fps) o "moving" (un
 * cuadrado rojo que se desplaza).
 */
async function captureVideo(source: "still" | "moving", concept: string) {
  const dir = mkdtempSync(join(tmpdir(), "blindaje-cap-"));
  const mp4 = join(dir, "clip.mp4");
  const png = join(dir, "frame.png");
  writeFileSync(png, circleAndSquarePng());
  const input =
    source === "still"
      ? ["-loop", "1", "-framerate", "10", "-t", "2", "-i", png]
      : ["-f", "lavfi", "-i", "color=white:s=256x192:d=2:r=10", "-vf", "drawbox=x='10+t*60':y=60:w=64:h=64:color=red:t=fill"];
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  const multipart = buildMultipart([
    { name: "purpose", value: "user_data" },
    { name: "expires_after[anchor]", value: "created_at" },
    { name: "expires_after[seconds]", value: "3600" },
    { name: "file", value: new Uint8Array(readFileSync(mp4)), filename: "clip.mp4", contentType: "video/mp4" },
  ]);
  const up = await fetch("https://api.meta.ai/v1/files", {
    method: "POST",
    headers: { ...auth, "Content-Type": multipart.contentType },
    body: multipart.body,
  });
  const file = (await up.json()) as { id: string };
  console.log(`Upload: HTTP ${up.status}`, file);
  try {
    const res = await fetch("https://api.meta.ai/v1/responses", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: "sam-3.1",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, { type: "input_video", file_id: file.id }] }],
        stream: true,
        store: false,
        metadata: { mask_encoding: "one_bit" },
      }),
    });
    const text = await res.text();
    console.log(`SAM video ${source}: HTTP ${res.status}, ${text.length} bytes`);
    writeFileSync(join(fixturesDir, `sam-video-${source}.sse`), text);
  } finally {
    const del = await fetch(`https://api.meta.ai/v1/files/${file.id}`, { method: "DELETE", headers: auth });
    console.log(`Delete: HTTP ${del.status}`, await del.text());
    rmSync(dir, { recursive: true, force: true });
  }
}

const what = process.argv[2] ?? "all";
if (what === "all" || what === "image") {
  await captureSam("image-lossless-conf", { include_confidence: "true" });
  await captureSam("image-onebit", { mask_encoding: "one_bit" });
}
if (what === "all" || what === "transcribe") await captureTranscribe();
if (what === "all" || what === "video-still") await captureVideo("still", "circle");
if (what === "video-moving") await captureVideo("moving", "red square");
