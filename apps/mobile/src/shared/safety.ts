// ARCHIVO GENERADO, NO EDITAR.
// Copia de packages/shared/src hecha por apps/mobile/scripts/sync-shared.mjs.
// Para cambiar un contrato, edita packages/shared y corre `npm run sync-shared`.
/* eslint-disable */

/**
 * Reglas de seguridad compartidas (sección 5 del documento de diseño: "Lo que Blindaje no hace").
 */

/** Umbral de agregación: ninguna estadística territorial con menos de 5 casos o 3 víctimas. */
export const MIN_CASES_FOR_STATS = 5;
export const MIN_VICTIMS_FOR_STATS = 3;

export function canShowTerritorialStats(nCases: number, nDistinctVictims: number): boolean {
  return nCases >= MIN_CASES_FOR_STATS && nDistinctVictims >= MIN_VICTIMS_FOR_STATS;
}

/**
 * Palabras que nunca aparecen en las superficies del disfraz (cuaderno, lista, calculadora).
 * La app tiene un test que recorre los textos del disfraz contra esta lista.
 */
export const DISGUISE_FORBIDDEN_WORDS = [
  "extorsión",
  "extorsion",
  "denuncia",
  "denunciar",
  "policía",
  "policia",
  "blindaje",
  "amenaza",
  "evidencia",
  "comisaría",
  "comisaria",
] as const;

export function disguiseTextIsSafe(text: string): boolean {
  const t = text.toLowerCase();
  return !DISGUISE_FORBIDDEN_WORDS.some((w) => t.includes(w));
}

/**
 * Campos que jamás pueden aparecer en una respuesta para el rol victim.
 * services/api tiene un test que recorre las respuestas de víctima buscando estas claves.
 */
export const VICTIM_FORBIDDEN_KEYS = [
  "links",
  "link",
  "vinculos",
  "vinculo",
  "network",
  "networks",
  "red",
  "redes",
  "matches",
  "coincidencias",
  "score",
  "signals",
  "senales",
  "candidates",
  "other_cases",
  "hmac",
] as const;

/** Teléfonos oficiales que siempre se muestran (sección 10.4). */
export const LINEA_DENUNCIAS = "1818";
export const LINEA_EMERGENCIAS = "105";
