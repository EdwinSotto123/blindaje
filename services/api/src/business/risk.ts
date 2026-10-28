import {
  canShowTerritorialStats,
  fichaLabel,
  linkLabel,
  MIN_CASES_FOR_STATS,
  MIN_VICTIMS_FOR_STATS,
  networkLabel,
  type AlertaBorrador,
  type FichaStored,
  type NivelRiesgo,
  type RiskOverview,
} from "@blindaje/shared";
import type { Env } from "../env";
import { parseJsonColumn } from "../lib/db";
import { nowIso } from "../lib/ids";
import { distinctVictims, normalizePhrase, timeOf, zoneAt } from "../networks/graph";
import { hasLongDigits, sanitizeDeep } from "./safety";

/**
 * Panorama de riesgo AGREGADO por zona (distrito) y rubro, para el portal de negocios y para las
 * herramientas del Asesor.
 *
 * - Solo casos con consentimiento comunitario y ficha ("solo mi denuncia" no sale de su caso), del
 *   mismo mundo que quien pregunta (los casos del demo solo cuentan para cuentas del demo).
 * - Umbral (MIN_CASES_FOR_STATS): ninguna cifra, tendencia, rubro ni modalidad sale de un conjunto
 *   con menos de 5 casos o menos de 3 víctimas distintas. Cada rasgo de una modalidad (grupo que
 *   dice ser, canal de pago, frase, plazo, tipo de amenaza) también cumple el umbral por sí solo: una
 *   frase de un solo caso podría delatar a quien denunció.
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
export const AVISO_RUBRO = "Aún no hay suficientes casos de tu rubro en esta zona para mostrar cifras propias: las cifras son de toda la zona.";

export interface RiskCase {
  id: string;
  code: string;
  org_id: string;
  device_id: string;
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
  que_hacer: string[];
  evidencia: string[];
  approved_at: string;
}

export interface RiskAnalysis {
  zona: string;
  sector_pedido: string | null;
  /** Alcance de las cifras: el rubro pedido si cumple el umbral; null = toda la zona. */
  sector: string | null;
  periodo_dias: number;
  /** La zona cumple el umbral (5 casos y 3 víctimas en el periodo). */
  umbral: boolean;
  nivel: NivelRiesgo;
  casos: number | null;
  tendencia: Array<{ semana: string; casos: number | null }>;
  modalidades: ModalidadInterna[];
  escalamiento: { texto: string | null; dias: { min: number; max: number } | null; evidencia: string[] };
  sectores_afectados: Array<{ sector: string; casos: number | null }>;
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

/** Clave de zona: el distrito normalizado ("Lima Este - E12" y "lima este" son la misma zona). */
export function zoneKey(zona: string | null | undefined): string | null {
  const d = zoneAt(zona ?? null, "distrito");
  const k = d ? normalizePhrase(d) : "";
  return k || null;
}

function sectorKey(sector: string | null | undefined): string | null {
  const k = sector ? normalizePhrase(sector) : "";
  return k || null;
}

function limaDate(ms: number): string {
  return new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);
}

function meets(cases: Array<Pick<RiskCase, "device_id">>): boolean {
  return canShowTerritorialStats(cases.length, distinctVictims(cases));
}

/** Casos comunitarios con ficha de la zona, en el periodo. */
export async function loadZoneCases(env: Env, zona: string, opts: { isDemo: boolean; now: number }): Promise<RiskCase[]> {
  const key = zoneKey(zona);
  if (!key) return [];
  const since = opts.now - RISK_PERIOD_DAYS * DAY_MS;
  const { results } = await env.DB.prepare(
    `SELECT id, code, org_id, device_id, sector, zona_cuadricula, primer_contacto, created_at, ficha_json FROM cases
     WHERE consent_mode = 'comunitario' AND ficha_json IS NOT NULL AND is_demo = ?`,
  )
    .bind(opts.isDemo ? 1 : 0)
    .all<{
      id: string;
      code: string;
      org_id: string;
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
    if (zoneKey(r.zona_cuadricula ?? ficha?.zona) !== key) continue;
    const fecha = ficha?.primer_contacto ?? r.primer_contacto ?? r.created_at;
    const t = timeOf(fecha);
    if (!Number.isFinite(t) || t < since || t > opts.now + DAY_MS) continue;
    out.push({ id: r.id, code: r.code, org_id: r.org_id, device_id: r.device_id, sector: r.sector ?? ficha?.sector ?? null, fecha, t, ficha });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Alertas aprobadas de la organización para la zona, aprobadas dentro del periodo. */
export async function loadZoneAlerts(env: Env, orgId: string, zona: string, now: number): Promise<ZoneAlert[]> {
  const key = zoneKey(zona);
  const since = new Date(now - RISK_PERIOD_DAYS * DAY_MS).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id, draft_json, approved_at FROM alerts WHERE org_id = ? AND status = 'aprobada' AND approved_at >= ? ORDER BY approved_at DESC LIMIT 20",
  )
    .bind(orgId, since)
    .all<{ id: string; draft_json: string; approved_at: string }>();
  const out: ZoneAlert[] = [];
  for (const r of results) {
    const d = parseJsonColumn<AlertaBorrador>(r.draft_json);
    if (!d || zoneKey(d.zona) !== key) continue;
    out.push({
      id: r.id,
      titulo: d.titulo,
      modalidad: d.modalidad,
      cuerpo: d.cuerpo,
      que_hacer: d.que_hacer,
      evidencia: d.evidencia.filter((e) => !/^ID-/i.test(e)),
      approved_at: r.approved_at,
    });
  }
  return out;
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
  const cuando = (d: number) => (d === 0 ? "el mismo día" : d === 1 ? "al día siguiente" : `a los ${d} días`);
  const rango = min === max ? cuando(min) : `entre ${min === 0 ? "el mismo día" : min} y ${max} días`;
  return {
    any,
    texto: `${donde} la intimidación física llegó ${rango} después de vencido el plazo que dieron para pagar. No esperes al vencimiento para denunciar.`,
    dias: { min, max },
    evidencia: [...evidencia],
  };
}

/**
 * Nivel de riesgo (regla fija, documentada en docs/devlog/negocios.md): sin_datos bajo el umbral;
 * si no, un punto por 8 o más casos, otro por 15 o más, uno por intimidación física y uno por una
 * modalidad activa (alerta aprobada o rasgo común en los últimos 14 días). 0 = bajo, 1-2 = medio,
 * 3 o más = alto.
 */
export function riskLevel(o: { umbral: boolean; casos: number; escalamiento: boolean; modalidadActiva: boolean }): NivelRiesgo {
  if (!o.umbral) return "sin_datos";
  const puntos = (o.casos >= 8 ? 1 : 0) + (o.casos >= 15 ? 1 : 0) + (o.escalamiento ? 1 : 0) + (o.modalidadActiva ? 1 : 0);
  return puntos === 0 ? "bajo" : puntos <= 2 ? "medio" : "alto";
}

// ---------------------------------------------------------------------------
// Análisis completo
// ---------------------------------------------------------------------------

export async function analyzeRisk(
  env: Env,
  q: { zona: string; sector: string | null; orgId: string; isDemo: boolean; now?: Date },
): Promise<RiskAnalysis> {
  const now = (q.now ?? new Date()).getTime();
  const zona = (zoneAt(q.zona, "distrito") ?? q.zona).trim();
  const [zoneCases, alertas] = await Promise.all([loadZoneCases(env, zona, { isDemo: q.isDemo, now }), loadZoneAlerts(env, q.orgId, zona, now)]);
  const umbral = meets(zoneCases);
  const pedido = q.sector?.trim() || null;
  const sKey = sectorKey(pedido);
  const sectorCases = sKey ? zoneCases.filter((c) => sectorKey(c.sector) === sKey) : [];
  const useSector = Boolean(sKey) && umbral && meets(sectorCases);
  const scope = useSector ? sectorCases : zoneCases;

  // Modalidades: alertas aprobadas (ya revisadas por el gremio) y rasgos comunes de las fichas.
  const fromAlerts: ModalidadInterna[] = alertas.map((a) => ({
    descripcion: capitalize(a.modalidad.trim()),
    senales_de_alerta: alertSignals(a),
    desde: a.approved_at.slice(0, 10),
    evidencia: a.evidencia,
    origen: "alerta",
  }));
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
  const recent = now - ACTIVE_DAYS * DAY_MS;
  const modalidadActiva =
    alertas.some((a) => timeOf(a.approved_at) >= recent) ||
    (umbral && features(zoneCases).some((f) => f.cases.some((c) => c.t >= recent)));

  const tendencia: RiskAnalysis["tendencia"] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const start = now - (w + 1) * 7 * DAY_MS;
    const end = now - w * 7 * DAY_MS;
    const inWeek = scope.filter((c) => c.t >= start && c.t < end);
    tendencia.push({ semana: limaDate(start), casos: umbral && meets(inWeek) ? inWeek.length : null });
  }

  const sectores = new Map<string, RiskCase[]>();
  for (const c of zoneCases) {
    const s = c.sector ?? "sin_dato";
    sectores.set(s, [...(sectores.get(s) ?? []), c]);
  }
  // Rubros: solo los que cumplen el umbral por sí solos; el resto va sumado en "otros rubros" (un
  // rubro con un solo caso en la zona le diría a quien extorsiona que alguien de ese rubro denunció).
  const sectores_afectados: RiskAnalysis["sectores_afectados"] = [];
  if (umbral) {
    let otros: RiskCase[] = [];
    for (const [sector, list] of [...sectores.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      if (sector !== "sin_dato" && meets(list)) sectores_afectados.push({ sector, casos: list.length });
      else otros = [...otros, ...list];
    }
    if (otros.length) sectores_afectados.push({ sector: OTROS_RUBROS, casos: meets(otros) ? otros.length : null });
  }

  return {
    zona,
    sector_pedido: pedido,
    sector: useSector ? pedido : null,
    periodo_dias: RISK_PERIOD_DAYS,
    umbral,
    nivel: riskLevel({ umbral, casos: scope.length, escalamiento: esc.any, modalidadActiva }),
    casos: umbral ? scope.length : null,
    tendencia,
    modalidades,
    escalamiento: { texto: esc.texto, dias: esc.dias, evidencia: esc.evidencia },
    sectores_afectados,
    aviso_umbral: !umbral ? AVISO_SIN_DATOS_LARGO : sKey && !useSector ? AVISO_RUBRO : null,
    evidencia: umbral ? scope.map((c) => fichaLabel(c.code)) : [],
    alertas,
    actualizado_at: nowIso(),
  };
}

/** Vista para el portal: sin citas internas y con todos los textos saneados. */
export function toRiskOverview(a: RiskAnalysis): RiskOverview {
  return sanitizeDeep({
    zona: a.zona,
    sector: a.sector,
    periodo_dias: a.periodo_dias,
    nivel_riesgo: a.nivel,
    casos_periodo: a.casos,
    tendencia: a.tendencia,
    modalidades_activas: a.modalidades.map((m) => ({ descripcion: m.descripcion, senales_de_alerta: m.senales_de_alerta, desde: m.desde })),
    escalamiento: a.escalamiento.texto,
    sectores_afectados: a.sectores_afectados,
    sesgo: SESGO_TEXTO,
    aviso_umbral: a.aviso_umbral,
    actualizado_at: a.actualizado_at,
  });
}
