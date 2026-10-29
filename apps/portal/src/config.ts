import { MIN_CASES_FOR_STATS, MIN_VICTIMS_FOR_STATS } from "@blindaje/shared";

/**
 * Configuración del portal público en tiempo de build.
 *
 *  - VITE_API_URL: base de la API real (por ejemplo https://blindaje-api.<cuenta>.workers.dev).
 *  - VITE_MOCK=1 (o `--mode mock`): modo simulado con datos ficticios, sin backend.
 *
 * Sin VITE_API_URL el portal arranca en modo simulado: nunca intenta adivinar una API.
 */
const env = import.meta.env;

export const API_URL: string = (env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

export const MOCK: boolean = env.VITE_MOCK === "1" || env.MODE === "mock" || API_URL === "";

/** Mínimo de casos y de víctimas distintas para mostrar cifras: el mismo umbral de la API (packages/shared). */
export const MIN_CASES = MIN_CASES_FOR_STATS;
export const MIN_VICTIMS = MIN_VICTIMS_FOR_STATS;

/** Texto fijo cuando no se cumple el umbral (el mismo de la API). */
export const THRESHOLD_TEXT = "Aún no hay suficientes casos para mostrar cifras";

/** Regla del umbral en una frase, para el mapa y las notas. */
export const THRESHOLD_RULE = `Solo mostramos un distrito, un rubro, una semana o una modalidad si tiene al menos ${MIN_CASES} casos de ${MIN_VICTIMS} personas distintas. Si no llega, se ve como “sin datos”, igual que si no tuviera casos.`;

/** Nota de sesgo por si una respuesta llegara sin ella: nunca se muestra una cifra sin esta advertencia. */
export const SESGO_FALLBACK =
  "Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa. Solo cuentan los casos de personas que aceptaron compartir su denuncia con la comunidad, y muchos casos nunca se denuncian.";

/** Página neutra de "Salir rápido": reemplaza esta entrada del historial. */
export const QUICK_EXIT_URL = "https://www.google.com/";
