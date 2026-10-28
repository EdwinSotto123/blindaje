import { logistic, type Calibration } from "@blindaje/shared";

/**
 * Señales del motor de vinculación (sección 9.2) convertidas en probabilidades con la calibración
 * de KV. Funciones puras: las usan `findCandidates` y los tests.
 */

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/** Distancia de Hamming entre dos hashes perceptuales de 64 bits en hex (16 caracteres). */
export function hamming64(a: string, b: string): number {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) {
      d += x & 1;
      x >>>= 1;
    }
  }
  return d;
}

/** Voz: logística sobre el coseno con tope `p_max`; con menos de `min_segmentos` segmentos que coinciden, baja. */
export function voiceProbability(cosine: number, matchedSegments: number, c: Calibration): number {
  const base = Math.min(logistic(cosine, c.voz.a, c.voz.b), c.voz.p_max);
  if (matchedSegments >= c.voz.min_segmentos) return base;
  return base * 0.5 * (matchedSegments / Math.max(1, c.voz.min_segmentos));
}

/**
 * Factor de la señal de voz cuando algún audio comparado tiene indicios fuertes de voz sintética o
 * marca de IA (análisis de autenticidad, sección 12.3): una voz sintética podría imitar a otra.
 */
export const SYNTHETIC_VOICE_FACTOR = 0.5;

/**
 * Ajusta la p de voz por autenticidad: si alguna evidencia comparada (`compared`, etiquetas EV-…)
 * está en `flagged`, p × 0.5 una sola vez (no por audio) y queda marcada en `voz_sintetica`.
 */
export function syntheticVoiceAdjust(
  p: number,
  compared: string[],
  flagged: ReadonlySet<string>,
): { p: number; voz_sintetica?: { evidencia: string[]; factor: number; p_sin_ajuste: number } } {
  const evidencia = [...new Set(compared.filter((e) => flagged.has(e)))];
  if (!evidencia.length) return { p };
  return {
    p: p * SYNTHETIC_VOICE_FACTOR,
    voz_sintetica: { evidencia, factor: SYNTHETIC_VOICE_FACTOR, p_sin_ajuste: Math.round(p * 10_000) / 10_000 },
  };
}

/** Umbral de coseno para contar un segmento como coincidente: el punto medio de la logística. */
export function segmentThreshold(c: Calibration): number {
  return c.voz.b;
}

/**
 * Modus operandi: coseno del resumen_mo + frases firma comunes + mismo canal de pago + mismo grupo,
 * por la logística de `mo`, con tope `p_max` (nunca vincula solo: p_max < umbral de revisión).
 */
export function moProbability(
  s: { similitud_texto: number | null; frases_comunes: number; mismo_canal_pago: boolean; mismo_grupo: boolean },
  c: Calibration,
): number {
  const x = (s.similitud_texto ?? 0) + 0.05 * Math.min(s.frases_comunes, 3) + (s.mismo_canal_pago ? 0.03 : 0) + (s.mismo_grupo ? 0.05 : 0);
  return Math.min(logistic(x, c.mo.a, c.mo.b), c.mo.p_max);
}

/**
 * Imagen (eval/README.md): si el hash perceptual está a distancia ≤ `hamming_max`, `p = p_hamming`
 * (imagen reutilizada); si no, `p = min(logística(DINOv2), p_max)`. DINOv2 solo refuerza.
 */
export function imageProbability(hammingMin: number | null, dinoMax: number | null, c: Calibration): number {
  if (hammingMin !== null && hammingMin <= c.imagen.hamming_max) return c.imagen.p_hamming;
  if (dinoMax === null) return 0;
  return Math.min(logistic(dinoMax, c.imagen.dino_a, c.imagen.dino_b), c.imagen.p_max);
}

/** El Vinculador puede bajar el puntaje libremente, pero subirlo a lo más 0.05. */
export function finalScore(ajustado: number, scoreRaw: number): number {
  const v = Math.min(Number.isFinite(ajustado) ? ajustado : scoreRaw, scoreRaw + 0.05);
  return Math.min(1, Math.max(0, v));
}

/** Minúsculas, sin tildes ni puntuación, espacios simples. */
export function normalizePhrase(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Parecido difuso entre dos frases (0 a 1): igualdad, contención, tokens comunes o edición. */
export function phraseSimilarity(a: string, b: string): number {
  const x = normalizePhrase(a);
  const y = normalizePhrase(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 8 && long.includes(short)) return 0.9;
  const tx = new Set(x.split(" "));
  const ty = new Set(y.split(" "));
  const inter = [...tx].filter((t) => ty.has(t)).length;
  const jaccard = inter / (tx.size + ty.size - inter);
  const edit = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  return Math.max(jaccard, edit);
}

/** Frases firma del caso `mine` que tienen un par parecido en `theirs`. */
export function commonPhrases(mine: string[], theirs: string[], threshold = 0.8): string[] {
  const out: string[] = [];
  for (const m of mine) {
    if (theirs.some((t) => phraseSimilarity(m, t) >= threshold) && !out.some((o) => phraseSimilarity(o, m) >= threshold)) out.push(m);
  }
  return out;
}

export function sameGroup(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return phraseSimilarity(a, b) >= 0.85;
}
