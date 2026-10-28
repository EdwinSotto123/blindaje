/**
 * Variables de build (Expo las incrusta al empaquetar; solo funcionan con acceso directo
 * `process.env.EXPO_PUBLIC_*`, sin desestructurar).
 */

/** URL base del Worker (sin /v1). Ejemplo: https://blindaje-api.<cuenta>.workers.dev */
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/** Servidor falso en memoria que respeta los esquemas de packages/shared/src/api.ts. */
export const MOCK_API: boolean = process.env.EXPO_PUBLIC_MOCK_API === "1" || API_URL === "";

/**
 * INSEGURO PARA USO REAL. Desactiva la prevención de capturas en las pantallas privadas.
 * Existe solo para sacar las capturas del demo, la landing y el README.
 */
export const ALLOW_SCREENSHOTS: boolean = process.env.EXPO_PUBLIC_ALLOW_SCREENSHOTS === "1";

/** Llena el cuaderno con ventas ficticias la primera vez (solo para el demo). */
export const DEMO_SEED: boolean = process.env.EXPO_PUBLIC_DEMO_SEED === "1";
