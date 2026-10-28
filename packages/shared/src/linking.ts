import { z } from "zod";

/**
 * Motor de vinculación (sección 9). Fase 1: cada señal se calibra a una probabilidad pᵢ
 * y se combinan con 1 − ∏(1 − pᵢ). Los parámetros viven en KV (`calibration:v1`) y salen
 * de la evaluación (eval/report.json).
 */

export const VoiceSignal = z.object({
  p: z.number(),
  similitud: z.number().describe("Coseno entre centroides"),
  z: z.number().nullable().describe("Puntaje normalizado contra la cohorte de referencia"),
  segmentos: z.number().describe("Segmentos de >= 3 s que superan el umbral"),
  segmentos_total: z.number(),
  huellas: z.array(z.string()).describe("V-… comparadas"),
  evidencia: z.array(z.string()),
  /** Segmentos que coinciden (de ambos casos), para los fragmentos de audio de la consola. */
  segmentos_coincidentes: z
    .array(
      z.object({
        huella: z.string(),
        evidencia: z.string(),
        evidence_id: z.string(),
        start_ms: z.number(),
        end_ms: z.number(),
        similitud: z.number(),
      }),
    )
    .optional(),
});

export const IdentifierSignal = z.object({
  p: z.number(),
  compartidos: z.array(
    z.object({ ref: z.string(), tipo: z.string(), ultimos_3: z.string(), evidencia: z.array(z.string()) }),
  ),
});

export const ImageSignal = z.object({
  p: z.number(),
  hamming_min: z.number().nullable(),
  dino_max: z.number().nullable(),
  recortes: z.array(z.string()).describe("IMG-… comparados"),
  evidencia: z.array(z.string()),
});

export const MoSignal = z.object({
  p: z.number(),
  similitud_texto: z.number(),
  frases_comunes: z.array(z.string()),
  mismo_canal_pago: z.boolean(),
  mismo_grupo: z.boolean(),
});

export const Signals = z.object({
  identificador: IdentifierSignal.optional(),
  voz: VoiceSignal.optional(),
  imagen: ImageSignal.optional(),
  modus_operandi: MoSignal.optional(),
});
export type Signals = z.infer<typeof Signals>;

export const Calibration = z.object({
  version: z.string(),
  updated_at: z.string(),
  source: z.string().describe("De dónde salieron los parámetros: eval/report.json o valores iniciales"),
  thresholds: z.object({ probable: z.number(), revisar: z.number() }),
  /** Logística sobre la similitud coseno de voz: p = 1 / (1 + e^-(a·(s − b))). */
  voz: z.object({ a: z.number(), b: z.number(), min_segmentos: z.number(), p_max: z.number() }),
  imagen: z.object({
    hamming_max: z.number(),
    p_hamming: z.number(),
    dino_a: z.number(),
    dino_b: z.number(),
    p_max: z.number(),
  }),
  mo: z.object({ a: z.number(), b: z.number(), p_max: z.number() }),
  identificador: z.object({ p: z.number() }),
});
export type Calibration = z.infer<typeof Calibration>;

/** Valores iniciales; la evaluación los reemplaza. Documentados en DEVLOG.md. */
export const DEFAULT_CALIBRATION: Calibration = {
  version: "v0-inicial",
  updated_at: "2026-10-28T00:00:00Z",
  source: "valores iniciales antes de la evaluación",
  thresholds: { probable: 0.9, revisar: 0.6 },
  voz: { a: 25, b: 0.55, min_segmentos: 2, p_max: 0.85 },
  imagen: { hamming_max: 10, p_hamming: 0.8, dino_a: 20, dino_b: 0.8, p_max: 0.8 },
  mo: { a: 12, b: 0.85, p_max: 0.4 },
  identificador: { p: 0.95 },
};

export function logistic(x: number, a: number, b: number): number {
  return 1 / (1 + Math.exp(-a * (x - b)));
}

/** 1 − ∏(1 − pᵢ). Supone independencia aproximada entre señales (fase 1). */
export function combineSignals(probabilities: number[]): number {
  let none = 1;
  for (const p of probabilities) none *= 1 - Math.min(Math.max(p, 0), 1);
  return 1 - none;
}

export function signalProbabilities(s: Signals): number[] {
  return [s.identificador?.p, s.voz?.p, s.imagen?.p, s.modus_operandi?.p].filter(
    (p): p is number => typeof p === "number",
  );
}

/** Estado según los umbrales (sección 9.4). */
export function statusForScore(score: number, c: Calibration = DEFAULT_CALIBRATION) {
  if (score >= c.thresholds.probable) return "probable" as const;
  if (score >= c.thresholds.revisar) return "por_revisar" as const;
  return "descartado_auto" as const;
}

/**
 * Reglas de la tabla 9.2: el modus operandi nunca vincula solo; voz e imagen necesitan
 * otra señal o revisión humana explícita (por eso nunca pasan de p_max por sí solas y
 * todo vínculo pasa por la cola de revisión).
 */
export function canProposeAlone(kind: keyof Signals): boolean {
  return kind === "identificador";
}
