import type { ContentPart } from "@blindaje/meta-client";
import {
  AnalisisForense,
  AUTENTICIDAD_SYSTEM,
  type NivelAutenticidad,
  type ResultadoAutenticidad,
  type SenalesTecnicas,
} from "@blindaje/shared";
import { costCacheKey, withCostCache } from "../costs";
import { readDerivativePlain, readEvidencePlain } from "../evidence";
import { sha256Hex } from "../lib/crypto";
import { bytesToB64 } from "../lib/encoding";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { parseWav, trimWav, wavDurationMs } from "../lib/wav";
import { once, type EvidenceCtx } from "./context";
import { errorCode } from "./errors";

/**
 * Paso `autenticidad` (después del procesamiento de cada audio, imagen o video): ¿el archivo
 * parece generado con IA o manipulado?
 *
 *  1. Señales técnicas del contenedor ML sobre el ORIGINAL (`/authenticity/{audio,image,video}`):
 *     marca de agua de Meta AudioSeal o Video Seal, credenciales C2PA, metadatos y, si existe, un
 *     detector de voz sintética.
 *  2. Análisis forense con Muse Spark (`AUTENTICIDAD_SYSTEM`, salida strict `AnalisisForense`,
 *     razonamiento bajo): el archivo como entrada y las señales técnicas en el texto.
 *     - Imagen y video: `muse-spark-1.3`.
 *     - Audio: `muse-spark-1.2`. La documentación oficial (video-understanding) dice que la 1.3 no
 *       tiene soporte completo de audio y que la calidad puede degradarse; recomienda la 1.2.
 *  3. Nivel final por reglas (`nivelFinal`): "generado_ia_confirmado" SOLO si la marca de agua o
 *     C2PA lo declaran; el modelo nunca puede confirmar por su cuenta.
 *  4. Derivado `autenticidad` (`ResultadoAutenticidad`), reemplazado en una sola transacción.
 *
 * Nunca rompe el caso: si fallan el ML y Meta, el paso queda "no analizado" (sin derivado). Si
 * falla solo uno, se guarda lo que sí se pudo medir (las fuentes que faltan quedan en null). La
 * llamada a Meta va con caché por SHA-256 del original (+ modelo, esfuerzo y señales técnicas).
 *
 * Privacidad: a Meta va el mismo medio que ya ve el resto del pipeline, nunca los metadatos:
 * imagen como JPEG normalizado sin EXIF (sin GPS), video re-codificado sin audio ni metadatos,
 * audio como el WAV mono de 16 kHz ya guardado. De los metadatos solo viajan en el texto el
 * software, el tipo de fuente digital, las alertas y los NOMBRES de los campos presentes.
 */

export const AUTENTICIDAD_MODEL_VISUAL = "muse-spark-1.3";
export const AUTENTICIDAD_MODEL_AUDIO = "muse-spark-1.2";
const EFFORT = "low" as const;
/** Cambiarla obliga a pagar el análisis forense de nuevo. */
const VARIANT = "v1";
/** Muse Spark es un modelo de razonamiento: el razonamiento comparte este presupuesto (doc: >= 4000). */
const MAX_OUTPUT_TOKENS = 4000;
/** Del audio se analizan los primeros 90 s (≈ 2.9 MB de WAV): acota costo y tamaño del cuerpo. */
export const MAX_AUDIO_MS = 90_000;
/** Imágenes más grandes que esto van por la Files API (mismo criterio que SAM en `image.ts`). */
const INLINE_IMAGE_MAX = 700 * 1024;
const VIDEO_FPS = 5;
const VIDEO_MAX_FRAMES = 300;

const RANK: Record<NivelAutenticidad, number> = {
  sin_senales: 0,
  indicios_debiles: 1,
  indicios_fuertes: 2,
  generado_ia_confirmado: 3,
};

export const SIN_SENALES_TECNICAS: SenalesTecnicas = { watermark: null, c2pa: null, metadata: null, synthetic_speech: null };

/** IPTC DigitalSourceType que declara contenido generado o compuesto con IA. */
const AI_SOURCE_TYPE = /trainedalgorithmicmedia|compositesynthetic|algorithmicmedia/i;

function maxNivel(a: NivelAutenticidad, b: NivelAutenticidad): NivelAutenticidad {
  return RANK[a] >= RANK[b] ? a : b;
}

/** La marca de agua detectada o C2PA que declara IA: lo único que permite decir "confirmado". */
export function confirmadoPorTecnicas(t: SenalesTecnicas): boolean {
  return t.watermark?.detected === true || t.c2pa?.ai_generated === true;
}

/** Nivel mínimo que imponen las señales técnicas que no confirman (metadatos, detector de voz). */
export function pisoTecnico(t: SenalesTecnicas): NivelAutenticidad {
  let n: NivelAutenticidad = "sin_senales";
  if (t.metadata?.digital_source_type && AI_SOURCE_TYPE.test(t.metadata.digital_source_type)) n = maxNivel(n, "indicios_fuertes");
  if (t.synthetic_speech?.available) {
    if (t.synthetic_speech.score >= 0.8) n = maxNivel(n, "indicios_fuertes");
    else if (t.synthetic_speech.score >= 0.5) n = maxNivel(n, "indicios_debiles");
  }
  if (t.metadata?.suspicious.length) n = maxNivel(n, "indicios_debiles");
  return n;
}

/**
 * Nivel final:
 * - "generado_ia_confirmado" si y solo si la marca de agua o C2PA lo dicen;
 * - si no, el mayor entre lo que vio el modelo (sin poder confirmar: a lo más "indicios_fuertes")
 *   y el piso de las señales técnicas.
 */
export function nivelFinal(t: SenalesTecnicas, forense: AnalisisForense | null): NivelAutenticidad {
  if (confirmadoPorTecnicas(t)) return "generado_ia_confirmado";
  const modelo = forense ? (forense.nivel === "generado_ia_confirmado" ? "indicios_fuertes" : forense.nivel) : "sin_senales";
  return maxNivel(modelo, pisoTecnico(t));
}

/** Indicios fuertes o marca de IA: baja el peso de la voz al vincular y avisa en la cola. */
export function esIndicioFuerte(nivel: NivelAutenticidad | null | undefined): boolean {
  return nivel === "indicios_fuertes" || nivel === "generado_ia_confirmado";
}

// ---------------------------------------------------------------------------
// Privacidad de los metadatos
// ---------------------------------------------------------------------------

/** Campos de metadatos que nunca se guardan ni se muestran: ubicación, dueño o serie del equipo. */
const PRIVATE_FIELD = /gps|latitud|longitud|latitude|longitude|location|ubicaci|address|serial|owner|author|artist|creator|by-?line|copyright|contact|e-?mail|phone|tel[eé]fono|user|account|uuid|unique|device.?id|imei|host/i;
const MAX_FIELDS = 30;
const MAX_VALUE = 160;

/** Quita de las señales técnicas los metadatos que podrían ubicar o identificar a alguien. */
export function sanitizeTecnicas(t: SenalesTecnicas): SenalesTecnicas {
  if (!t.metadata) return t;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.metadata.fields)) {
    if (Object.keys(fields).length >= MAX_FIELDS) break;
    if (PRIVATE_FIELD.test(k)) continue;
    fields[k.slice(0, 60)] = String(v).slice(0, MAX_VALUE);
  }
  return {
    ...t,
    metadata: {
      ...t.metadata,
      software: t.metadata.software?.slice(0, MAX_VALUE) ?? null,
      digital_source_type: t.metadata.digital_source_type?.slice(0, MAX_VALUE) ?? null,
      suspicious: t.metadata.suspicious.slice(0, 10).map((s) => s.slice(0, MAX_VALUE)),
      fields,
    },
  };
}

// ---------------------------------------------------------------------------
// Texto para el modelo
// ---------------------------------------------------------------------------

const TIPO_TEXTO: Record<ResultadoAutenticidad["tipo"], string> = { audio: "audio", imagen: "imagen", video: "video" };

/** Señales técnicas en palabras (sin valores de metadatos salvo software y tipo de fuente). */
export function describeTecnicas(t: SenalesTecnicas, tipo: ResultadoAutenticidad["tipo"]): string[] {
  const out: string[] = [];
  const detector = tipo === "audio" ? "AudioSeal" : tipo === "video" ? "Video Seal" : "marca de agua";
  out.push(
    t.watermark
      ? `- Marca de agua de IA (${t.watermark.detector}): ${t.watermark.detected ? "DETECTADA" : "no detectada"}, puntaje ${t.watermark.score.toFixed(2)}` +
          (t.watermark.frames_checked != null ? `, ${t.watermark.frames_checked} cuadros revisados.` : ".")
      : `- Marca de agua de IA (${detector}): no se pudo revisar.`,
  );
  if (!t.c2pa) out.push("- Credenciales de contenido C2PA: no se pudieron revisar.");
  else if (!t.c2pa.present) out.push("- Credenciales de contenido C2PA: el archivo no trae.");
  else {
    const ia = t.c2pa.ai_generated === true ? "sí" : t.c2pa.ai_generated === false ? "no" : "no lo dice";
    out.push(
      `- Credenciales C2PA presentes. Generador: ${t.c2pa.generator ?? "sin dato"}. ¿Declaran contenido generado con IA?: ${ia}.` +
        (t.c2pa.claims.length ? ` Afirmaciones: ${t.c2pa.claims.slice(0, 8).join("; ")}.` : ""),
    );
  }
  if (!t.metadata) out.push("- Metadatos: no se pudieron revisar.");
  else if (!t.metadata.present) out.push("- Metadatos: el archivo no trae metadatos.");
  else {
    const nombres = Object.keys(t.metadata.fields).slice(0, 20);
    out.push(
      `- Metadatos: software ${t.metadata.software ? `"${t.metadata.software}"` : "sin dato"}; tipo de fuente digital ${t.metadata.digital_source_type ?? "sin dato"}; ` +
        `alertas: ${t.metadata.suspicious.length ? t.metadata.suspicious.join("; ") : "ninguna"}; campos presentes: ${nombres.length ? nombres.join(", ") : "ninguno"}.`,
    );
  }
  if (tipo === "audio") {
    out.push(
      t.synthetic_speech?.available
        ? `- Detector de voz sintética (${t.synthetic_speech.detector}): puntaje ${t.synthetic_speech.score.toFixed(2)} (0 = natural, 1 = sintética).`
        : "- Detector de voz sintética: no disponible.",
    );
  }
  return out;
}

function promptFor(ctx: EvidenceCtx, tipo: ResultadoAutenticidad["tipo"], tecnicas: SenalesTecnicas, nota: string): string {
  const confirmado = confirmadoPorTecnicas(tecnicas);
  return [
    `Evidencia ${ctx.ev.label} (${TIPO_TEXTO[tipo]}) de un caso de extorsión.${ctx.caso.is_demo ? " Contenido ficticio de demostración." : ""}`,
    "",
    "Señales técnicas ya medidas sobre el archivo original:",
    ...describeTecnicas(tecnicas, tipo),
    "",
    `Cómo llega el archivo adjunto: ${nota}`,
    "",
    confirmado
      ? "La marca de agua o C2PA declaran IA: puedes usar \"generado_ia_confirmado\"."
      : "Ni la marca de agua ni C2PA declaran IA: NO uses \"generado_ia_confirmado\"; usa \"sin_senales\", \"indicios_debiles\" o \"indicios_fuertes\".",
    "Analiza el archivo adjunto y devuelve el JSON con el esquema indicado. En \"senales\" pon solo lo que observaste (fuente analisis_visual o analisis_audio) y las señales técnicas que pesen; si no observas nada, deja la lista vacía.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Medio para Muse Spark
// ---------------------------------------------------------------------------

interface MediaInput {
  model: string;
  part: () => Promise<ContentPart>;
  nota: string;
  cleanup: () => Promise<void>;
}

async function mediaFor(ctx: EvidenceCtx, original: ArrayBuffer): Promise<MediaInput> {
  const { env, ev, meta } = ctx;
  const ml = ctx.ml;
  if (!ml) throw new Error("ml_requerido");
  if (ev.tipo === "audio") {
    const row = await env.DB.prepare("SELECT id, r2_key FROM derivatives WHERE evidence_id = ? AND tipo = 'wav' LIMIT 1")
      .bind(ev.id)
      .first<{ id: string; r2_key: string | null }>();
    let wav = row ? await readDerivativePlain(env, row) : null;
    if (!wav) wav = (await ml.normalizeAudio(original)).wav;
    const info = parseWav(wav);
    const total = info ? wavDurationMs(info) : null;
    const trimmed = total != null && total > MAX_AUDIO_MS ? trimWav(wav, 0, MAX_AUDIO_MS) : null;
    const bytes = new Uint8Array(trimmed ?? wav);
    // `input_audio` existe en la Responses API (documentación de video y audio) pero no está en los
    // tipos de @blindaje/meta-client: el cliente lo envía tal cual.
    const part = { type: "input_audio", input_audio: { data: bytesToB64(bytes), format: "wav" } } as unknown as ContentPart;
    return {
      model: AUTENTICIDAD_MODEL_AUDIO,
      part: async () => part,
      nota: `WAV mono de 16 kHz convertido del original (se pierden las frecuencias altas)${trimmed ? `; solo los primeros ${MAX_AUDIO_MS / 1000} s` : ""}.`,
      cleanup: async () => undefined,
    };
  }
  if (ev.tipo === "imagen") {
    // JPEG normalizado: orientación aplicada y SIN metadatos (GPS, equipo), igual que para SAM.
    const jpeg = new Uint8Array(await ml.imageRedact({ image_b64: bytesToB64(new Uint8Array(original)), regions: [] }));
    const inline = jpeg.byteLength <= INLINE_IMAGE_MAX;
    const fileId = once(async () => (await meta.files.upload(jpeg, { filename: `${ev.id}.jpg`, mimeType: "image/jpeg", expiresAfterSeconds: 3600 })).id);
    let uploaded = false;
    return {
      model: AUTENTICIDAD_MODEL_VISUAL,
      part: async () => {
        if (inline) return { type: "input_image", image_url: `data:image/jpeg;base64,${bytesToB64(jpeg)}`, detail: "high" };
        uploaded = true;
        return { type: "input_image", file_id: await fileId(), detail: "high" };
      },
      nota: "JPEG re-codificado sin metadatos (privacidad); la re-compresión puede borrar rastros finos de edición.",
      cleanup: async () => {
        if (uploaded) await meta.files.delete(await fileId()).catch(() => undefined);
      },
    };
  }
  // Video: re-codificado (H.264, sin audio ni metadatos) y subido con la Files API.
  const sample = await ml.videoSample(original, { fps: VIDEO_FPS, max_frames: VIDEO_MAX_FRAMES });
  const fileId = once(async () => (await meta.files.upload(new Uint8Array(sample.mp4), { filename: `${ev.id}.mp4`, mimeType: "video/mp4", expiresAfterSeconds: 3600 })).id);
  let uploaded = false;
  return {
    model: AUTENTICIDAD_MODEL_VISUAL,
    part: async () => {
      uploaded = true;
      return { type: "input_video", file_id: await fileId() };
    },
    nota: `video re-codificado a ${VIDEO_FPS} cuadros por segundo (máx. ${VIDEO_MAX_FRAMES}), sin audio y sin metadatos (privacidad).`,
    cleanup: async () => {
      if (uploaded) await meta.files.delete(await fileId()).catch(() => undefined);
    },
  };
}

/** Análisis forense con Muse Spark (con caché: reprocesar el mismo archivo no vuelve a pagar). */
async function forensicAnalysis(
  ctx: EvidenceCtx,
  tipo: ResultadoAutenticidad["tipo"],
  original: ArrayBuffer,
  tecnicas: SenalesTecnicas,
): Promise<{ forense: AnalisisForense; model: string }> {
  const model = ctx.ev.tipo === "audio" ? AUTENTICIDAD_MODEL_AUDIO : AUTENTICIDAD_MODEL_VISUAL;
  const tecnicasKey = await sha256Hex(JSON.stringify(describeTecnicas(tecnicas, tipo)));
  const cacheKey = await costCacheKey(ctx.ev.sha256, "autenticidad", `${VARIANT}:${model}:${EFFORT}:${tecnicasKey}`);
  const forense = await withCostCache<AnalisisForense>(
    ctx.env,
    { cache_key: cacheKey, model, operation: "autenticidad", case_id: ctx.caso.id },
    async () => {
      const media = await mediaFor(ctx, original);
      try {
        const content: ContentPart[] = [{ type: "input_text", text: promptFor(ctx, tipo, tecnicas, media.nota) }, await media.part()];
        const r = await ctx.meta.responses.parse(
          {
            model: media.model,
            instructions: AUTENTICIDAD_SYSTEM,
            input: [{ role: "user", content }],
            schema: AnalisisForense,
            schemaName: "autenticidad",
            reasoningEffort: EFFORT,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            store: false,
          },
          { operation: "autenticidad", context: { case_id: ctx.caso.id, cache_key: cacheKey } },
        );
        return r.output;
      } finally {
        await media.cleanup();
      }
    },
  );
  return { forense, model };
}

const TIPOS: Record<string, ResultadoAutenticidad["tipo"]> = { audio: "audio", imagen: "imagen", video: "video" };

/**
 * Corre el análisis de autenticidad de una evidencia y guarda el derivado. Nunca lanza: devuelve
 * el resultado guardado, o null si la evidencia no aplica o quedó "no analizada".
 */
export async function analyzeAuthenticity(ctx: EvidenceCtx): Promise<ResultadoAutenticidad | null> {
  const { env, ev } = ctx;
  const tipo = TIPOS[ev.tipo];
  if (!tipo || !ctx.ml) return null;
  const started = Date.now();
  try {
    const original = await readEvidencePlain(env, ev);
    if (!original) return null;

    let tecnicas = SIN_SENALES_TECNICAS;
    let mlOk = false;
    try {
      const body = new Uint8Array(original);
      const raw = tipo === "audio" ? await ctx.ml.authenticityAudio(body, ev.mime) : tipo === "imagen" ? await ctx.ml.authenticityImage(body, ev.mime) : await ctx.ml.authenticityVideo(body, ev.mime);
      tecnicas = sanitizeTecnicas(raw);
      mlOk = true;
    } catch (err) {
      log("warn", "authenticity_ml_failed", { evidence_id: ev.id, tipo, ...errorFields(err) });
    }

    let forense: AnalisisForense | null = null;
    let model: string | null = null;
    try {
      const r = await forensicAnalysis(ctx, tipo, original, tecnicas);
      // El modelo nunca confirma por su cuenta: su nivel se recorta igual que el final.
      const capped = confirmadoPorTecnicas(tecnicas) || r.forense.nivel !== "generado_ia_confirmado" ? r.forense.nivel : "indicios_fuertes";
      forense = { ...r.forense, nivel: capped };
      model = r.model;
    } catch (err) {
      log("warn", "authenticity_meta_failed", { evidence_id: ev.id, tipo, error_code: errorCode(err), ...errorFields(err) });
    }

    if (!mlOk && !forense) {
      log("warn", "authenticity_not_analyzed", { evidence_id: ev.id, tipo });
      return null;
    }
    const result: ResultadoAutenticidad = {
      evidence_label: ev.label,
      tipo,
      nivel: nivelFinal(tecnicas, forense),
      tecnicas,
      forense,
      model,
      analizado_at: nowIso(),
    };
    await env.DB.batch([
      env.DB.prepare("DELETE FROM derivatives WHERE evidence_id = ? AND tipo = 'autenticidad'").bind(ev.id),
      env.DB.prepare("INSERT INTO derivatives (id, evidence_id, case_id, tipo, content_json, r2_key, created_at) VALUES (?, ?, ?, 'autenticidad', ?, NULL, ?)").bind(
        newId(),
        ev.id,
        ev.case_id,
        JSON.stringify(result),
        nowIso(),
      ),
    ]);
    log("info", "authenticity_analyzed", {
      evidence_id: ev.id,
      tipo,
      nivel: result.nivel,
      ml: mlOk,
      forense: Boolean(forense),
      model,
      ms: Date.now() - started,
    });
    return result;
  } catch (err) {
    log("warn", "authenticity_failed", { evidence_id: ev.id, tipo, ...errorFields(err) });
    return null;
  }
}
