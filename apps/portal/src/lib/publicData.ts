import {
  DISTRICTS,
  districtOfZone,
  MIN_CASES_FOR_STATS,
  MIN_VICTIMS_FOR_STATS,
  type BusinessRecommendationView,
  type NivelRiesgo,
  type PublicRiskOverview,
  type PublicZoneCell,
  type PublicZoneMap,
  type VictimAlert,
} from "@blindaje/shared";
import { SESGO_FALLBACK } from "../config";
import { asBand } from "./bands";

/**
 * Reglas de lo público, aplicadas otra vez en el navegador a todo lo que llega (de la API o del modo
 * simulado). Si una respuesta se saliera del contrato, el portal igual:
 *  - nunca muestra una cifra exacta (solo rangos 5-9, 10-19, 20-49, 50+);
 *  - dibuja "sin datos" igual para un distrito bajo el umbral que para uno sin casos;
 *  - no muestra el cubo de "otros rubros" (la resta revelaría lo que el umbral oculta);
 *  - siempre lleva la nota de sesgo.
 */

const NIVELES: readonly NivelRiesgo[] = ["sin_datos", "bajo", "medio", "alto"];
const TENDENCIAS = ["sube", "estable", "baja"] as const;

function asNivel(v: unknown): NivelRiesgo {
  return typeof v === "string" && (NIVELES as readonly string[]).includes(v) ? (v as NivelRiesgo) : "sin_datos";
}

function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asTextList(v: unknown, max = 50): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max) : [];
}

/** Un cubo agregado ("Otros rubros (agregado)", "Varios rubros"): permitiría restar, no se publica. */
export function isAggregateBucket(name: string): boolean {
  return /agregad|^\s*(otros|varios)\s+rubros/i.test(name);
}

const EMPTY_CELL = (distrito: string): PublicZoneCell => ({ distrito, nivel: "sin_datos", casos: null, tendencia: null, modalidades: [] });

/** Una celda del mapa: bajo el umbral no queda nada que la distinga de un distrito sin casos. */
export function sanitizeCell(raw: unknown, distrito: string): PublicZoneCell {
  const r = (raw ?? {}) as Record<string, unknown>;
  const nivel = asNivel(r.nivel);
  const casos = asBand(r.casos);
  if (nivel === "sin_datos" || casos === null) return EMPTY_CELL(distrito);
  const tendencia = (TENDENCIAS as readonly unknown[]).includes(r.tendencia) ? (r.tendencia as PublicZoneCell["tendencia"]) : null;
  return { distrito, nivel, casos, tendencia, modalidades: asTextList(r.modalidades, 3).map((m) => m.slice(0, 80)) };
}

/** El mapa público completo: siempre los 50 distritos, en el orden de la lista. */
export function sanitizeZones(raw: unknown): PublicZoneMap {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cells = Array.isArray(r.celdas) ? (r.celdas as Record<string, unknown>[]) : [];
  const byDistrict = new Map<string, unknown>();
  for (const c of cells) {
    const d = districtOfZone(typeof c?.distrito === "string" ? c.distrito : null);
    if (d && !byDistrict.has(d.id)) byDistrict.set(d.id, c);
  }
  const periodo = typeof r.periodo_dias === "number" && r.periodo_dias > 0 ? Math.round(r.periodo_dias) : 28;
  return {
    periodo_dias: periodo,
    actualizado: asText(r.actualizado),
    celdas: DISTRICTS.map((d) => sanitizeCell(byDistrict.get(d.id), d.id)),
    umbral: { casos: MIN_CASES_FOR_STATS, victimas: MIN_VICTIMS_FOR_STATS },
    nota_sesgo: asText(r.nota_sesgo).trim() || SESGO_FALLBACK,
    demo: r.demo !== false,
  };
}

/** El panorama de una zona, con rangos y sin nada que permita restar. */
export function sanitizeRisk(raw: unknown): PublicRiskOverview {
  const r = (raw ?? {}) as Record<string, unknown>;
  let nivel = asNivel(r.nivel_riesgo);
  let casos = asBand(r.casos_periodo);
  if (casos === null) nivel = "sin_datos";
  if (nivel === "sin_datos") casos = null;
  const below = nivel === "sin_datos";
  const tendencia = Array.isArray(r.tendencia)
    ? (r.tendencia as Record<string, unknown>[]).map((t) => ({ semana: asText(t?.semana), casos: below ? null : asBand(t?.casos) }))
    : [];
  const sectores = Array.isArray(r.sectores_afectados) ? (r.sectores_afectados as Record<string, unknown>[]) : [];
  const modalidades = Array.isArray(r.modalidades_activas) ? (r.modalidades_activas as Record<string, unknown>[]) : [];
  return {
    zona: asText(r.zona),
    sector: typeof r.sector === "string" && r.sector ? r.sector : null,
    periodo_dias: typeof r.periodo_dias === "number" ? r.periodo_dias : 28,
    nivel_riesgo: nivel,
    casos_periodo: casos,
    tendencia,
    // Bajo el umbral no se nombra ninguna modalidad ni ningún rubro: ya diría que alguien denunció.
    modalidades_activas: below
      ? []
      : modalidades.map((m) => ({
          descripcion: asText(m?.descripcion),
          senales_de_alerta: asTextList(m?.senales_de_alerta),
          desde: typeof m?.desde === "string" ? m.desde : null,
        })),
    escalamiento: below ? null : typeof r.escalamiento === "string" && r.escalamiento ? r.escalamiento : null,
    sectores_afectados: below
      ? []
      : sectores.flatMap((s) => {
          const name = asText(s?.sector);
          const band = asBand(s?.casos);
          return name && band && !isAggregateBucket(name) ? [{ sector: name, casos: band }] : [];
        }),
    sesgo: asText(r.sesgo).trim() || SESGO_FALLBACK,
    aviso_umbral: typeof r.aviso_umbral === "string" && r.aviso_umbral ? r.aviso_umbral : null,
    actualizado_at: asText(r.actualizado_at),
    demo: r.demo !== false,
  };
}

/** `[...]` o `{ [key]: [...] }`: la API de negocios envolvía las listas; la pública puede no hacerlo. */
export function unwrapList(raw: unknown, key: string): unknown[] {
  if (Array.isArray(raw)) return raw;
  const inner = (raw as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(inner) ? inner : [];
}

/** true si la zona guardada (id, nombre o "Distrito - Celda") es este distrito. */
export function sameDistrict(zona: unknown, distrito: string): boolean {
  return typeof zona === "string" && districtOfZone(zona)?.id === distrito;
}

/** Solo los avisos aprobados de este distrito, del más nuevo al más viejo. */
export function sanitizeAlerts(raw: unknown[], distrito: string): VictimAlert[] {
  return raw
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null && sameDistrict((a as Record<string, unknown>).zona, distrito))
    .map((a) => ({
      id: asText(a.id),
      titulo: asText(a.titulo),
      cuerpo: asText(a.cuerpo),
      zona: asText(a.zona),
      que_hacer: asTextList(a.que_hacer),
      approved_at: asText(a.approved_at),
    }))
    .filter((a) => a.id && a.titulo)
    .sort((a, b) => b.approved_at.localeCompare(a.approved_at));
}

/** Solo los consejos aprobados de este distrito, del más nuevo al más viejo. */
export function sanitizeRecommendations(raw: unknown[], distrito: string): BusinessRecommendationView[] {
  return (raw as BusinessRecommendationView[])
    .filter((r) => r && typeof r === "object" && typeof r.id === "string" && sameDistrict(r.zona, distrito))
    .map((r) => ({
      ...r,
      modalidades: Array.isArray(r.modalidades) ? r.modalidades : [],
      recomendaciones: Array.isArray(r.recomendaciones) ? r.recomendaciones : [],
      que_hacer_si_te_pasa: asTextList(r.que_hacer_si_te_pasa),
      advertencias: asTextList(r.advertencias),
    }))
    .sort((a, b) => asText(b.approved_at).localeCompare(asText(a.approved_at)));
}
