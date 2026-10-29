import type { NivelRiesgo, RecomendacionNegocio } from "@blindaje/shared";

/** Nivel en palabras. "sin_datos" nunca se dice como "bajo": no sabemos. */
export const NIVEL_LABEL: Record<NivelRiesgo, string> = {
  sin_datos: "sin datos suficientes",
  bajo: "bajo",
  medio: "medio",
  alto: "alto",
};

/** Qué significa cada nivel, en una frase para un vecino o el dueño de un negocio. */
export const NIVEL_HINT: Record<NivelRiesgo, string> = {
  sin_datos: "Todavía no hay casos suficientes para estimar el riesgo de tu zona.",
  bajo: "Hay pocos casos. Sigue con los cuidados de siempre.",
  medio: "Hay casos recientes. Repasa con tu familia o tu personal qué hacer si les llega un mensaje.",
  alto: "Hay muchos casos recientes. Ten a la mano qué hacer y guarda cualquier mensaje raro para denunciarlo.",
};

export const ESCALA: Exclude<NivelRiesgo, "sin_datos">[] = ["bajo", "medio", "alto"];

export type Prioridad = RecomendacionNegocio["prioridad"];

export const PRIORIDADES: Prioridad[] = ["alta", "media", "baja"];

/** Encabezado de cada grupo de recomendaciones, de lo más urgente a lo que puede esperar. */
export const PRIORIDAD_TITULO: Record<Prioridad, string> = {
  alta: "Haz esto primero",
  media: "Después",
  baja: "Cuando puedas",
};

export const PRIORIDAD_LABEL: Record<Prioridad, string> = {
  alta: "Prioridad alta",
  media: "Prioridad media",
  baja: "Prioridad baja",
};

/** Agrupa por prioridad (alta, media, baja), conservando el orden original dentro de cada grupo. */
export function byPriority<T extends { prioridad: Prioridad }>(items: T[]): { prioridad: Prioridad; items: T[] }[] {
  return PRIORIDADES.map((prioridad) => ({ prioridad, items: items.filter((i) => i.prioridad === prioridad) })).filter((g) => g.items.length > 0);
}
