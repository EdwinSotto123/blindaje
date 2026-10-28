import type { Env } from "../env";

export type CounterName = "voice" | "image" | "link" | "network" | "hypothesis" | "faiss";

/** Incremento atómico de los contadores de etiquetas (V-n, IMG-n, VIN-n, R-n, HIP-n, faiss_id). */
export async function nextCounter(env: Env, name: CounterName): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO counters (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1
     RETURNING value`,
  )
    .bind(name)
    .first<{ value: number }>();
  if (!row) throw new Error(`counter_failed:${name}`);
  return row.value;
}

/** Reserva `n` valores consecutivos y devuelve el primero. */
export async function reserveCounter(env: Env, name: CounterName, n: number): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO counters (name, value) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET value = value + ?
     RETURNING value`,
  )
    .bind(name, n, n)
    .first<{ value: number }>();
  if (!row) throw new Error(`counter_failed:${name}`);
  return row.value - n + 1;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

export function parseJsonColumn<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
