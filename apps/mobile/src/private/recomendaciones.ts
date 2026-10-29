import { districtById, districtOfZone, type NivelRiesgo, type RecomendacionNegocio, type VictimReport } from "@/shared";

/**
 * Ayudas puras para las recomendaciones de la zona y los consejos del reporte. Sin React, para
 * probarlas sin render.
 */

const ORDEN: Record<RecomendacionNegocio["prioridad"], number> = { alta: 0, media: 1, baja: 2 };

export const PRIORIDAD: Record<RecomendacionNegocio["prioridad"], string> = {
  alta: "Prioridad alta",
  media: "Prioridad media",
  baja: "Prioridad baja",
};

/** Alta, media y baja. Con la misma prioridad, respeta el orden que eligió el equipo. */
export function porPrioridad(recs: readonly RecomendacionNegocio[]): RecomendacionNegocio[] {
  return recs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ORDEN[a.r.prioridad] - ORDEN[b.r.prioridad] || a.i - b.i)
    .map((x) => x.r);
}

/** En palabras y sin alarma: "Riesgo en tu zona: medio". */
export function riesgoEnPalabras(n: NivelRiesgo): string {
  if (n === "sin_datos") return "Riesgo en tu zona: aún no hay suficientes casos para saberlo";
  return `Riesgo en tu zona: ${n}`;
}

/**
 * Nombre de la zona de un aviso o una recomendación. `zona` es el texto que se muestra y `distrito`
 * su id (aditivo); si la zona llega como id, también se muestra con su nombre.
 */
export function nombreDeZona(x: { zona: string; distrito?: string | null }): string {
  return districtById(x.distrito)?.name ?? districtOfZone(x.zona)?.name ?? x.zona;
}

/** "bodegas" -> "Bodegas". */
export function capitalizar(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * Consejos de prevención del reporte propio. Todavía no están en el contrato de shared: se leen de
 * forma defensiva y se descarta lo que no sea texto.
 */
export function consejosDe(report: VictimReport | null | undefined): string[] {
  const c = (report as (VictimReport & { consejos?: unknown }) | null | undefined)?.consejos;
  if (!Array.isArray(c)) return [];
  return c.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x.length > 0);
}
