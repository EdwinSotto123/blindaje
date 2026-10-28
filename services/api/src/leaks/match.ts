import { LEAK_AUDIO_MAX_HAMMING, LEAK_IMAGE_MIN_ACCURACY, LEAK_IMAGE_MIN_MARGIN, LEAK_TAG_MIN_DISTANCE } from "@blindaje/shared";

/**
 * Aritmética de las marcas (funciones puras, con tests en test/leaks.test.ts).
 *
 * Orden de los bits (contrato con el contenedor ML, docs/ML_API.md):
 * - audio: `bits[i]` es el bit (15 - i) del mensaje de 16 bits (el primero es el más significativo);
 * - imagen: `bits[i]` es el bit i del mensaje leído en hex, el más significativo primero en cada dígito.
 */

/** 0x0000 y 0xFFFF no se asignan y cuentan como ocupadas: un detector que no lee nada suele dar bits todos iguales. */
export const RESERVED_TAGS = [0x0000, 0xffff] as const;

/** Bits con lectura dudosa (entre 0.35 y 0.65): pueden leerse de las dos formas. */
export const UNCERTAIN_BIT = 0.15;

export function popcount16(x: number): number {
  let v = x & 0xffff;
  let n = 0;
  while (v) {
    v &= v - 1;
    n++;
  }
  return n;
}

export function hamming16(a: number, b: number): number {
  return popcount16((a ^ b) & 0xffff);
}

/** ¿Queda a distancia mínima de todas las marcas ocupadas (incluidas las reservadas)? */
export function farEnough(tag: number, taken: readonly number[], minDistance = LEAK_TAG_MIN_DISTANCE): boolean {
  return [...taken, ...RESERVED_TAGS].every((t) => hamming16(tag, t) >= minDistance);
}

export function randomU16(): number {
  const b = new Uint16Array(1);
  crypto.getRandomValues(b);
  return b[0]!;
}

/**
 * Elige una marca de 16 bits a distancia >= `minDistance` de las ocupadas: primero al azar y, si
 * no aparece, recorriendo todo el espacio desde un punto al azar. null si ya no queda ninguna (el
 * código máximo con distancia 5 en 16 bits tiene del orden de 256 palabras; la búsqueda voraz llega
 * a menos).
 */
export function pickTag(taken: readonly number[], random: () => number = randomU16, minDistance = LEAK_TAG_MIN_DISTANCE): number | null {
  for (let i = 0; i < 256; i++) {
    const t = random() & 0xffff;
    if (farEnough(t, taken, minDistance)) return t;
  }
  const start = random() & 0xffff;
  for (let k = 0; k < 0x10000; k++) {
    const t = (start + k) & 0xffff;
    if (farEnough(t, taken, minDistance)) return t;
  }
  return null;
}

/** Bits blandos (0..1, MSB primero) → entero de 16 bits con bits duros (>= 0.5 es 1). */
export function bitsToInt16(bits: readonly number[]): number {
  let v = 0;
  for (let i = 0; i < 16; i++) if ((bits[i] ?? 0) >= 0.5) v |= 1 << (15 - i);
  return v;
}

/** Máscara de los bits dudosos (lectura cerca de 0.5). */
export function uncertainMask16(bits: readonly number[], margin = UNCERTAIN_BIT): number {
  let m = 0;
  for (let i = 0; i < 16; i++) if (Math.abs((bits[i] ?? 0.5) - 0.5) < margin) m |= 1 << (15 - i);
  return m;
}

export interface TagRow {
  user_id: string;
  audio_tag: number;
}

export interface AudioMatch<T extends TagRow> {
  /** Cuentas a distancia <= 2 en bits duros, la más cercana primero. */
  matches: Array<T & { distance: number; bit_accuracy: number }>;
  /** Otras cuentas que también quedarían a distancia <= 2 si los bits dudosos se leyeran al revés. */
  otras_posibles: number;
  ambiguo: boolean;
  /** Mensaje leído (bits duros). */
  leido: number;
}

/** Atribución de un audio: distancia de Hamming entre los bits leídos y la marca de cada cuenta. */
export function matchAudio<T extends TagRow>(bits: readonly number[], tags: readonly T[], maxDistance = LEAK_AUDIO_MAX_HAMMING): AudioMatch<T> {
  const leido = bitsToInt16(bits);
  const dudosos = uncertainMask16(bits);
  const seguros = ~dudosos & 0xffff;
  const scored = tags.map((t) => ({
    ...t,
    distance: hamming16(leido, t.audio_tag),
    // Distancia contando solo los bits seguros: cuántos errores harían falta en lo que sí se leyó bien.
    optimista: hamming16(leido & seguros, t.audio_tag & seguros),
  }));
  const matches = scored
    .filter((s) => s.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.user_id.localeCompare(b.user_id))
    .map(({ optimista: _o, ...m }) => ({ ...m, bit_accuracy: (16 - m.distance) / 16 }) as T & { distance: number; bit_accuracy: number });
  const otras = scored.filter((s) => s.distance > maxDistance && s.optimista <= maxDistance).length;
  return { matches, otras_posibles: otras, ambiguo: matches.length > 1 || (matches.length > 0 && otras > 0), leido };
}

/** Hex → bits (0/1), el más significativo primero en cada dígito. */
export function hexToBits(hex: string): number[] {
  const out: number[] = [];
  for (const ch of hex.trim().toLowerCase()) {
    const v = parseInt(ch, 16);
    if (Number.isNaN(v)) throw new Error("hex inválido");
    for (let i = 3; i >= 0; i--) out.push((v >> i) & 1);
  }
  return out;
}

/** Fracción de bits leídos (duros) que coinciden con los esperados. */
export function bitAccuracy(read: readonly number[], expected: readonly number[]): number {
  if (!expected.length || read.length !== expected.length) return 0;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) if (((read[i] ?? 0) >= 0.5 ? 1 : 0) === expected[i]) ok++;
  return ok / expected.length;
}

export interface IssueRow {
  id: string;
  message: string;
}

export interface ImageMatch<T extends IssueRow> {
  /** Entregas atribuibles (exactitud >= 0.85), la mejor primero. Más de una solo si es ambiguo. */
  matches: Array<T & { bit_accuracy: number }>;
  ambiguo: boolean;
  /** Mejor exactitud entre todas las entregas comparables (aunque no llegue al umbral). */
  mejor: number | null;
  /** Entregas con la misma cantidad de bits que la lectura. */
  comparadas: number;
}

/**
 * Atribución de una imagen: exactitud de bits contra el mensaje de cada entrega. Dos mensajes al
 * azar de 256 bits coinciden en ~50 % ± 3 %, así que >= 85 % con ventaja clara sobre la segunda es
 * una coincidencia que no se explica por azar.
 */
export function matchImage<T extends IssueRow>(
  bits: readonly number[],
  issues: readonly T[],
  opts: { minAccuracy?: number; minMargin?: number } = {},
): ImageMatch<T> {
  const minAccuracy = opts.minAccuracy ?? LEAK_IMAGE_MIN_ACCURACY;
  const minMargin = opts.minMargin ?? LEAK_IMAGE_MIN_MARGIN;
  const ranked: Array<T & { bit_accuracy: number }> = [];
  for (const issue of issues) {
    let expected: number[];
    try {
      expected = hexToBits(issue.message);
    } catch {
      continue;
    }
    if (expected.length !== bits.length) continue;
    ranked.push({ ...issue, bit_accuracy: bitAccuracy(bits, expected) });
  }
  ranked.sort((a, b) => b.bit_accuracy - a.bit_accuracy);
  const best = ranked[0];
  if (!best || best.bit_accuracy < minAccuracy) return { matches: [], ambiguo: false, mejor: best?.bit_accuracy ?? null, comparadas: ranked.length };
  const second = ranked[1]?.bit_accuracy ?? 0;
  if (best.bit_accuracy - second >= minMargin) return { matches: [best], ambiguo: false, mejor: best.bit_accuracy, comparadas: ranked.length };
  const close = ranked.filter((r) => r.bit_accuracy >= minAccuracy || best.bit_accuracy - r.bit_accuracy < minMargin).slice(0, 5);
  return { matches: close, ambiguo: true, mejor: best.bit_accuracy, comparadas: ranked.length };
}

/** Mensaje aleatorio de `nbits` bits en hex (nbits múltiplo de 4). */
export function randomHex(nbits: number): string {
  const bytes = new Uint8Array(Math.ceil(nbits / 8));
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, Math.ceil(nbits / 4));
}
