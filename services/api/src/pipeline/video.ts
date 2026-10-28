import { costCacheKey, withCostCache } from "../costs";
import { readEvidencePlain } from "../evidence";
import { bytesToB64 } from "../lib/encoding";
import { ApiError } from "../lib/errors";
import { errorFields, log } from "../lib/log";
import type { Box } from "../ml/client";
import { once, requireMl, type EvidenceCtx } from "./context";
import { isPermanentPipelineError } from "./errors";
import { lecturaContent, readCrops, SAM_MODEL, storeCrops } from "./image";
import { binaryDerivative, commitWrites, emptyWrites, jsonDerivative, previousOutputs } from "./store";
import type { FramesContent } from "./types";

/**
 * Video (sección 7.4.5): muestreo a 5 fps en el contenedor (H.264 faststart), subida con la Files
 * API y SAM 3.1 en modo video solo para placa y rostro (cada petición se cobra con un mínimo de 50
 * frames). Del mejor cuadro de la placa se hace un recorte que lee Muse Spark; la placa pasa a la
 * ficha. El cuadro guardado lleva los rostros tapados.
 */

const FPS = 5;
const MAX_FRAMES = 300;

interface VideoTrack {
  frames: Array<{ frame: number; objects: Array<{ box: Box; score: number | null }> }>;
  frames_processed: number | null;
}

export async function processVideo(ctx: EvidenceCtx): Promise<void> {
  const { env, ev, caso, meta } = ctx;
  const ml = requireMl(ctx);
  const original = await readEvidencePlain(env, ev);
  if (!original) throw new ApiError("not_found", "No se encontró el archivo de la evidencia");
  const sample = await ml.videoSample(original, { fps: FPS, max_frames: MAX_FRAMES });

  const fileId = once(async () => (await meta.files.upload(new Uint8Array(sample.mp4), { filename: `${ev.id}.mp4`, mimeType: "video/mp4", expiresAfterSeconds: 3600 })).id);
  let uploaded = false;
  const track = async (concept: string): Promise<VideoTrack> => {
    const cacheKey = await costCacheKey(ev.sha256, "sam_video", `v1:${FPS}:${MAX_FRAMES}:${concept}`);
    return withCostCache<VideoTrack>(env, { cache_key: cacheKey, model: SAM_MODEL, operation: "sam_video", case_id: caso.id }, async () => {
      const id = await fileId();
      uploaded = true;
      const r = await meta.segmentVideo(
        { fileId: id, concept, includeConfidence: true },
        { operation: "sam_video", context: { case_id: caso.id, cache_key: cacheKey } },
      );
      return {
        frames: r.frames.map((f) => ({
          frame: f.frame,
          objects: f.objects.map((o) => ({ box: { x1: o.box.x1, y1: o.box.y1, x2: o.box.x2, y2: o.box.y2 }, score: o.confidence ?? null })),
        })),
        frames_processed: r.framesProcessed,
      };
    });
  };
  let plates: VideoTrack;
  let faces: VideoTrack;
  try {
    [plates, faces] = await Promise.all([track("license plate"), track("face")]);
  } finally {
    if (uploaded) await meta.files.delete(await fileId()).catch(() => undefined);
  }

  // Mejor cuadro de la placa: confianza × área.
  let best: { frame: number; box: Box; score: number | null } | null = null;
  let bestValue = 0;
  for (const f of plates.frames) {
    for (const o of f.objects) {
      const area = Math.max(1, (o.box.x2 - o.box.x1) * (o.box.y2 - o.box.y1));
      const value = (o.score ?? 0.5) * area;
      if (value > bestValue) {
        bestValue = value;
        best = { frame: f.frame, box: o.box, score: o.score };
      }
    }
  }

  const w = emptyWrites();
  let placas: string[] = [];
  if (best) {
    const frameJpeg = new Uint8Array(await ml.videoFrame(sample.mp4, { index: best.frame, fps: FPS }));
    const faceBoxes = faces.frames.find((f) => f.frame === best!.frame)?.objects.map((o) => o.box) ?? [];
    const safeFrame = faceBoxes.length ? new Uint8Array(await ml.imageRedact({ image_b64: bytesToB64(frameJpeg), regions: faceBoxes })) : frameJpeg;
    const crops = await ml.imageCrops({ image_b64: bytesToB64(safeFrame), boxes: [{ ...best.box, concept: "placa de vehículo" }] });
    await storeCrops(
      ctx,
      w,
      crops.model,
      crops.crops.map((c) => ({ concept: c.concept, box: c.box, score: best!.score, phash: c.phash, vector: c.vector, jpeg_b64: c.crop_jpeg_b64 })),
    );
    await binaryDerivative(env, w, ev, "redactada", safeFrame, { regiones: faceBoxes.length, nota: faceBoxes.length ? "Tapamos rostros en el cuadro guardado" : null });
    try {
      const lectura = await readCrops(
        ctx,
        crops.crops.map((c) => ({ kind: "placa" as const, jpeg_b64: c.crop_jpeg_b64 })),
        `video:${best.frame}`,
      );
      placas = lectura.placas;
      if (lectura.placas.length || lectura.notas.length) jsonDerivative(env, w, ev, "lectura", lecturaContent(lectura));
    } catch (err) {
      log("warn", "video_read_failed", { evidence_id: ev.id, ...errorFields(err) });
      if (!isPermanentPipelineError(err)) throw err;
    }
  }

  const content: FramesContent = {
    fps: sample.fps,
    frames: sample.frames,
    width: sample.width,
    height: sample.height,
    frames_facturados: (plates.frames_processed ?? 0) + (faces.frames_processed ?? 0),
    placa: best,
    rostros_en_frames: faces.frames.filter((f) => f.objects.length > 0).length,
    nota: placas.length ? `Leímos la placa ${placas.join(", ")}` : best ? "Encontramos una placa de vehículo" : null,
  };
  jsonDerivative(env, w, ev, "frames", content);
  const prev = await previousOutputs(env, ev.id);
  await commitWrites(env, prev, w);
  log("info", "video_processed", { evidence_id: ev.id, frames: sample.frames, plate: Boolean(best), placas: placas.length });
}
