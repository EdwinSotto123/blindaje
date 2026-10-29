import { COUNT_BANDS, countBand, type CountBand } from "@blindaje/shared";
import { MIN_VICTIMS } from "../config";

/**
 * Rangos de casos (5-9, 10-19, 20-49, 50+). Lo público nunca muestra cifras exactas: con un total y
 * cifras exactas por partes, una resta revela lo que el umbral oculta.
 */

const BAND_SET = new Set<string>(COUNT_BANDS);

/**
 * Un rango válido a partir de lo que mande la API. Si llegara una cifra exacta (una API vieja), se
 * convierte en rango y la cifra no pasa de aquí; cualquier otra cosa, o una cifra bajo el umbral,
 * queda en null ("sin datos").
 */
export function asBand(value: unknown): CountBand | null {
  if (typeof value === "string" && BAND_SET.has(value)) return value as CountBand;
  // Una cifra suelta ya pasó el umbral de víctimas en la API (si no, vendría null); se exige el de casos.
  if (typeof value === "number" && Number.isFinite(value)) return countBand(Math.floor(value), MIN_VICTIMS);
  return null;
}

/** Posición en la escala (0 a 3), para dibujar el rango como peldaños. */
export function bandIndex(band: CountBand): number {
  return COUNT_BANDS.indexOf(band);
}

/** "entre 10 y 19 casos" / "50 casos o más", para leer en una frase. */
export function bandPhrase(band: CountBand): string {
  if (band === "50+") return "50 casos o más";
  const [lo, hi] = band.split("-");
  return `entre ${lo} y ${hi} casos`;
}

/** "10 a 19" / "50 o más": la etiqueta visible del rango, sin guion (un lector de pantalla no dice "menos"). */
export function bandLabel(band: CountBand): string {
  if (band === "50+") return "50 o más";
  return band.replace("-", " a ");
}
