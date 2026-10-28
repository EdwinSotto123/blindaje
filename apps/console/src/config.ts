/**
 * Configuración de la consola en tiempo de build.
 *
 *  - VITE_API_URL: base de la API real (por ejemplo https://blindaje-api.<cuenta>.workers.dev).
 *  - VITE_MOCK=1 (o `--mode mock`): modo simulado con datos ficticios, sin backend.
 *
 * Sin VITE_API_URL la consola arranca en modo simulado: nunca intenta adivinar una API.
 */
const env = import.meta.env;

export const API_URL: string = (env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

export const MOCK: boolean = env.VITE_MOCK === "1" || env.MODE === "mock" || API_URL === "";

/** Presupuesto por defecto si la API no lo informa (META_BUDGET_USD). */
export const DEFAULT_BUDGET_USD = 150;

/** Al 80% del presupuesto se bloquean las llamadas no esenciales (Muse Wonder, Muse Image). */
export const NONESSENTIAL_BLOCK_PCT = 80;
