import { Expediente, PROMPT_VERSION, REDACTOR_SYSTEM, type PerfilRed } from "@blindaje/shared";
import type { Env } from "../env";
import { audit } from "../audit";
import { putEncrypted, sha256Hex } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { getMlClient } from "../ml/client";
import { activityPeriod, analyzeGraph, buildGraph, caseCodeOf, loadNetworkData, sectorCounts, territorialStats, timeOf, type NetworkData } from "../networks/graph";
import type { Actor } from "../types";
import { metaClientFor, runCheckedAgent } from "./common";
import { loadApproved, NetworkToolbox, type ApprovedHypothesis } from "./tools/network";
import { mapStrings, redactLongNumbers, restartOnChainLag, toAgentError } from "./tools/safety";

export interface RedactorOptions {
  actor: Actor;
}

const MODEL = "muse-spark-1.3";
const MAX_TURNS = 8;
/** D1 admite hasta 100 parámetros por consulta. */
const IN_CHUNK = 90;
const MAX_CUSTODY = 400;

function taskFor(box: NetworkToolbox): string {
  const d = box.data;
  return `Prepara el expediente de la red ${d.label} para la autoridad (${d.cases.length} casos, ${d.links.length} vínculos confirmados).
1. Usa obtener_red, obtener_perfil_aprobado, hipotesis_aprobadas, linea_de_tiempo y vinculos_confirmados (red_id = "${d.label}").
2. Entrega:
- "resumen": de 3 a 6 frases sobre la red, con citas entre paréntesis.
- "cronologia": los eventos clave unificados (fecha ISO, texto breve y evidencia).
- "vinculos": una fila por vínculo confirmado (VIN-…), con una explicación breve de por qué se vinculó y su evidencia.
- "hechos": hechos verificables con su evidencia (puedes usar los del perfil aprobado).
- "hipotesis": solo las aprobadas, tal cual las devuelve hipotesis_aprobadas.
- "brechas": qué evidencia falta.
Cita solo identificadores que devolvieron tus herramientas. No nombres personas ni decidas culpabilidad.`;
}

function linkFallbackText(data: NetworkData, l: NetworkData["links"][number]): { texto: string; evidencia: string[] } {
  if (l.vinculador && l.vinculador_valid !== false) return { texto: l.vinculador.explicacion, evidencia: l.vinculador.afirmaciones.flatMap((a) => a.evidencia) };
  const parts: string[] = [];
  const evidencia: string[] = [];
  const s = l.signals;
  if (s.identificador?.compartidos.length) {
    parts.push(`comparten ${s.identificador.compartidos.map((x) => `${x.ref} (…${x.ultimos_3})`).join(", ")}`);
    evidencia.push(...s.identificador.compartidos.flatMap((x) => [x.ref, ...x.evidencia]));
  }
  if (s.voz) {
    parts.push(`huellas de voz parecidas (${s.voz.huellas.join(", ")})`);
    evidencia.push(...s.voz.huellas, ...s.voz.evidencia);
  }
  if (s.imagen) {
    parts.push(`imágenes parecidas (${s.imagen.recortes.join(", ")})`);
    evidencia.push(...s.imagen.recortes, ...s.imagen.evidencia);
  }
  if (s.modus_operandi?.frases_comunes.length) parts.push(`frases comunes: ${s.modus_operandi.frases_comunes.map((f) => `"${f}"`).join(", ")}`);
  const a = caseCodeOf(data, l.case_a);
  const b = caseCodeOf(data, l.case_b);
  return { texto: `Los casos ${a} y ${b} ${parts.length ? parts.join("; ") : "fueron vinculados por una persona revisora"}.`, evidencia: [l.label, ...evidencia] };
}

/**
 * Ajustes del servidor: la red y la lista de vínculos salen de la base (solo confirmados), y las
 * hipótesis son exactamente las aprobadas por una persona analista, aunque el modelo agregue otras.
 */
export function finalizeExpediente(box: NetworkToolbox, raw: Expediente, approved: ApprovedHypothesis[]): Expediente {
  const d = box.data;
  const byLabel = new Map(raw.vinculos.map((v) => [v.vinculo.trim(), v]));
  const vinculos = d.links.map((l) => {
    const v = byLabel.get(l.label);
    if (v && v.texto.trim() && v.evidencia.length) return { vinculo: l.label, texto: v.texto, evidencia: v.evidencia };
    const fb = linkFallbackText(d, l);
    box.citations.add([l.label, ...fb.evidencia]);
    const evidencia = [...new Set([l.label, ...fb.evidencia])].filter((e) => box.known.has(e));
    return { vinculo: l.label, texto: fb.texto, evidencia };
  });
  const out: Expediente = {
    ...raw,
    red: d.label,
    cronologia: [...raw.cronologia].sort((a, b) => timeOf(a.fecha) - timeOf(b.fecha)),
    vinculos,
    hipotesis: approved.map((h) => ({ texto: h.texto, confianza: h.confianza, evidencia: h.evidencia })),
  };
  return mapStrings(out, (s) => redactLongNumbers(s));
}

interface CustodyRow {
  seq: number;
  ts: string;
  actor_type: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  prev_hash: string;
  hash: string;
}

/** Entradas de audit_log de los casos, evidencias, vínculos, perfiles e hipótesis de la red. */
async function custodyChain(env: Env, data: NetworkData, extraLabels: Map<string, string>): Promise<Array<Omit<CustodyRow, "target_type">>> {
  const labels = new Map<string, string>(extraLabels);
  labels.set(data.id, data.label);
  for (const c of data.cases) labels.set(c.id, `Caso ${c.code}`);
  for (const e of data.evidence) labels.set(e.id, e.label);
  for (const l of data.links) labels.set(l.id, l.label);
  const ids = [...labels.keys()];
  const rows = new Map<number, CustodyRow>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { results } = await env.DB.prepare(
      `SELECT seq, ts, actor_type, action, target_type, target_id, prev_hash, hash FROM audit_log
       WHERE target_id IN (${chunk.map(() => "?").join(",")}) ORDER BY seq LIMIT ${MAX_CUSTODY}`,
    )
      .bind(...chunk)
      .all<CustodyRow>();
    for (const r of results) rows.set(r.seq, r);
  }
  return [...rows.values()]
    .sort((a, b) => a.seq - b.seq)
    .slice(0, MAX_CUSTODY)
    .map((r) => ({
      seq: r.seq,
      ts: r.ts,
      actor_type: r.actor_type,
      action: r.action,
      target_id: r.target_id ? (labels.get(r.target_id) ?? r.target_id) : null,
      prev_hash: r.prev_hash,
      hash: r.hash,
    }));
}

/**
 * Redactor de expedientes (10.5): arma el expediente con el agente (citas validadas), genera el
 * PDF en el contenedor (/pdf/render "expediente"), lo guarda cifrado en R2 (`expedientes/<id>.pdf`,
 * AAD = id) con su SHA-256 y devuelve el id. El PDF sale como "Borrador para revisión": se envía
 * solo cuando una persona analista lo aprueba y existe un canal formal con la autoridad.
 */
export async function runRedactor(env: Env, networkId: string, opts: RedactorOptions): Promise<{ expediente_id: string }> {
  const data = await loadNetworkData(env, networkId);
  if (data.cases.length < 2) throw new ApiError("conflict", "La red no tiene casos suficientes para un expediente");
  const graph = await buildGraph(data);
  const analysis = await analyzeGraph(env, graph, { timeoutMs: 30_000 });
  const approved = await loadApproved(env, networkId);
  const box = new NetworkToolbox(env, data, graph, analysis, approved);
  // Las hipótesis aprobadas entran tal cual al expediente: sus citas cuentan como conocidas.
  box.citations.add(approved.hypotheses);

  const id = newId();
  const createdBy = opts.actor.actor_type === "analyst" || opts.actor.actor_type === "admin" ? opts.actor.actor_id : null;
  await env.DB.prepare("INSERT INTO expedientes (id, network_id, status, created_by, created_at) VALUES (?, ?, 'generando', ?, ?)")
    .bind(id, networkId, createdBy, nowIso())
    .run();
  const fail = async (content: unknown, check: unknown) =>
    env.DB.prepare("UPDATE expedientes SET status = 'error', content_json = ?, citation_check_json = ? WHERE id = ?")
      .bind(content == null ? null : JSON.stringify(content), check == null ? null : JSON.stringify(check), id)
      .run();

  const client = metaClientFor(env);
  const task = taskFor(box);
  let previous: Expediente | null = null;
  let result;
  try {
    result = await runCheckedAgent<Expediente>(env, {
      agent: "redactor",
      model: MODEL,
      target_type: "network",
      target_id: networkId,
      known: () => box.known,
      attempt: async (feedback) => {
        const input = feedback && previous ? `${task}\n\nTu respuesta anterior fue:\n${JSON.stringify(previous)}\n\n${feedback}` : task;
        const res = await restartOnChainLag("redactor", () =>
          client.runAgent(
            {
              model: MODEL,
              instructions: REDACTOR_SYSTEM,
              input,
              tools: box.redactorTools(),
              finalSchema: Expediente,
              finalSchemaName: "expediente",
              maxTurns: MAX_TURNS,
              reasoningEffort: "low",
              parallelToolCalls: true,
              extra: { metadata: { agente: "redactor", red: data.label, prompt: PROMPT_VERSION } },
            },
            { operation: "redactor", context: { network_id: networkId } },
          ),
        );
        const output = finalizeExpediente(box, res.output, approved.hypotheses);
        previous = output;
        return { output, cost_usd: res.usage.cost_usd, tool_calls: res.trace.length };
      },
    });
  } catch (err) {
    await fail(null, null);
    await audit(env, { ...opts.actor, action: "expediente.error", target_type: "expediente", target_id: id, details: { network_id: networkId, stage: "agente", error: (err as Error).name } });
    throw toAgentError(err, "Redactor");
  }

  if (result.status !== "ok") {
    await fail(result.output, result.check);
    await audit(env, {
      ...opts.actor,
      action: "expediente.error",
      target_type: "expediente",
      target_id: id,
      details: { network_id: networkId, stage: "citas", sin_cita: result.check.sin_cita.length, citas_inexistentes: result.check.citas_inexistentes, agent_run_id: result.run_id },
    });
    throw new ApiError("upstream_error", "El expediente no pasó el validador de citas después de un reintento. Revisa el perfil de la red e intenta de nuevo.", {
      status: 502,
      details: { expediente_id: id, citation_check: result.check },
    });
  }

  // Datos para el PDF.
  const exp = result.output;
  const extraLabels = new Map<string, string>();
  if (approved.profile) extraLabels.set(approved.profile.id, "Perfil de red aprobado");
  for (const h of approved.hypotheses) extraLabels.set(h.id, `HIP-${h.num}`);
  const custodia = await custodyChain(env, data, extraLabels);
  const st = territorialStats(data.cases, "cuadricula");
  const perfil: Partial<PerfilRed> = approved.profile
    ? (({ hipotesis: _h, hechos: _f, ...rest }) => rest)(approved.profile.perfil)
    : { casos: data.cases.length, periodo: activityPeriod(data.cases), sectores: sectorCounts(data.cases), territorio: st.disponible ? st.zonas : [] };
  // Defensa en profundidad: el territorio del PDF siempre respeta el umbral.
  if (!st.disponible) perfil.territorio = [];
  const linkById = new Map(data.links.map((l) => [l.label, l]));
  const pdfData = {
    demo: env.DEMO_MODE === "true" || data.cases.some((c) => c.is_demo),
    generado_utc: nowIso(),
    aprobado: false,
    red: exp.red,
    resumen: exp.resumen,
    perfil,
    cronologia: exp.cronologia,
    vinculos: exp.vinculos.map((v) => {
      const l = linkById.get(v.vinculo);
      return { ...v, puntaje: l?.score ?? null, casos: l ? [caseCodeOf(data, l.case_a), caseCodeOf(data, l.case_b)] : [] };
    }),
    hechos: exp.hechos,
    hipotesis: exp.hipotesis,
    brechas: exp.brechas,
    evidencia: data.evidence
      .map((e) => ({ label: e.label, caso: caseCodeOf(data, e.case_id), tipo: e.tipo, sha256: e.sha256, received_utc: e.received_utc }))
      .sort((a, b) => a.caso.localeCompare(b.caso) || a.label.localeCompare(b.label, "es", { numeric: true })),
    custodia,
  };

  let pdf: ArrayBuffer;
  try {
    pdf = await getMlClient(env).pdfRender("expediente", pdfData);
  } catch (err) {
    await fail(pdfData, result.check);
    await audit(env, { ...opts.actor, action: "expediente.error", target_type: "expediente", target_id: id, details: { network_id: networkId, stage: "pdf", error: (err as Error).name } });
    throw err;
  }
  const sha256 = await sha256Hex(pdf);
  const r2Key = `expedientes/${id}.pdf`;
  await putEncrypted(env.EVIDENCE, r2Key, env.EVIDENCE_ENCRYPTION_KEY, pdf, id, { kind: "expediente", network_id: networkId });
  await env.DB.prepare("UPDATE expedientes SET status = 'listo', content_json = ?, citation_check_json = ?, r2_key = ?, sha256 = ? WHERE id = ?")
    .bind(JSON.stringify(pdfData), JSON.stringify(result.check), r2Key, sha256, id)
    .run();
  await audit(env, {
    ...opts.actor,
    action: "expediente.create",
    target_type: "expediente",
    target_id: id,
    details: {
      network_id: networkId,
      label: data.label,
      sha256,
      size_bytes: pdf.byteLength,
      evidencia: pdfData.evidencia.length,
      custodia: custodia.length,
      hipotesis_aprobadas: approved.hypotheses.length,
      perfil_aprobado: approved.profile?.id ?? null,
      agent_run_id: result.run_id,
      cost_usd: Math.round(result.cost_usd * 1e6) / 1e6,
    },
  });
  return { expediente_id: id };
}
