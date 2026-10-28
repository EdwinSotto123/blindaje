import { MetaGuardError } from "./errors";

/**
 * Precios pay-as-you-go en modo estándar (https://dev.meta.ai/docs/pricing-rate-limits,
 * verificados el 2026-10-28). Los modelos contributor no tienen precio aquí a propósito: están
 * prohibidos en Blindaje.
 */

export const MODELS = {
  spark: "muse-spark-1.3",
  sparkAudio: "muse-spark-1.2",
  wonder: "muse-wonder-1.0",
  transcribe: "muse-voice-transcribe-1.0",
  sam: "sam-3.1",
  image: "muse-image-1.0",
} as const;

/** Unidades facturables de una llamada. Los nombres coinciden con las columnas de `api_costs`. */
export interface UsageUnits {
  input_tokens?: number;
  output_tokens?: number;
  /** Subconjunto de input_tokens servido desde caché (se cobra a la tarifa de caché). */
  cached_tokens?: number;
  /** Subconjunto de output_tokens dedicado a razonamiento (ya incluido en output_tokens). */
  reasoning_tokens?: number;
  images?: number;
  frames?: number;
  audio_seconds?: number;
}

export type ModelPrice =
  | { kind: "tokens"; inputPerMillion: number; outputPerMillion: number; cachedPerMillion: number }
  | { kind: "sam"; perImage: number; perFrame: number; minFramesPerVideoRequest: number }
  | { kind: "audio"; perHour: number }
  | { kind: "image"; perImage: number };

const SPARK: ModelPrice = { kind: "tokens", inputPerMillion: 1.25, outputPerMillion: 4.25, cachedPerMillion: 0.15 };
const WONDER: ModelPrice = { kind: "tokens", inputPerMillion: 4, outputPerMillion: 20, cachedPerMillion: 0.2 };
const SAM: ModelPrice = { kind: "sam", perImage: 2.5 / 1000, perFrame: 0.2 / 1000, minFramesPerVideoRequest: 50 };
const TRANSCRIBE: ModelPrice = { kind: "audio", perHour: 0.18 };
const IMAGE: ModelPrice = { kind: "image", perImage: 0.01 };

export const PRICING: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "muse-spark-1.3": SPARK,
  "muse-spark-1.2": SPARK,
  "muse-spark-1.1": SPARK,
  "muse-wonder-1.0": WONDER,
  "sam-3.1": SAM,
  "muse-voice-transcribe-1.0": TRANSCRIBE,
  "muse-image-1.0": IMAGE,
});

/** Modelos que el sistema bloquea al pasar el 80% del presupuesto. */
export const NON_ESSENTIAL_MODELS: ReadonlySet<string> = new Set(["muse-wonder-1.0", "muse-image-1.0"]);

export function isEssentialModel(model: string): boolean {
  return !NON_ESSENTIAL_MODELS.has(model) && !/^muse-(wonder|image)-/.test(model);
}

/** Precio de un modelo; acepta versiones nuevas de una familia conocida (p. ej. muse-spark-1.4). */
export function priceFor(model: string): ModelPrice {
  if (/contributor/i.test(model)) {
    throw new MetaGuardError("contributor_model_forbidden", `El modelo ${model} es de Contributor mode y está prohibido`);
  }
  const exact = PRICING[model];
  if (exact) return exact;
  if (model.startsWith("muse-spark-")) return SPARK;
  if (model.startsWith("muse-wonder-")) return WONDER;
  if (model.startsWith("sam-")) return SAM;
  if (model.startsWith("muse-voice-transcribe-")) return TRANSCRIBE;
  if (model.startsWith("muse-image-")) return IMAGE;
  throw new MetaGuardError("unknown_model_pricing", `No hay precio registrado para el modelo ${model}`);
}

const nonNegative = (n: number | undefined): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
const round = (usd: number): number => Math.round(usd * 1e8) / 1e8;

/**
 * Costo estimado en USD de una llamada.
 *
 * - Tokens: (input − cached) a tarifa de entrada + cached a tarifa de caché + output a tarifa de
 *   salida. Los tokens de razonamiento ya vienen dentro de output_tokens.
 * - SAM: imágenes a 2.50 por 1,000; frames de video a 0.20 por 1,000 con mínimo 50 por petición
 *   (si `frames` > 0 se asume una petición de video).
 * - Transcribe: 0.18 por hora, por segundo entero (se redondea hacia abajo).
 * - Muse Image: 0.01 por imagen.
 */
export function estimateCost(model: string, units: UsageUnits): number {
  const price = priceFor(model);
  switch (price.kind) {
    case "tokens": {
      const input = nonNegative(units.input_tokens);
      const cached = Math.min(nonNegative(units.cached_tokens), input);
      const output = nonNegative(units.output_tokens);
      return round(
        ((input - cached) * price.inputPerMillion + cached * price.cachedPerMillion + output * price.outputPerMillion) /
          1_000_000,
      );
    }
    case "sam": {
      const images = nonNegative(units.images);
      const frames = nonNegative(units.frames);
      const billedFrames = frames > 0 ? Math.max(frames, price.minFramesPerVideoRequest) : 0;
      return round(images * price.perImage + billedFrames * price.perFrame);
    }
    case "audio":
      return round((Math.floor(nonNegative(units.audio_seconds)) * price.perHour) / 3600);
    case "image":
      return round(nonNegative(units.images) * price.perImage);
  }
}
