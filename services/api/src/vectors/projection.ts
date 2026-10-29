import { VECTOR_SAMPLE_BINS } from "@blindaje/shared";

/**
 * Proyección de vectores a dos ejes (PCA) y muestra de números para la vista del motor vectorial.
 * Solo sirve para ver: la comparación real es el coseno en la dimensión completa.
 */

export interface Projection {
  /** Un par [x, y] por vector, normalizado a [-1, 1]. */
  coords: Array<[number, number]>;
  /** Fracción de la varianza que explica cada eje. */
  variance: [number, number];
}

function dotv(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normalizeInPlace(v: Float64Array): number {
  const n = Math.sqrt(dotv(v, v));
  if (n > 0) for (let i = 0; i < v.length; i++) v[i]! /= n;
  return n;
}

/**
 * Componente principal de las filas de `x` (ya centradas) por iteración de potencia sobre XᵀX, sin
 * formar la matriz d × d. `deflate` son componentes ya encontradas: se quitan en cada vuelta.
 */
function principal(x: Float64Array[], dim: number, deflate: Float64Array[]): { v: Float64Array; eig: number } {
  const v = new Float64Array(dim);
  // Arranque determinista: la fila de mayor norma (más un poco de cada eje para no caer en cero).
  let start = x[0]!;
  for (const row of x) if (dotv(row, row) > dotv(start, start)) start = row;
  for (let i = 0; i < dim; i++) v[i] = start[i]! + 1e-3 * (((i * 7919) % 13) - 6);
  const project = (w: Float64Array) => {
    for (const d of deflate) {
      const c = dotv(w, d);
      for (let i = 0; i < dim; i++) w[i]! -= c * d[i]!;
    }
  };
  project(v);
  normalizeInPlace(v);
  let eig = 0;
  for (let iter = 0; iter < 200; iter++) {
    const next = new Float64Array(dim);
    for (const row of x) {
      const c = dotv(row, v);
      for (let i = 0; i < dim; i++) next[i]! += c * row[i]!;
    }
    project(next);
    const norm = normalizeInPlace(next);
    const delta = 1 - Math.abs(dotv(next, v));
    v.set(next);
    eig = norm;
    if (norm === 0 || delta < 1e-10) break;
  }
  return { v, eig };
}

export function projectPca(vectors: number[][]): Projection {
  const n = vectors.length;
  if (n === 0) return { coords: [], variance: [0, 0] };
  const dim = vectors[0]!.length;
  const mean = new Float64Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i]! += v[i]! / n;
  const x = vectors.map((v) => Float64Array.from({ length: dim }, (_, i) => v[i]! - mean[i]!));
  const total = x.reduce((s, row) => s + dotv(row, row), 0);
  if (n === 1 || total === 0) return { coords: vectors.map(() => [0, 0]), variance: [0, 0] };

  const first = principal(x, dim, []);
  const second = principal(x, dim, [first.v]);
  const raw = x.map((row) => [dotv(row, first.v), dotv(row, second.v)] as [number, number]);
  const scale = Math.max(...raw.flatMap(([a, b]) => [Math.abs(a), Math.abs(b)])) || 1;
  const round = (k: number) => Math.round((k / scale) * 10_000) / 10_000;
  return {
    coords: raw.map(([a, b]) => [round(a), round(b)]),
    variance: [Math.round((first.eig / total) * 1000) / 1000, Math.round((second.eig / total) * 1000) / 1000],
  };
}

/** Uno de cada dim/VECTOR_SAMPLE_BINS números del vector, reescalados por su mayor valor absoluto. */
export function vectorSample(v: number[], bins = VECTOR_SAMPLE_BINS): number[] {
  if (!v.length) return [];
  const step = v.length / bins;
  const picked = Array.from({ length: Math.min(bins, v.length) }, (_, i) => v[Math.floor(i * step)]!);
  const max = Math.max(...v.map((k) => Math.abs(k))) || 1;
  return picked.map((k) => Math.round((k / max) * 1000) / 1000);
}
