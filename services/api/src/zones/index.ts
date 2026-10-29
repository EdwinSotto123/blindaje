import {
  canShowTerritorialStats,
  COUNT_BANDS,
  DISTRICTS,
  districtOfZone,
  MIN_CASES_FOR_STATS,
  MIN_VICTIMS_FOR_STATS,
  networkLabel,
  type ConsoleZones,
  type CountBand,
  type PublicZoneMap,
} from "@blindaje/shared";
import type { Env } from "../env";
import {
  RISK_PERIOD_DAYS,
  SESGO_TEXTO,
  approvedAlerts,
  bandOf,
  fichaModalities,
  loadCommunityCases,
  zoneLevel,
  type RiskCase,
  type ZoneAlert,
} from "../business/risk";
import { sanitizePublicText } from "../business/safety";
import { nowIso } from "../lib/ids";
import { distinctVictims } from "../networks/graph";

/**
 * Lo territorial por distrito (rediseño del 28/10): el mapa público y la vista de zonas de la consola.
 *
 * - Misma población que el panorama de riesgo: casos comunitarios con ficha, del mundo pedido
 *   (real o demo), con la zona normalizada a distrito (los que no son distrito no cuentan).
 * - Mapa público: rangos (countBand), nada bajo el umbral (un distrito bajo el umbral se ve igual
 *   que uno sin casos), sin totales de ciudad y sin cubo "otras zonas" (no se reutiliza
 *   territorialStats de networks/graph). Nunca direcciones ni coordenadas: solo el id del distrito.
 * - Consola: cifras exactas para el equipo, pero el detalle (redes y modalidades) solo sobre el umbral.
 */

const DAY_MS = 86_400_000;

function byDistrict(cases: RiskCase[]): { distritos: Map<string, RiskCase[]>; sinDistrito: number } {
  const distritos = new Map<string, RiskCase[]>();
  let sinDistrito = 0;
  for (const c of cases) {
    const d = districtOfZone(c.zona);
    if (!d) {
      sinDistrito++;
      continue;
    }
    distritos.set(d.id, [...(distritos.get(d.id) ?? []), c]);
  }
  return { distritos, sinDistrito };
}

/** Tendencia comparando rangos (no cifras): no dice nada que no se vea en los dos mapas. */
function trend(actual: CountBand, previo: CountBand | null): "sube" | "estable" | "baja" {
  const a = COUNT_BANDS.indexOf(actual);
  const p = previo ? COUNT_BANDS.indexOf(previo) : -1;
  return a > p ? "sube" : a < p ? "baja" : "estable";
}

function alertModalities(alertas: ZoneAlert[], max: number): string[] {
  const out: string[] = [];
  for (const a of alertas) {
    const m = sanitizePublicText(a.modalidad.trim()).slice(0, 80).trim();
    if (m && !out.includes(m)) out.push(m);
  }
  return out.slice(0, max);
}

/** GET /v1/public/zones: los 50 distritos, con nivel y rango solo si pasan el umbral en el periodo. */
export async function publicZoneMap(env: Env, opts: { isDemo: boolean; now?: Date }): Promise<PublicZoneMap> {
  const now = (opts.now ?? new Date()).getTime();
  const period = RISK_PERIOD_DAYS * DAY_MS;
  const [cases, alertas] = await Promise.all([
    loadCommunityCases(env, { isDemo: opts.isDemo, since: now - 2 * period, until: now + DAY_MS }),
    approvedAlerts(env, { isDemo: opts.isDemo, since: new Date(now - period).toISOString() }),
  ]);
  const actual = byDistrict(cases.filter((c) => c.t >= now - period)).distritos;
  const previo = byDistrict(cases.filter((c) => c.t < now - period)).distritos;
  const celdas = DISTRICTS.map((d) => {
    const list = actual.get(d.id) ?? [];
    const casos = bandOf(list);
    if (!casos) return { distrito: d.id, nivel: "sin_datos" as const, casos: null, tendencia: null, modalidades: [] };
    const delDistrito = alertas.filter((a) => a.distrito === d.id);
    return {
      distrito: d.id,
      nivel: zoneLevel(list, delDistrito, now),
      casos,
      tendencia: trend(casos, bandOf(previo.get(d.id) ?? [])),
      // Solo modalidades de alertas aprobadas por el equipo central.
      modalidades: alertModalities(delDistrito, 3),
    };
  });
  return {
    periodo_dias: RISK_PERIOD_DAYS,
    actualizado: nowIso(),
    celdas,
    umbral: { casos: MIN_CASES_FOR_STATS, victimas: MIN_VICTIMS_FOR_STATS },
    nota_sesgo: SESGO_TEXTO,
    demo: opts.isDemo,
  };
}

/** GET /v1/console/zones: cifras exactas por distrito para el equipo central. */
export async function consoleZones(env: Env, opts: { dias: number; isDemo: boolean; now?: Date }): Promise<ConsoleZones> {
  const now = (opts.now ?? new Date()).getTime();
  const period = opts.dias * DAY_MS;
  const [cases, alertas, miembros] = await Promise.all([
    loadCommunityCases(env, { isDemo: opts.isDemo, since: now - 2 * period, until: now + DAY_MS }),
    approvedAlerts(env, { isDemo: opts.isDemo, since: new Date(now - period).toISOString() }),
    env.DB.prepare("SELECT nc.case_id, n.num FROM network_cases nc JOIN networks n ON n.id = nc.network_id").all<{ case_id: string; num: number }>(),
  ]);
  // Redes por su etiqueta (R-001), como las muestra la consola.
  const redesDe = new Map<string, string[]>();
  for (const m of miembros.results) redesDe.set(m.case_id, [...(redesDe.get(m.case_id) ?? []), networkLabel(m.num)]);
  const actual = byDistrict(cases.filter((c) => c.t >= now - period));
  const previo = byDistrict(cases.filter((c) => c.t < now - period)).distritos;
  const filas = DISTRICTS.map((d) => {
    const list = actual.distritos.get(d.id) ?? [];
    const victimas = distinctVictims(list);
    const sobre = canShowTerritorialStats(list.length, victimas);
    const delDistrito = alertas.filter((a) => a.distrito === d.id);
    return {
      distrito: d.id,
      casos: list.length,
      victimas,
      casos_previos: previo.get(d.id)?.length ?? 0,
      redes: sobre ? [...new Set(list.flatMap((c) => redesDe.get(c.id) ?? []))].sort() : [],
      modalidades: sobre ? [...new Set([...alertModalities(delDistrito, 5), ...fichaModalities(list)])].slice(0, 5) : [],
      sobre_umbral: sobre,
    };
  });
  return { periodo_dias: opts.dias, actualizado: nowIso(), filas, sin_distrito: actual.sinDistrito };
}
