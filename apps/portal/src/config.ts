/**
 * Configuración del portal de negocios en tiempo de build.
 *
 *  - VITE_API_URL: base de la API real (por ejemplo https://blindaje-api.<cuenta>.workers.dev).
 *  - VITE_MOCK=1 (o `--mode mock`): modo simulado con datos ficticios, sin backend.
 *
 * Sin VITE_API_URL el portal arranca en modo simulado: nunca intenta adivinar una API.
 */
const env = import.meta.env;

export const API_URL: string = (env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

export const MOCK: boolean = env.VITE_MOCK === "1" || env.MODE === "mock" || API_URL === "";

/** Mínimo de casos y de víctimas distintas para mostrar cifras (MIN_CASES_FOR_STATS en la API). */
export const MIN_CASES = 5;
export const MIN_VICTIMS = 3;

/** Texto fijo cuando no se cumple el umbral (packages/shared/src/business.ts). */
export const THRESHOLD_TEXT = "Aún no hay suficientes casos para mostrar cifras";

/** Página neutra de "Salir rápido": reemplaza esta entrada del historial. */
export const QUICK_EXIT_URL = "https://www.google.com/";
