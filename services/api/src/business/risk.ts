import {
  canShowTerritorialStats,
  CENTRAL_ORG_ID,
  countBand,
  districtOfZone,
  fichaLabel,
  linkLabel,
  MIN_CASES_FOR_STATS,
  MIN_VICTIMS_FOR_STATS,
  networkLabel,
  type AlertaBorrador,
  type CountBand,
  type FichaStored,
  type NivelRiesgo,
  type PublicRiskOverview,
  type RiskOverview,
} from "@blindaje/shared";
import type { Env } from "../env";
import { parseJsonColumn } from "../lib/db";
import { nowIso } from "../lib/ids";
import { distinctVictims, normalizePhrase, timeOf, zoneAt } from "../networks/graph";
import { hasLongDigits, sanitizeDeep } from "./safety";

/**
 * Panorama de riesgo AGREGADO por zona (distrito) y rubro, para el portal público, el portal de
 * negocios anterior y las herramientas del Asesor.
 *
 * - Solo casos con consentimiento comunitario y ficha ("solo mi denuncia" no sale de su caso), del
 *   mismo mundo que quien pregunta (los casos del demo solo cuentan en el demo).
 * - Umbral (MIN_CASES_FOR_STATS): ninguna cifra, tendencia, rubro ni modalidad sale de un conjunto
 *   con menos de 5 casos o menos de 3 víctimas distintas. Cada rasgo de una modalidad (grupo que
 *   dice ser, canal de pago, frase, plazo, tipo de amenaza) también cumple el umbral por sí solo: una
 *   frase de un solo caso podría delatar a quien denunció.
 * - Sin fuga por resta: lo público va en rangos (countBand) y sin cubo "otros"; el portal de
 *   negocios anterior, que da cifras exactas, oculta las partes que dejarían un resto chico
 *   (supresión complementaria, ver `exactParts`).
 * - Nunca identificadores: ni números, ni cuentas, ni placas, ni referencias ID-…
 * - Si el rubro no cumple el umbral en la zona, las cifras son de toda la zona (sector = null).
 */

export const RISK_PERIOD_DAYS = 28;
const WEEKS = 4;
const DAY_MS = 86_400_000;
/** Una modalidad o alerta es "activa" si su caso más reciente o su aprobación cae en estos días. */
const ACTIVE_DAYS = 14;

export const SESGO_TEXTO =
  "Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa. Solo cuentan los casos de personas que aceptaron compartir su denuncia con la comunidad, y muchos casos nunca se denuncian.";
export const AVISO_SIN_DATOS = "Aún no hay suficientes casos para mostrar cifras";
export const AVISO_SIN_DATOS_LARGO = `${AVISO_SIN_DATOS}: hacen falta al menos ${MIN_CASES_FOR_STATS} casos de ${MIN_VICTIMS_FOR_STATS} personas distintas en la zona.`;
export const OTROS_RUBROS = "Otros rubros (agregado)";
export const VARIOS_RUBROS = "Varios rubros (agregado)";
export const AVISO_RUBRO = "Aún no hay suficientes casos de tu rubro en esta zona para mostrar cifras propias: las cifras son de toda la zona.";

export interface RiskCase {
  id: string;
  code: string;
  device_id: string;
  /** Zona guardada (id de distrito o texto de una app antigua). */
  zona: string | null;
  sector: string | null;
  fecha: string;
  t: number;
  ficha: FichaStored | null;
}

export interface ModalidadInterna {
  descripcion: string;
  senales_de_alerta: string[];
  desde: string | null;
  /** Citas internas (FICHA-…, VIN-…, R-…). Nunca salen hacia un negocio. */
  evidencia: string[];
  origen: "alerta" | "fichas";
}

export interface ZoneAlert {
  id: string;
  titulo: string;
  modalidad: string;
  cuerpo: string;
  zona: string;
  /** zoneKey de la zona de la alerta. */
  key: string | null;
  /** Id del distrito, si la zona es un distrito. */
  distrito: string | null;
  que_hacer: string[];
  evidencia: string[];
  approved_at: string;
}

export interface RiskWeek {
  semana: string;
  /** Casos del alcance en la semana (vacío bajo el umbral). */
  casos: RiskCase[];
  /** Casos de toda la zona en la semana (vacío bajo el umbral). */
  zona: RiskCase[];
}

export interface RiskAnalysis {
  /** Nombre del distrito (o el texto de la zona si no es un distrito). */
  zona: string;
  sector_pedido: string | null;
  /** Alcance de las cifras: el rubro pedido si cumple el umbral; null = toda la zona. */
  sector: string | null;
  periodo_dias: number;
  /** La zona cumple el umbral (5 casos y 3 víctimas en el periodo). */
  umbral: boolean;
  nivel: NivelRiesgo;
  /** Casos del alcance (rubro o zona). Vacío bajo el umbral. */
  alcance: RiskCase[];
  semanas: RiskWeek[];
  /**
   * Rubros que cumplen el umbral por sí solos, de mayor a menor. `exacta`: su cifra exacta no deja
   * un resto chico que se pueda despejar restando (ver `exactParts`). Vacío bajo el umbral.
   */
  rubros: Array<{ sector: string; casos: RiskCase[]; exacta: boolean }>;
  /** Casos de la zona fuera de los rubros con cifra exacta (vacío bajo el umbral). */
  resto: RiskCase[];
  modalidades: ModalidadInterna[];
  escalamiento: { texto: string | null; dias: { min: number; max: number } | null; evidencia: string[] };
  aviso_umbral: string | null;
  /** FICHA-… de los casos del alcance (vacío bajo el umbral). Solo para las citas del Asesor. */
  evidencia: string[];
  alertas: ZoneAlert[];
  actualizado_at: string;
}

const CANAL: Record<string, string> = { yape: "Yape", plin: "Plin", transferencia: "transferencia bancaria", efectivo: "efectivo" };
const AMENAZA: Record<string, string> = {
  dano_local: "Amenazan con dañar el local",
  dano_fisico: "Amenazan con hacerte daño",
  dano_familia: "Amenazan a tu familia",
  dano_vehiculo: "Amenazan con dañar tu vehículo",
  difusion_informacion: "Amenazan con difundir información tuya",
};

/**
 * Clave de zona: el id del distrito si se reconoce ("San Juan de Lurigancho - E12",
 * "san-juan-de-lurigancho" y "San Juan de Lurigancho" son la misma zona); si no, el texto
 * normalizado antes de " - " (zonas de apps antiguas o de prueba, que no cuentan en el mapa).
 */
export function zoneKey(zona: string | null | undefined): string | null {
  const district = districtOfZone(zona);
  if (district) return district.id;
  const d = zoneAt(zona ?? null, "distrito");
  const k = d ? normalizePhrase(d) : "";
  return k || null;
}

/** Nombre para mostrar: el del distrito si se reconoce; si no, el texto antes de " - ". */
export function zoneLabel(zona: string): string {
  return districtOfZone(zona)?.name ?? (zoneAt(zona, "distrito") ?? zona).trim();
}

export function sectorKey(sector: string | null | undefined): string | null {
  const k = sector ? normalizePhrase(sector) : "";
  return k || null;
}

function limaDate(ms: number): string {
  return new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);
}

export function meets(cases: Array<Pick<RiskCase, "device_id">>): boolean {
  return canShowTerritorialStats(cases.length, distinctVictims(cases));
}

/** Rango público de un conjunto de casos (null bajo el umbral). */
export function bandOf(cases: Array<Pick<RiskCase, "device_id">>): CountBand | null {
  return countBand(cases.length, distinctVictims(cases));
}

// ---------------------------------------------------------------------------
// Casos y alertas por zona
// ---------------------------------------------------------------------------

/**
 * Casos comunitarios con ficha del mundo pedido (real o demo) cuya fecha (primer contacto) cae en
 * [since, until]. Base de todo lo territorial: mapa, panorama, Asesor y vista de zonas.
 */
export async function loadCommunityCases(env: Env, opts: { isDemo: boolean; since: number; until: number }): Promise<RiskCase[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, code, device_id, sector, zona_cuadricula, primer_contacto, created_at, ficha_json FROM cases
     WHERE consent_mode = 'comunitario' AND ficha_json IS NOT NULL AND is_demo = ?`,
  )
    .bind(opts.isDemo ? 1 : 0)
    .all<{
      id: string;
      code: string;
      device_id: string;
      sector: string | null;
      zona_cuadricula: string | null;
      primer_contacto: string | null;
      created_at: string;
      ficha_json: string;
    }>();
  const out: RiskCase[] = [];
  for (const r of results) {
    const ficha = parseJsonColumn<FichaStored>(r.ficha_json);
    const fecha = ficha?.primer_contacto ?? r.primer_contacto ?? r.created_at;
    const t = timeOf(fecha);
    if (!Number.isFinite(t) || t < opts.since || t > opts.until) continue;
    out.push({
      id: r.id,
      code: r.code,
      device_id: r.device_id,
      zona: r.zona_cuadricula ?? ficha?.zona ?? null,
      sector: r.sector ?? ficha?.sector ?? null,
      fecha,
      t,
      ficha,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Casos comunitarios con ficha de la zona, en el periodo. */
export async function loadZoneCases(env: Env, zona: string, opts: { isDemo: boolean; now: number }): Promise<RiskCase[]> {
  const key = zoneKey(zona);
  if (!key) return [];
  const all = await loadCommunityCases(env, { isDemo: opts.isDemo, since: opts.now - RISK_PERIOD_DAYS * DAY_MS, until: opts.now + DAY_MS });
  return all.filter((c) => zoneKey(c.zona) === key);
}

/**
 * La tabla alerts no tiene is_demo: las alertas que el Vigía redacta con casos del demo llevan este
 * prefijo en pattern_key. Sin prefijo (o sin pattern_key), la alerta es del mundo real.
 */
export const DEMO_PATTERN_PREFIX = "demo:";

/** Condición SQL del mundo de una alerta (alias `a`). */
export function alertWorldSql(isDemo: boolean): string {
  return `COALESCE(a.pattern_key, '') ${isDemo ? "" : "NOT "}LIKE '${DEMO_PATTERN_PREFIX}%'`;
}

/**
 * Alertas aprobadas por el equipo central (organización central) del mundo pedido, las más
 * recientes primero. Las de otras organizaciones (anteriores al rediseño) no salen por aquí.
 */
export async function approvedAlerts(env: Env, opts: { isDemo: boolean; since?: string; limit?: number }): Promise<ZoneAlert[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.draft_json, a.approved_at FROM alerts a
     WHERE a.org_id = ? AND a.status = 'aprobada' AND a.approved_at >= ? AND ${alertWorldSql(opts.isDemo)}
     ORDER BY a.approved_at DESC LIMIT ?`,
  )
    .bind(CENTRAL_ORG_ID, opts.since ?? "", opts.limit ?? 200)
    .all<{ id: string; draft_json: string; approved_at: string }>();
  const out: ZoneAlert[] = [];
  for (const r of results) {
    const d = parseJsonColumn<AlertaBorrador>(r.draft_json);
    if (!d) continue;
    out.push({
      id: r.id,
      titulo: d.titulo,
      modalidad: d.modalidad,
      cuerpo: d.cuerpo,
      zona: d.zona,
      key: zoneKey(d.zona),
      distrito: districtOfZone(d.zona)?.id ?? null,
      que_hacer: d.que_hacer,
      evidencia: d.evidencia.filter((e) => !/^ID-/i.test(e)),
      approved_at: r.approved_at,
    });
  }
  return out;
}

/** Alertas aprobadas para la zona, aprobadas dentro del periodo. */
export async function loadZoneAlerts(env: Env, zona: string, opts: { isDemo: boolean; now: number }): Promise<ZoneAlert[]> {
  const key = zoneKey(zona);
  if (!key) return [];
  const since = new Date(opts.now - RISK_PERIOD_DAYS * DAY_MS).toISOString();
  return (await approvedAlerts(env, { isDemo: opts.isDemo, since })).filter((a) => a.key === key).slice(0, 20);
}

/** VIN-… confirmados entre los casos y R-… que los contienen (solo para citas internas). */
async function linkAndNetworkLabels(env: Env, caseIds: string[]): Promise<{ links: string[]; networks: string[] }> {
  if (!caseIds.length) return { links: [], networks: [] };
  const ph = caseIds.map(() => "?").join(",");
  const [l, n] = await env.DB.batch([
    env.DB.prepare(`SELECT num FROM links WHERE status = 'confirmado' AND case_a IN (${ph}) AND case_b IN (${ph}) ORDER BY num`).bind(...caseIds, ...caseIds),
    env.DB.prepare(`SELECT DISTINCT n.num FROM networks n JOIN network_cases nc ON nc.network_id = n.id WHERE nc.case_id IN (${ph}) ORDER BY n.num`).bind(...caseIds),
  ]);
  return {
    links: (l!.results as Array<{ num: number }>).map((r) => linkLabel(r.num)),
    networks: (n!.results as Array<{ num: number }>).map((r) => networkLabel(r.num)),
  };
}

// ---------------------------------------------------------------------------
// Modalidades a partir de las fichas
// ---------------------------------------------------------------------------

type FeatureKind = "grupo" | "frase" | "canal" | "plazo" | "amenaza";
const PRIORITY: FeatureKind[] = ["grupo", "frase", "canal", "plazo", "amenaza"];

interface Feature {
  kind: FeatureKind;
  key: string;
  label: string;
  cases: RiskCase[];
}

function features(cases: RiskCase[]): Feature[] {
  const groups = new Map<string, Feature>();
  const add = (c: RiskCase, kind: FeatureKind, key: string, label: string) => {
    if (!key) return;
    const k = `${kind}|${key}`;
    const g = groups.get(k) ?? { kind, key, label, cases: [] };
    if (!g.cases.includes(c)) g.cases.push(c);
    groups.set(k, g);
  };
  for (const c of cases) {
    const f = c.ficha;
    if (!f) continue;
    if (f.grupo_que_dice_ser && !hasLongDigits(f.grupo_que_dice_ser)) add(c, "grupo", normalizePhrase(f.grupo_que_dice_ser), f.grupo_que_dice_ser.trim());
    if (f.canal_pago && CANAL[f.canal_pago]) add(c, "canal", f.canal_pago, CANAL[f.canal_pago]!);
    if (f.plazo_horas && f.plazo_horas > 0) add(c, "plazo", String(f.plazo_horas), String(f.plazo_horas));
    if (f.tipo_amenaza && AMENAZA[f.tipo_amenaza]) add(c, "amenaza", f.tipo_amenaza, AMENAZA[f.tipo_amenaza]!);
    for (const frase of new Set(f.frases_firma.map((x) => x.trim()))) {
      // Una frase con números (un teléfono o una cuenta dictada) nunca es una señal pública.
      if (frase && !hasLongDigits(frase) && !/ID-/i.test(frase)) add(c, "frase", normalizePhrase(frase), frase);
    }
  }
  return [...groups.values()]
    .filter((g) => meets(g.cases))
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || b.cases.length - a.cases.length || a.key.localeCompare(b.key));
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

function modalidadFromCluster(cluster: Feature[]): Omit<ModalidadInterna, "evidencia"> & { cases: RiskCase[] } {
  const of = (k: FeatureKind) => cluster.filter((f) => f.kind === k);
  const partes: string[] = [];
  const grupo = of("grupo")[0];
  const canal = of("canal")[0];
  const plazo = of("plazo")[0];
  if (grupo) partes.push(`dice ser de “${grupo.label}”`);
  if (canal) partes.push(`pide el pago por ${canal.label}`);
  if (plazo) partes.push(`da un plazo de ${plazo.label} horas`);
  const descripcion = partes.length
    ? `${capitalize(`quien extorsiona ${joinEs(partes)}`)}.`
    : "Quien extorsiona repite el mismo guion en varios negocios de la zona.";
  const senales = [
    ...of("frase").map((f) => `Usan la frase “${f.label}”`),
    ...(grupo ? [`Dicen ser de “${grupo.label}”`] : []),
    ...(canal ? [`Piden el pago por ${canal.label}`] : []),
    ...(plazo ? [`Dan un plazo corto: ${plazo.label} horas`] : []),
    ...of("amenaza").map((f) => f.label),
  ];
  const cases = [...new Map(cluster.flatMap((f) => f.cases).map((c) => [c.id, c])).values()].sort((a, b) => a.t - b.t);
  return { descripcion, senales_de_alerta: senales, desde: limaDate(cases[0]!.t), origen: "fichas", cases };
}

/** Agrupa los rasgos que comparten la mayoría de sus casos (como el Vigía) en modalidades. */
function clusterFeatures(feats: Feature[]): Feature[][] {
  const clusters: Array<{ feats: Feature[]; ids: Set<string> }> = [];
  for (const f of feats) {
    const ids = f.cases.map((c) => c.id);
    const target = clusters.find((cl) => ids.filter((id) => cl.ids.has(id)).length / Math.min(ids.length, cl.ids.size) >= 0.5);
    if (target) {
      target.feats.push(f);
      for (const id of ids) target.ids.add(id);
    } else {
      clusters.push({ feats: [f], ids: new Set(ids) });
    }
  }
  return clusters.map((c) => c.feats);
}

/** Descripciones de las modalidades de las fichas de una zona (sin citas), para la vista de zonas. */
export function fichaModalities(cases: RiskCase[]): string[] {
  return clusterFeatures(features(cases)).map((cl) => modalidadFromCluster(cl).descripcion);
}

const ADVICE_SENTENCE = /no pagues|negoci|denunci|1818|\b105\b|guarda|evidencia|blindaje/i;

function alertSignals(a: ZoneAlert): string[] {
  const sentences = (a.cuerpo.match(/[^.!?]+[.!?]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
  return sentences.filter((s) => !ADVICE_SENTENCE.test(s));
}

// ---------------------------------------------------------------------------
// Escalamiento y nivel
// ---------------------------------------------------------------------------

function escalation(cases: RiskCase[], sectorScope: boolean): RiskAnalysis["escalamiento"] & { any: boolean } {
  const dias: number[] = [];
  const evidencia = new Set<string>();
  let any = false;
  for (const c of cases) {
    const f = c.ficha;
    if (!f?.escalamiento.length) continue;
    any = true;
    if (!f.plazo_horas) continue;
    const deadline = c.t + f.plazo_horas * 3600_000;
    for (const e of f.escalamiento) {
      if (!e.fecha) continue;
      const t = timeOf(e.fecha);
      if (!Number.isFinite(t) || t < deadline) continue;
      dias.push(Math.max(0, Math.round((t - deadline) / DAY_MS)));
      evidencia.add(fichaLabel(c.code));
    }
  }
  const donde = sectorScope ? "En tu rubro, en esta zona," : "En esta zona,";
  if (!dias.length) {
    return {
      any,
      texto: any ? `${donde} hubo intimidación física después de las primeras amenazas. No esperes a que pase para denunciar.` : null,
      dias: null,
      evidencia: [],
    };
  }
  const min = Math.min(...dias);
  const max = Math.max(...dias);
  const dias_ = (d: number) => (d === 1 ? "un día" : `${d} días`);
  const cuando =
    min === max
      ? min === 0
        ? "el mismo día en que venció el plazo"
        : min === 1
          ? "al día siguiente de vencido el plazo"
          : `${dias_(min)} después de vencido el plazo`
      : `entre ${min === 0 ? "el mismo día" : dias_(min)} y ${dias_(max)} después de vencido el plazo`;
  return {
    any,
    texto: `${donde} la intimidación física llegó ${cuando} que dieron para pagar. No esperes al vencimiento para denunciar.`,
    dias: { min, max },
    evidencia: [...evidencia],
  };
}

/**
 * Nivel de riesgo (regla fija, documentada en docs/devlog/negocios.md): sin_datos bajo el umbral;
 * si no, un punto por 10 o más casos, otro por 20 o más, uno por intimidación física y uno por una
 * modalidad activa (alerta aprobada o rasgo común en los últimos 14 días). 0 = bajo, 1-2 = medio,
 * 3 o más = alto. Los cortes de 10 y 20 coinciden con los de countBand: el nivel no dice de la
 * cifra más de lo que ya dice su rango.
 */
export function riskLevel(o: { umbral: boolean; casos: number; escalamiento: boolean; modalidadActiva: boolean }): NivelRiesgo {
  if (!o.umbral) return "sin_datos";
  const puntos = (o.casos >= 10 ? 1 : 0) + (o.casos >= 20 ? 1 : 0) + (o.escalamiento ? 1 : 0) + (o.modalidadActiva ? 1 : 0);
  return puntos === 0 ? "bajo" : puntos <= 2 ? "medio" : "alto";
}

function levelOf(scope: RiskCase[], zoneCases: RiskCase[], alertas: Array<Pick<ZoneAlert, "approved_at">>, umbral: boolean, now: number, escAny: boolean): NivelRiesgo {
  const recent = now - ACTIVE_DAYS * DAY_MS;
  const modalidadActiva =
    alertas.some((a) => timeOf(a.approved_at) >= recent) || (umbral && features(zoneCases).some((f) => f.cases.some((c) => c.t >= recent)));
  return riskLevel({ umbral, casos: scope.length, escalamiento: escAny, modalidadActiva });
}

/** Nivel de una zona para todos los rubros (el mapa público): la misma regla que `analyzeRisk` sin rubro. */
export function zoneLevel(zoneCases: RiskCase[], alertas: Array<Pick<ZoneAlert, "approved_at">>, now: number): NivelRiesgo {
  const umbral = meets(zoneCases);
  return levelOf(zoneCases, zoneCases, alertas, umbral, now, umbral && escalation(zoneCases, false).any);
}

// ---------------------------------------------------------------------------
// Supresión complementaria (cifras exactas)
// ---------------------------------------------------------------------------

/**
 * Partes con cifra exacta junto a un total exacto: si lo que queda fuera (total menos las partes
 * exactas) no es cero y no cumple el umbral por sí solo, una resta lo revelaría. Se quita la parte
 * exacta más chica y se vuelve a probar. Las partes no se superponen (rubros o semanas).
 */
function exactParts<T extends { casos: RiskCase[] }>(total: RiskCase[], parts: T[]): Set<T> {
  const visible = new Set(parts);
  for (;;) {
    const shown = new Set([...visible].flatMap((p) => p.casos.map((c) => c.id)));
    const rest = total.filter((c) => !shown.has(c.id));
    if (!rest.length || meets(rest) || !visible.size) return visible;
    const smallest = [...visible].sort((a, b) => a.casos.length - b.casos.length)[0]!;
    visible.delete(smallest);
  }
}

// ---------------------------------------------------------------------------
// Análisis completo
// ---------------------------------------------------------------------------

export async function analyzeRisk(env: Env, q: { zona: string; sector: string | null; isDemo: boolean; now?: Date }): Promise<RiskAnalysis> {
  const now = (q.now ?? new Date()).getTime();
  const zona = zoneLabel(q.zona);
  const [zoneCases, alertas] = await Promise.all([
    loadZoneCases(env, q.zona, { isDemo: q.isDemo, now }),
    loadZoneAlerts(env, q.zona, { isDemo: q.isDemo, now }),
  ]);
  const umbral = meets(zoneCases);
  const pedido = q.sector?.trim() || null;
  const sKey = sectorKey(pedido);

  // Rubros que cumplen el umbral solos; los que dejarían un resto chico al lado del total pierden la cifra exacta.
  const porRubro = new Map<string, RiskCase[]>();
  for (const c of umbral ? zoneCases : []) {
    const s = c.sector ?? "sin_dato";
    porRubro.set(s, [...(porRubro.get(s) ?? []), c]);
  }
  const nombrados = [...porRubro.entries()]
    .filter(([s, list]) => s !== "sin_dato" && meets(list))
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([sector, casos]) => ({ sector, casos, exacta: false }));
  const exactos = exactParts(zoneCases, nombrados);
  for (const r of exactos) r.exacta = true;
  const enRubroExacto = new Set([...exactos].flatMap((r) => r.casos.map((c) => c.id)));
  const resto = umbral ? zoneCases.filter((c) => !enRubroExacto.has(c.id)) : [];

  // El rubro pedido es el alcance solo si su cifra exacta se puede mostrar.
  const rubroPedido = sKey ? nombrados.find((r) => r.exacta && sectorKey(r.sector) === sKey) : undefined;
  const useSector = Boolean(rubroPedido);
  const scope = !umbral ? [] : rubroPedido ? rubroPedido.casos : zoneCases;

  // Modalidades: alertas aprobadas (ya revisadas por el equipo central) y rasgos comunes de las
  // fichas. Bajo el umbral, ninguna: tampoco las de una alerta (la alerta sigue en /alerts).
  const fromAlerts: ModalidadInterna[] = umbral
    ? alertas.map((a) => ({
        descripcion: capitalize(a.modalidad.trim()),
        senales_de_alerta: alertSignals(a),
        desde: a.approved_at.slice(0, 10),
        evidencia: [...a.evidencia],
        origen: "alerta",
      }))
    : [];
  const fromFichas: ModalidadInterna[] = [];
  if (umbral) {
    for (const cluster of clusterFeatures(features(zoneCases))) {
      const m = modalidadFromCluster(cluster);
      const labels = await linkAndNetworkLabels(env, m.cases.map((c) => c.id));
      const evidencia = [...m.cases.map((c) => fichaLabel(c.code)), ...labels.links, ...labels.networks];
      // Si una alerta aprobada ya describe estos casos, se usa su texto y se suman las señales.
      const alerta = fromAlerts.find((a) => {
        const fichasA = a.evidencia.filter((e) => e.startsWith("FICHA-"));
        const inter = fichasA.filter((e) => evidencia.includes(e)).length;
        return fichasA.length > 0 && inter / Math.min(fichasA.length, m.cases.length) >= 0.5;
      });
      if (alerta) {
        alerta.senales_de_alerta = [...new Set([...alerta.senales_de_alerta, ...m.senales_de_alerta])];
        alerta.evidencia = [...new Set([...alerta.evidencia, ...evidencia])];
        if (m.desde && (!alerta.desde || m.desde < alerta.desde)) alerta.desde = m.desde;
      } else {
        fromFichas.push({ descripcion: m.descripcion, senales_de_alerta: m.senales_de_alerta, desde: m.desde, evidencia, origen: "fichas" });
      }
    }
  }
  const modalidades = [...fromAlerts, ...fromFichas];

  const esc = umbral ? escalation(scope, useSector) : { any: false, texto: null, dias: null, evidencia: [] };

  const semanas: RiskWeek[] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const start = now - (w + 1) * 7 * DAY_MS;
    const end = now - w * 7 * DAY_MS;
    const inWeek = (c: RiskCase) => c.t >= start && c.t < end;
    semanas.push({ semana: limaDate(start), casos: scope.filter(inWeek), zona: umbral ? zoneCases.filter(inWeek) : [] });
  }

  return {
    zona,
    sector_pedido: pedido,
    sector: rubroPedido ? pedido : null,
    periodo_dias: RISK_PERIOD_DAYS,
    umbral,
    nivel: levelOf(scope, zoneCases, alertas, umbral, now, esc.any),
    alcance: scope,
    semanas,
    rubros: nombrados,
    resto,
    modalidades,
    escalamiento: { texto: esc.texto, dias: esc.dias, evidencia: esc.evidencia },
    aviso_umbral: !umbral ? AVISO_SIN_DATOS_LARGO : sKey && !useSector ? AVISO_RUBRO : null,
    evidencia: scope.map((c) => fichaLabel(c.code)),
    alertas,
    actualizado_at: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

/** Cifras en rangos (lo público y lo que ve el Asesor): cada parte con su rango propio, sin cubo "otros". */
export function riskBands(a: RiskAnalysis): Pick<PublicRiskOverview, "casos_periodo" | "tendencia" | "sectores_afectados"> {
  return {
    casos_periodo: a.umbral ? bandOf(a.alcance) : null,
    tendencia: a.semanas.map((w) => ({ semana: w.semana, casos: a.umbral ? bandOf(w.casos) : null })),
    sectores_afectados: a.rubros.flatMap((r) => {
      const casos = bandOf(r.casos);
      return casos ? [{ sector: r.sector, casos }] : [];
    }),
  };
}

/**
 * Semanas con cifra exacta (portal de negocios anterior). Una semana se muestra si cumple el
 * umbral, si con las demás exactas no deja un resto chico dentro del alcance y, cuando el alcance
 * es un rubro, si lo que el resto de la zona sumó esa semana tampoco es chico (la semana de la zona
 * menos la del rubro).
 */
function legacyWeeks(a: RiskAnalysis): RiskOverview["tendencia"] {
  if (!a.umbral) return a.semanas.map((w) => ({ semana: w.semana, casos: null }));
  const ok = (rest: RiskCase[]) => !rest.length || meets(rest);
  const candidatas = a.semanas.filter((w) => {
    if (!meets(w.casos)) return false;
    if (!a.sector) return true;
    const ids = new Set(w.casos.map((c) => c.id));
    return ok(w.zona.filter((c) => !ids.has(c.id)));
  });
  const visibles = exactParts(a.alcance, candidatas);
  return a.semanas.map((w) => ({ semana: w.semana, casos: visibles.has(w) ? w.casos.length : null }));
}

/**
 * Rubros con cifra exacta (portal de negocios anterior). "Otros rubros" solo si el resto cumple el
 * umbral por sí solo; si ningún rubro llega solo al umbral, el agregado es de "varios rubros" (es
 * el total de la zona).
 */
function legacySectors(a: RiskAnalysis): RiskOverview["sectores_afectados"] {
  if (!a.umbral) return [];
  const out: RiskOverview["sectores_afectados"] = a.rubros.map((r) => ({ sector: r.sector, casos: r.exacta ? r.casos.length : null }));
  if (a.resto.length) {
    if (a.rubros.some((r) => r.exacta) && meets(a.resto)) out.push({ sector: OTROS_RUBROS, casos: a.resto.length });
    else if (!a.rubros.length) out.push({ sector: VARIOS_RUBROS, casos: a.resto.length });
  }
  return out;
}

function modalidadesView(a: RiskAnalysis) {
  return a.modalidades.map((m) => ({ descripcion: m.descripcion, senales_de_alerta: m.senales_de_alerta, desde: m.desde }));
}

/** Vista para el portal de negocios anterior: cifras exactas sin fuga por resta, sin citas internas y con los textos saneados. */
export function toRiskOverview(a: RiskAnalysis): RiskOverview {
  return sanitizeDeep({
    zona: a.zona,
    sector: a.sector,
    periodo_dias: a.periodo_dias,
    nivel_riesgo: a.nivel,
    casos_periodo: a.umbral ? a.alcance.length : null,
    tendencia: legacyWeeks(a),
    modalidades_activas: modalidadesView(a),
    escalamiento: a.escalamiento.texto,
    sectores_afectados: legacySectors(a),
    sesgo: SESGO_TEXTO,
    aviso_umbral: a.aviso_umbral,
    actualizado_at: a.actualizado_at,
  });
}

/** Vista pública (GET /v1/public/risk): rangos en vez de cifras, sin citas internas y con los textos saneados. */
export function toPublicRiskOverview(a: RiskAnalysis, opts: { zona: string; demo: boolean }): PublicRiskOverview {
  return sanitizeDeep({
    zona: opts.zona,
    sector: a.sector,
    periodo_dias: a.periodo_dias,
    nivel_riesgo: a.nivel,
    ...riskBands(a),
    modalidades_activas: modalidadesView(a),
    escalamiento: a.escalamiento.texto,
    sesgo: SESGO_TEXTO,
    aviso_umbral: a.aviso_umbral,
    actualizado_at: a.actualizado_at,
    demo: opts.demo,
  });
}
