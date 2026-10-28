import {
  AlertaBorrador,
  LINEA_DENUNCIAS,
  LINEA_EMERGENCIAS,
  MIN_CASES_FOR_STATS,
  MIN_VICTIMS_FOR_STATS,
  PROMPT_VERSION,
  VIGIA_SYSTEM,
  fichaLabel,
  linkLabel,
  type AlertView,
  type FichaStored,
} from "@blindaje/shared";
import type { Env } from "../env";
import { audit } from "../audit";
import { ALERT_SELECT, alertView, type AlertRow } from "../console/views";
import { sha256Hex } from "../lib/crypto";
import { parseJsonColumn } from "../lib/db";
import { b64ToBytes } from "../lib/encoding";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { distinctVictims, normalizePhrase, timeOf, zoneAt } from "../networks/graph";
import { SYSTEM_ACTOR, type Actor } from "../types";
import { metaClientFor, runCheckedAgent } from "./common";
import { hasLongNumber, humanizeIsoDates, redactLongNumbers, stripCitations, toAgentError } from "./tools/safety";

/**
 * Vigía (10.4): detecta modalidades emergentes entre casos con consentimiento comunitario y
 * redacta borradores de alerta para que el gremio los revise.
 *
 * Patrón = mismo grupo que dice ser, mismo canal de pago, frase firma repetida o identificador
 * compartido, en la misma zona, con al menos 5 casos de al menos 3 víctimas distintas dentro de
 * una ventana de 14 días. Patrones que comparten la mayoría de sus casos se agrupan en una sola
 * alerta. Cada organización con casos en el patrón recibe su propio borrador (lo aprueba su gremio).
 * Deduplicación: no se repite una alerta del mismo patrón para la misma organización si ya hubo
 * una en los 14 días previos al caso más reciente del patrón.
 */

export interface VigiaRunOptions {
  trigger: "cron" | "manual";
  cron?: string;
  actor?: Actor;
  /** Días hacia atrás que se revisan (por defecto 30). */
  lookbackDays?: number;
  /** Tarjeta con Muse Image (no esencial). Por defecto true. */
  image?: boolean;
  now?: Date;
}

export const WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const VIGIA_MODEL = "muse-spark-1.3";
const IMAGE_MODEL = "muse-image-1.0";

export type PatternKind = "grupo" | "identificador" | "frase" | "canal";
const KIND_PRIORITY: PatternKind[] = ["grupo", "identificador", "frase", "canal"];

interface VigiaCase {
  id: string;
  code: string;
  org_id: string;
  device_id: string;
  zona: string;
  fecha: string;
  t: number;
  sector: string | null;
  ficha: FichaStored | null;
}

export interface PatternFeature {
  kind: PatternKind;
  /** Clave estable (para identificadores: la referencia ID-…, nunca el valor). */
  key: string;
  /** Descripción para el modelo, sin datos de víctimas ni números. */
  descripcion: string;
  citas: string[];
  case_ids: string[];
}

export interface DetectedPattern {
  pattern_key: string;
  zona: string;
  primary: PatternFeature;
  features: PatternFeature[];
  cases: VigiaCase[];
  n_victims: number;
  desde: string;
  hasta: string;
}

const CANAL: Record<string, string> = { yape: "Yape", plin: "Plin", transferencia: "transferencia bancaria", efectivo: "pago en efectivo" };

/** La mejor ventana de 14 días (más casos; empate: la más reciente) que cumple el umbral. */
function bestWindow(cases: VigiaCase[]): VigiaCase[] | null {
  const sorted = [...cases].sort((a, b) => a.t - b.t);
  let best: VigiaCase[] | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const win = sorted.filter((c) => c.t >= sorted[i]!.t && c.t <= sorted[i]!.t + WINDOW_DAYS * DAY_MS);
    if (win.length < MIN_CASES_FOR_STATS || distinctVictims(win) < MIN_VICTIMS_FOR_STATS) continue;
    if (!best || win.length > best.length || (win.length === best.length && win.at(-1)!.t >= best.at(-1)!.t)) best = win;
  }
  return best;
}

export async function detectPatterns(env: Env, opts: { now?: Date; lookbackDays?: number } = {}): Promise<DetectedPattern[]> {
  const now = opts.now ?? new Date();
  const since = now.getTime() - (opts.lookbackDays ?? 30) * DAY_MS;
  const { results } = await env.DB.prepare(
    `SELECT id, code, org_id, device_id, sector, zona_cuadricula, primer_contacto, created_at, ficha_json FROM cases
     WHERE consent_mode = 'comunitario' AND ficha_json IS NOT NULL`,
  ).all<{
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
  const cases: VigiaCase[] = [];
  for (const r of results) {
    const ficha = parseJsonColumn<FichaStored>(r.ficha_json);
    const zona = r.zona_cuadricula ?? ficha?.zona ?? null;
    const fecha = ficha?.primer_contacto ?? r.primer_contacto ?? r.created_at;
    const t = timeOf(fecha);
    if (!zona || !Number.isFinite(t) || t < since || t > now.getTime() + DAY_MS) continue;
    cases.push({ id: r.id, code: r.code, org_id: r.org_id, device_id: r.device_id, zona, fecha, t, sector: r.sector ?? ficha?.sector ?? null, ficha });
  }
  if (!cases.length) return [];
  const ids = cases.map((c) => c.id);
  const { results: idents } = await env.DB.prepare(
    `SELECT ci.case_id, i.ref FROM case_identifiers ci JOIN identifiers i ON i.hmac = ci.hmac WHERE ci.case_id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all<{ case_id: string; ref: string }>();

  // Agrupa por (zona, rasgo).
  const groups = new Map<string, { kind: PatternKind; key: string; zona: string; descripcion: string; extra: string[]; cases: Map<string, VigiaCase> }>();
  const add = (c: VigiaCase, kind: PatternKind, key: string, descripcion: string, extra: string[] = []) => {
    const k = `${c.zona}|${kind}|${key}`;
    const g = groups.get(k) ?? { kind, key, zona: c.zona, descripcion, extra, cases: new Map() };
    g.cases.set(c.id, c);
    groups.set(k, g);
  };
  for (const c of cases) {
    const f = c.ficha;
    if (f?.grupo_que_dice_ser && normalizePhrase(f.grupo_que_dice_ser)) {
      add(c, "grupo", normalizePhrase(f.grupo_que_dice_ser), `Quien extorsiona dice ser de "${f.grupo_que_dice_ser.trim()}"`);
    }
    if (f?.canal_pago && CANAL[f.canal_pago]) add(c, "canal", f.canal_pago, `Exige el pago por ${CANAL[f.canal_pago]}`);
    for (const frase of new Set((f?.frases_firma ?? []).map((x) => x.trim()).filter((x) => normalizePhrase(x)))) {
      add(c, "frase", normalizePhrase(frase), `Usa la frase "${frase}"`);
    }
  }
  const byCase = new Map(cases.map((c) => [c.id, c]));
  for (const i of idents) {
    const c = byCase.get(i.case_id);
    if (c) add(c, "identificador", i.ref, `Usa una misma cuenta o número (${i.ref}) en todos estos casos`, [i.ref]);
  }

  // Rasgos que cumplen el umbral en alguna ventana de 14 días.
  const qualifying: Array<PatternFeature & { zona: string; win: VigiaCase[] }> = [];
  for (const g of groups.values()) {
    const win = bestWindow([...g.cases.values()]);
    if (!win) continue;
    qualifying.push({
      kind: g.kind,
      key: g.key,
      zona: g.zona,
      descripcion: g.descripcion,
      citas: [...win.map((c) => fichaLabel(c.code)), ...g.extra],
      case_ids: win.map((c) => c.id),
      win,
    });
  }
  qualifying.sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind) || b.win.length - a.win.length || a.key.localeCompare(b.key));

  // Agrupa rasgos de la misma zona que comparten la mayoría de sus casos.
  const clusters: Array<{ zona: string; features: typeof qualifying; caseIds: Set<string> }> = [];
  for (const q of qualifying) {
    const target = clusters.find((cl) => {
      if (cl.zona !== q.zona) return false;
      const inter = q.case_ids.filter((id) => cl.caseIds.has(id)).length;
      return inter / Math.min(q.case_ids.length, cl.caseIds.size) >= 0.5;
    });
    if (target) {
      target.features.push(q);
      for (const id of q.case_ids) target.caseIds.add(id);
    } else {
      clusters.push({ zona: q.zona, features: [q], caseIds: new Set(q.case_ids) });
    }
  }

  const patterns: DetectedPattern[] = [];
  for (const cl of clusters) {
    const primary = cl.features[0]!;
    const members = [...cl.caseIds].map((id) => byCase.get(id)!).sort((a, b) => a.t - b.t);
    patterns.push({
      pattern_key: (await sha256Hex(`vigia:v1|${cl.zona}|${primary.kind}|${primary.key}`)).slice(0, 32),
      zona: cl.zona,
      primary: { kind: primary.kind, key: primary.key, descripcion: primary.descripcion, citas: primary.citas, case_ids: primary.case_ids },
      features: cl.features.map((f) => ({ kind: f.kind, key: f.key, descripcion: f.descripcion, citas: f.citas, case_ids: f.case_ids })),
      cases: members,
      n_victims: distinctVictims(members),
      desde: members[0]!.fecha,
      hasta: members.at(-1)!.fecha,
    });
  }
  return patterns;
}

async function confirmedLinkLabels(env: Env, caseIds: string[]): Promise<string[]> {
  if (caseIds.length < 2) return [];
  const ph = caseIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT num FROM links WHERE status = 'confirmado' AND case_a IN (${ph}) AND case_b IN (${ph}) ORDER BY num`)
    .bind(...caseIds, ...caseIds)
    .all<{ num: number }>();
  return results.map((r) => linkLabel(r.num));
}

function patternBrief(p: DetectedPattern, links: string[]): string {
  const distrito = zoneAt(p.zona, "distrito") ?? p.zona;
  const sectores = new Map<string, number>();
  for (const c of p.cases) sectores.set(c.sector ?? "otro", (sectores.get(c.sector ?? "otro") ?? 0) + 1);
  const plazos = [...new Set(p.cases.map((c) => c.ficha?.plazo).filter((x): x is string => Boolean(x)))];
  const amenazas = [...new Set(p.cases.map((c) => c.ficha?.tipo_amenaza).filter((x): x is NonNullable<typeof x> => Boolean(x)))];
  const fichas = p.cases.map((c) => fichaLabel(c.code));
  return `Patrón detectado (datos agregados y ficticios, sin datos de víctimas):
- Zona para la alerta: ${distrito}
- Casos: ${p.cases.length}, de ${p.n_victims} personas distintas, en una ventana de ${WINDOW_DAYS} días.
- Rasgos comunes:
${p.features.map((f) => `  - ${f.descripcion} (${f.case_ids.length} casos). Citas: ${f.citas.join(", ")}`).join("\n")}
- Rubros afectados: ${[...sectores.entries()].map(([s, n]) => `${s} (${n})`).join(", ")}
- Plazos que dan: ${plazos.length ? plazos.join(", ") : "sin dato"}
- Tipo de amenaza: ${amenazas.length ? amenazas.join(", ") : "sin dato"}
- Fichas citables: ${fichas.join(", ")}${links.length ? `\n- Vínculos confirmados entre estos casos: ${links.join(", ")}` : ""}

Redacta el borrador de alerta para los asociados del gremio:
- "zona": "${distrito}".
- "modalidad": la modalidad en pocas palabras.
- "cuerpo": máximo 90 palabras, sin números de teléfono ni de cuenta (ni siquiera parciales), sin fechas exactas, sin nombres, sin direcciones ni referencias que permitan saber quién denunció.
- "que_hacer": pasos concretos (no negociar solo, guardar la evidencia, denunciar en la Línea ${LINEA_DENUNCIAS} o en la comisaría más cercana, llamar al ${LINEA_EMERGENCIAS} si hay peligro inmediato).
- "evidencia": las citas del patrón (FICHA-…, VIN-…, ID-…). No pongas citas en el título ni en el cuerpo.`;
}

/** Limpieza determinística del borrador: nada de números completos, citas ni fechas exactas en el texto público. */
export function sanitizeAlert(draft: AlertaBorrador, zona: string, citas: string[]): AlertaBorrador {
  const clean = (s: string) => redactLongNumbers(humanizeIsoDates(stripCitations(s)));
  const que_hacer = draft.que_hacer.map(clean).filter(Boolean);
  const all = `${draft.cuerpo} ${que_hacer.join(" ")}`;
  if (!all.includes(LINEA_DENUNCIAS)) que_hacer.push(`Denuncia en la Línea ${LINEA_DENUNCIAS} o en la comisaría más cercana.`);
  if (!new RegExp(`\\b${LINEA_EMERGENCIAS}\\b`).test(all)) que_hacer.push(`Si estás en peligro inmediato, llama al ${LINEA_EMERGENCIAS}.`);
  const out: AlertaBorrador = {
    titulo: clean(draft.titulo),
    cuerpo: clean(draft.cuerpo),
    zona: zoneAt(zona, "distrito") ?? zona,
    modalidad: clean(draft.modalidad),
    que_hacer,
    evidencia: citas,
  };
  if (hasLongNumber(`${out.titulo} ${out.cuerpo} ${out.que_hacer.join(" ")}`)) throw new Error("alert_sanitize_failed");
  return out;
}

const IMAGE_PROMPT = (modalidad: string) =>
  `Tarjeta informativa sobria para una alerta comunitaria de prevención en Lima, Perú, sobre ${modalidad.slice(0, 120)}. ` +
  "Ilustración plana y minimalista de un escudo junto a un teléfono celular, colores sobrios (azul tinta, blanco hueso y un acento ocre). " +
  "Sin texto, sin letras, sin números, sin personas, sin armas, sin logotipos, sin marcas.";

async function generateCard(env: Env, modalidad: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null> {
  try {
    const res = await metaClientFor(env).images.generate(
      { prompt: IMAGE_PROMPT(modalidad), size: "1024x1024", outputFormat: "png", model: IMAGE_MODEL },
      { operation: "image", essential: false, context: { purpose: "vigia_card" } },
    );
    const img = res.images[0];
    if (!img) return null;
    return { bytes: b64ToBytes(img.b64), mime: img.mimeType };
  } catch (err) {
    log("warn", "vigia_card_skipped", errorFields(err));
    return null;
  }
}

export async function runVigia(env: Env, opts: VigiaRunOptions): Promise<AlertView[]> {
  const actor = opts.actor ?? SYSTEM_ACTOR;
  const now = opts.now ?? new Date();
  const patterns = await detectPatterns(env, { now, lookbackDays: opts.lookbackDays });
  const created: string[] = [];
  const skipped: Array<{ pattern: string; reason: string }> = [];
  const client = metaClientFor(env);
  let cost = 0;

  for (const p of patterns) {
    const orgs = [...new Set(p.cases.map((c) => c.org_id))].sort();
    const dedupSince = new Date(timeOf(p.hasta) - WINDOW_DAYS * DAY_MS).toISOString();
    const pendingOrgs: string[] = [];
    for (const org of orgs) {
      const dup = await env.DB.prepare("SELECT id FROM alerts WHERE pattern_key = ? AND org_id = ? AND created_at >= ? LIMIT 1")
        .bind(p.pattern_key, org, dedupSince)
        .first();
      if (!dup) pendingOrgs.push(org);
    }
    if (!pendingOrgs.length) {
      skipped.push({ pattern: p.pattern_key, reason: "duplicada" });
      continue;
    }

    const links = await confirmedLinkLabels(env, p.cases.map((c) => c.id));
    const citas = [...new Set([...p.cases.map((c) => fichaLabel(c.code)), ...links, ...p.features.flatMap((f) => f.citas)])];
    const known = new Set(citas);
    const brief = patternBrief(p, links);
    let previous: AlertaBorrador | null = null;
    let result;
    try {
      result = await runCheckedAgent<AlertaBorrador>(env, {
        agent: "vigia",
        model: VIGIA_MODEL,
        target_type: "pattern",
        target_id: p.pattern_key,
        known,
        attempt: async (feedback) => {
          const input = feedback && previous ? `${brief}\n\nTu respuesta anterior fue:\n${JSON.stringify(previous)}\n\n${feedback}` : brief;
          const res = await client.responses.parse(
            {
              model: VIGIA_MODEL,
              instructions: VIGIA_SYSTEM,
              input,
              schema: AlertaBorrador,
              schemaName: "alerta_borrador",
              reasoningEffort: "low",
              metadata: { agente: "vigia", prompt: PROMPT_VERSION },
            },
            { operation: "vigia", context: { pattern_key: p.pattern_key } },
          );
          previous = res.output;
          return { output: res.output, cost_usd: res.costUsd, tool_calls: 0 };
        },
      });
    } catch (err) {
      if (opts.trigger === "manual") throw toAgentError(err, "Vigía");
      log("error", "vigia_draft_failed", { pattern: p.pattern_key, ...errorFields(err) });
      skipped.push({ pattern: p.pattern_key, reason: "error" });
      continue;
    }
    cost += result.cost_usd;
    if (result.status !== "ok") {
      // Una salida que no pasa el validador no llega al gremio; el próximo ciclo lo vuelve a intentar.
      skipped.push({ pattern: p.pattern_key, reason: "citas_invalidas" });
      continue;
    }

    let draft: AlertaBorrador;
    try {
      draft = sanitizeAlert(result.output, p.zona, citas);
    } catch {
      skipped.push({ pattern: p.pattern_key, reason: "numeros" });
      continue;
    }

    const card = opts.image === false ? null : await generateCard(env, draft.modalidad);
    const nowIso_ = nowIso();
    const networkId = await env.DB.prepare(
      `SELECT network_id, COUNT(*) AS n FROM network_cases WHERE case_id IN (${p.cases.map(() => "?").join(",")}) GROUP BY network_id ORDER BY n DESC LIMIT 1`,
    )
      .bind(...p.cases.map((c) => c.id))
      .first<{ network_id: string }>();
    for (const org of pendingOrgs) {
      const id = newId();
      let imageKey: string | null = null;
      if (card) {
        imageKey = `alerts/${id}.${card.mime.includes("jpeg") ? "jpg" : card.mime.split("/")[1] ?? "png"}`;
        await env.EVIDENCE.put(imageKey, card.bytes, { httpMetadata: { contentType: card.mime }, customMetadata: { kind: "alert_card" } });
      }
      await env.DB.prepare(
        `INSERT INTO alerts (id, org_id, network_id, pattern_key, draft_json, citation_check_json, status, image_r2_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'borrador', ?, ?)`,
      )
        .bind(id, org, networkId?.network_id ?? null, p.pattern_key, JSON.stringify(draft), JSON.stringify(result.check), imageKey, nowIso_)
        .run();
      created.push(id);
    }
  }

  await audit(env, {
    ...actor,
    action: "agent.vigia.result",
    target_type: null,
    target_id: null,
    details: {
      trigger: opts.trigger,
      cron: opts.cron ?? null,
      patterns: patterns.length,
      alerts: created,
      skipped,
      cost_usd: Math.round(cost * 1e6) / 1e6,
    },
  });
  if (!created.length) return [];
  const { results } = await env.DB.prepare(
    `${ALERT_SELECT} WHERE a.id IN (${created.map(() => "?").join(",")}) ORDER BY a.created_at, a.org_id`,
  )
    .bind(...created)
    .all<AlertRow>();
  return results.map(alertView);
}
