import {
  ASESOR_SYSTEM,
  AsesorOutput,
  LINEA_DENUNCIAS,
  LINEA_EMERGENCIAS,
  PROMPT_VERSION,
  type CitationCheck,
  type ConsoleRecommendationView,
} from "@blindaje/shared";
import type { Env } from "../env";
import { audit } from "../audit";
import { AVISO_SIN_DATOS, SESGO_TEXTO, analyzeRisk, type RiskAnalysis } from "../business/risk";
import { dropUnsafeSentences, isUnsafeAdvice, sanitizeStoredText } from "../business/safety";
import { recommendationConsoleView, type RecommendationRow } from "../business/recommendations";
import { ApiError } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import type { Actor } from "../types";
import { metaClientFor, runCheckedAgent } from "./common";
import { AsesorToolbox } from "./tools/business";
import { restartOnChainLag, toAgentError } from "./tools/safety";

/**
 * Asesor: recomendaciones de prevención para los negocios de una zona y un rubro, a partir de datos
 * AGREGADOS (Muse Spark 1.3 con herramientas). Todo nace en borrador y lo aprueba el gremio.
 *
 * Post-proceso determinista (defensa en profundidad, gane lo que gane el modelo):
 * - nivel de riesgo, zona y rubro los fija el servidor; "sin_datos" bajo el umbral, sin modalidades
 *   que no vengan de una alerta aprobada;
 * - ningún número largo ni "ID-…" en los textos;
 * - se descarta toda recomendación, paso u oración que aconseje pagar, negociar o actuar contra
 *   personas, y siempre quedan "No pagues ni negocies", la evidencia, la Línea 1818 y el 105;
 * - siempre se advierte el sesgo de denuncia.
 */

export const ASESOR_MODEL = "muse-spark-1.3";
const MAX_TURNS = 6;

export interface AsesorTarget {
  zona: string;
  /** null = todos los rubros de la zona. */
  sector: string | null;
}

export interface AsesorRunOptions {
  orgId: string;
  isDemo: boolean;
  actor: Actor;
  now?: Date;
}

const TODOS_LOS_RUBROS = "todos los rubros";

export const NO_PAGAR: AsesorOutput["recomendaciones"][number] = {
  titulo: "No pagues ni negocies",
  detalle: `Un pago no detiene la extorsión: suele traer nuevos cobros. No respondas ni negocies; guarda la evidencia en Blindaje y denuncia en la Línea ${LINEA_DENUNCIAS} o en la comisaría más cercana.`,
  prioridad: "alta",
};

const PASOS_FIJOS: Array<{ test: RegExp; texto: string }> = [
  { test: /no pagues/i, texto: "No pagues ni negocies, aunque te den un plazo corto." },
  { test: /evidencia|blindaje/i, texto: "Guarda en Blindaje cada audio, mensaje o foto que te manden, sin borrarlos." },
  { test: new RegExp(`\\b${LINEA_DENUNCIAS}\\b`), texto: `Denuncia en la Línea ${LINEA_DENUNCIAS} o en la comisaría más cercana.` },
  { test: new RegExp(`\\b${LINEA_EMERGENCIAS}\\b`), texto: `Si estás en peligro inmediato, llama al ${LINEA_EMERGENCIAS}.` },
  { test: /gremio|asociaci[oó]n/i, texto: "Avisa a tu gremio: puede alertar a otros negocios sin dar tu nombre." },
];

export interface FinalizeResult {
  output: AsesorOutput;
  /** Textos descartados por aconsejar pagar, negociar o actuar contra personas. */
  descartados: string[];
}

/** Post-proceso determinista de la salida del Asesor. Exportado para los tests. */
export function finalizeAsesor(raw: AsesorOutput, a: Pick<RiskAnalysis, "zona" | "nivel" | "modalidades">, sectorLabel: string): FinalizeResult {
  const descartados: string[] = [];
  const clean = (s: string) => sanitizeStoredText(s);
  const keep = (s: string) => {
    if (isUnsafeAdvice(s)) {
      descartados.push(s);
      return false;
    }
    return true;
  };

  // Recomendaciones: fuera las que aconsejan pagar o negociar; "No pagues ni negocies" siempre primero.
  let recomendaciones = raw.recomendaciones
    .map((r) => ({ titulo: clean(r.titulo), detalle: clean(r.detalle), prioridad: r.prioridad }))
    .filter((r) => r.titulo && r.detalle && keep(`${r.titulo}. ${r.detalle}`));
  const tieneNoPagar = recomendaciones.some((r) => /no pagues/i.test(`${r.titulo} ${r.detalle}`) && /negoci/i.test(`${r.titulo} ${r.detalle}`));
  if (!tieneNoPagar) recomendaciones = [NO_PAGAR, ...recomendaciones];

  // Qué hacer si te pasa: pasos seguros más los fijos que falten.
  const pasos = raw.que_hacer_si_te_pasa.map(clean).filter((p) => p && keep(p));
  for (const fijo of PASOS_FIJOS) if (!pasos.some((p) => fijo.test.test(p))) pasos.push(fijo.texto);
  const noPagar = pasos.findIndex((p) => /no pagues/i.test(p));
  if (noPagar > 0) pasos.unshift(...pasos.splice(noPagar, 1));

  // Resumen: se quitan las oraciones inseguras.
  const res = dropUnsafeSentences(clean(raw.resumen));
  descartados.push(...res.removed);
  let resumen = res.text;
  if (a.nivel === "sin_datos" && !/suficientes casos/i.test(resumen)) resumen = `${AVISO_SIN_DATOS} en esta zona. ${resumen}`.trim();

  // Modalidades: bajo el umbral solo las de alertas aprobadas; nunca una que aconseje algo inseguro.
  const permitidas = a.nivel === "sin_datos" ? a.modalidades.filter((m) => m.origen === "alerta") : a.modalidades;
  const modalidades = permitidas.length
    ? raw.modalidades
        .map((m) => ({ descripcion: clean(m.descripcion), senales_de_alerta: m.senales_de_alerta.map(clean).filter(Boolean), evidencia: m.evidencia }))
        .filter((m) => m.descripcion && keep(m.descripcion))
    : [];

  // Advertencias: sin consejos inseguros, con el sesgo de denuncia y el aviso de umbral.
  const advertencias = raw.advertencias.map(clean).filter((w) => w && keep(w));
  if (!advertencias.some((w) => /denuncia m[aá]s|sesgo/i.test(w))) advertencias.push(SESGO_TEXTO);
  if (a.nivel === "sin_datos" && !advertencias.some((w) => /suficientes casos/i.test(w))) {
    advertencias.push(`${AVISO_SIN_DATOS}: hacen falta al menos 5 casos de 3 personas distintas en la zona.`);
  }

  return {
    output: {
      sector: sectorLabel,
      zona: a.zona,
      nivel_riesgo: a.nivel,
      resumen: resumen || `Recomendaciones de prevención para ${sectorLabel} en ${a.zona}.`,
      modalidades,
      recomendaciones,
      que_hacer_si_te_pasa: pasos,
      advertencias,
    },
    descartados,
  };
}

function taskFor(a: RiskAnalysis, sectorLabel: string): string {
  return `Escribe la recomendación de prevención para negocios del rubro "${sectorLabel}" en la zona "${a.zona}".

Cómo trabajar:
1. Llama a panorama_riesgo, modalidades_activas, escalamiento y alertas_aprobadas (zona = "${a.zona}").
2. Entrega la salida final:
- "sector": "${sectorLabel}"; "zona": "${a.zona}".
- "nivel_riesgo": exactamente el que devolvió panorama_riesgo.
- "resumen": tres o cuatro frases para el dueño de un negocio. Usa cifras solo si panorama_riesgo las da (null = no hay cifra).
- "modalidades": solo las que devolvió modalidades_activas, en términos generales, con sus señales de alerta y, en "evidencia", las citas que devolvió la herramienta. Lista vacía si no hay.
- "recomendaciones": de 4 a 6, de prevención y protección, prácticas, con prioridad.
- "que_hacer_si_te_pasa": pasos en orden: no pagar ni negociar, guardar la evidencia en Blindaje, denunciar en la Línea ${LINEA_DENUNCIAS} o en la comisaría, llamar al ${LINEA_EMERGENCIAS} si hay peligro inmediato, avisar al gremio.
- "advertencias": el sesgo de denuncia y los límites de los datos.
Nunca aconsejes pagar ni negociar. Nada táctico sobre personas o redes concretas. Sin números de teléfono, cuentas ni placas.`;
}

/** Revisión extra del validador: cada modalidad necesita al menos una cita. */
function withModalityCitations(check: CitationCheck, out: AsesorOutput): CitationCheck {
  const sinEvidencia = out.modalidades.filter((m) => !m.evidencia.some((e) => e.trim())).map((m) => m.descripcion);
  if (!sinEvidencia.length) return check;
  return { ...check, ok: false, sin_cita: [...check.sin_cita, ...sinEvidencia] };
}

/** Corre el Asesor para una zona y un rubro y guarda la recomendación en borrador. */
export async function runAsesorFor(env: Env, target: AsesorTarget, opts: AsesorRunOptions): Promise<ConsoleRecommendationView> {
  const sectorLabel = target.sector?.trim() || TODOS_LOS_RUBROS;
  const analysis = await analyzeRisk(env, { zona: target.zona, sector: target.sector, orgId: opts.orgId, isDemo: opts.isDemo, now: opts.now });
  const box = new AsesorToolbox(analysis, sectorLabel);
  const client = metaClientFor(env);
  const task = taskFor(analysis, sectorLabel);
  const targetId = opts.orgId;
  let previous: AsesorOutput | null = null;
  const descartados: string[] = [];

  let result;
  try {
    result = await runCheckedAgent<AsesorOutput>(env, {
      agent: "asesor",
      model: ASESOR_MODEL,
      target_type: "organization",
      target_id: targetId,
      known: () => box.known,
      attempt: async (feedback) => {
        const input =
          feedback && previous
            ? `${task}\n\nTu respuesta anterior fue:\n${JSON.stringify(previous)}\n\n${feedback}\nPuedes volver a usar tus herramientas si lo necesitas.`
            : task;
        const res = await restartOnChainLag("asesor", () =>
          client.runAgent(
            {
              model: ASESOR_MODEL,
              instructions: ASESOR_SYSTEM,
              input,
              tools: box.tools(),
              finalSchema: AsesorOutput,
              finalSchemaName: "asesor_negocios",
              maxTurns: MAX_TURNS,
              reasoningEffort: "low",
              parallelToolCalls: true,
              extra: { metadata: { agente: "asesor", prompt: PROMPT_VERSION } },
            },
            { operation: "asesor", context: { org_id: opts.orgId } },
          ),
        );
        const fin = finalizeAsesor(res.output, analysis, sectorLabel);
        descartados.push(...fin.descartados);
        previous = fin.output;
        return { output: fin.output, cost_usd: res.usage.cost_usd, tool_calls: res.trace.length };
      },
    });
  } catch (err) {
    await audit(env, {
      ...opts.actor,
      action: "agent.asesor.error",
      target_type: "organization",
      target_id: opts.orgId,
      details: { zona: analysis.zona, sector: sectorLabel, model: ASESOR_MODEL, error: (err as Error).name },
    });
    throw toAgentError(err, "Asesor");
  }

  const check = withModalityCitations(result.check, result.output);
  const row: RecommendationRow = {
    id: newId(),
    org_id: opts.orgId,
    sector: sectorLabel,
    zona: analysis.zona,
    status: "borrador",
    content_json: JSON.stringify(result.output),
    citation_check_json: JSON.stringify(check),
    model: ASESOR_MODEL,
    agent_run_id: result.run_id,
    approved_by: null,
    approver_name: null,
    approved_at: null,
    is_demo: opts.isDemo ? 1 : 0,
    created_at: nowIso(),
  };
  await env.DB.prepare(
    `INSERT INTO business_recommendations (id, org_id, sector, zona, status, content_json, citation_check_json, model, agent_run_id, is_demo, created_at)
     VALUES (?, ?, ?, ?, 'borrador', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.org_id, row.sector, row.zona, row.content_json, row.citation_check_json, row.model, row.agent_run_id, row.is_demo, row.created_at)
    .run();

  await audit(env, {
    ...opts.actor,
    action: "agent.asesor.result",
    target_type: "business_recommendation",
    target_id: row.id,
    details: {
      org_id: opts.orgId,
      zona: analysis.zona,
      sector: sectorLabel,
      nivel_riesgo: result.output.nivel_riesgo,
      model: ASESOR_MODEL,
      status: result.status,
      attempts: result.attempts,
      citas_ok: check.ok,
      modalidades: result.output.modalidades.length,
      recomendaciones: result.output.recomendaciones.length,
      descartados: descartados.length,
      cost_usd: Math.round(result.cost_usd * 1e6) / 1e6,
      agent_run_id: result.run_id,
    },
  });
  return recommendationConsoleView(row);
}

export interface AsesorBatchRequest {
  zona?: string;
  sector?: string;
}

const MAX_TARGETS = 5;

/**
 * Qué combinaciones de zona y rubro analizar: las pedidas o, si faltan, las de las cuentas de negocio
 * de la organización (como máximo 5 por ejecución).
 */
export async function asesorTargets(env: Env, orgId: string, req: AsesorBatchRequest): Promise<AsesorTarget[]> {
  const zona = req.zona?.trim() || null;
  const sector = req.sector?.trim() || null;
  if (zona && sector) return [{ zona, sector }];
  const { results } = await env.DB.prepare("SELECT DISTINCT zona, sector FROM business_accounts WHERE org_id = ? AND disabled = 0 ORDER BY zona, sector")
    .bind(orgId)
    .all<{ zona: string; sector: string }>();
  const norm = (s: string) => s.trim().toLowerCase();
  let targets = results.filter((r) => (!zona || norm(r.zona) === norm(zona)) && (!sector || norm(r.sector) === norm(sector)));
  if (!targets.length && zona) return [{ zona, sector }];
  if (!targets.length) {
    throw new ApiError("bad_request", "Indica la zona (y el rubro), o crea primero cuentas de negocio en la organización");
  }
  const seen = new Set<string>();
  targets = targets.filter((t) => {
    const k = `${norm(t.zona)}|${norm(t.sector)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return targets.slice(0, MAX_TARGETS).map((t) => ({ zona: t.zona, sector: t.sector }));
}
