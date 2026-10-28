import { CARTOGRAFO_SYSTEM, PROMPT_VERSION, PerfilRed, type ProfileView } from "@blindaje/shared";
import type { Env } from "../env";
import { audit } from "../audit";
import { listProfiles } from "../console/views";
import { nextCounter } from "../lib/db";
import { ApiError } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { activityPeriod, analyzeGraph, buildGraph, loadNetworkData, normalizePhrase, sectorCounts, territorialStats } from "../networks/graph";
import type { Actor } from "../types";
import { metaClientFor, runCheckedAgent } from "./common";
import { NetworkToolbox, type RegisteredHypothesis } from "./tools/network";
import { mapStrings, redactLongNumbers, restartOnChainLag, toAgentError } from "./tools/safety";

export type CartografoModel = "muse-spark-1.3" | "muse-wonder-1.0";

export interface CartografoOptions {
  model: CartografoModel;
  actor: Actor;
}

const MAX_TURNS = 12;

function taskFor(box: NetworkToolbox): string {
  const d = box.data;
  return `Analiza la red ${d.label} (${d.cases.length} casos unidos por ${d.links.length} vínculos confirmados por personas revisoras) y entrega su perfil.

Cómo trabajar:
1. Llama a obtener_red, centralidad_identificadores, linea_de_tiempo y estadisticas_territoriales (red_id = "${d.label}").
2. Pide con obtener_ficha las fichas que necesites y compara guiones entre casos vinculados con comparar_guiones.
3. Registra cada hipótesis con registrar_hipotesis (texto, evidencia_ids y confianza) antes de la respuesta final.

La respuesta final sigue el esquema:
- "hechos": solo lo que los datos muestran (conteos, coincidencias, fechas), cada uno con su evidencia.
- "hipotesis": las que registraste, con confianza baja, media o alta y su evidencia. Los roles se infieren de la estructura del grafo.
- "territorio": exactamente lo que devolvió estadisticas_territoriales; vacío si no está disponible.
- "escalamiento": cuánto tiempo pasa entre el plazo vencido y la intimidación física, con citas entre paréntesis.
- "brechas": qué evidencia falta para fortalecer el expediente.
- "recomendaciones_autoridad": para investigadores, nunca para las víctimas.
Cita solo identificadores que devolvieron tus herramientas. No nombres personas.`;
}

/**
 * Ajustes del servidor sobre la salida del modelo (defensa en profundidad):
 * - los datos verificables (red, casos, sectores) salen de la base, no del modelo;
 * - territorio: vacío si la red no cumple el umbral (5 casos y 3 víctimas), aunque el modelo lo
 *   haya llenado; si lo cumple, los conteos agregados del servidor;
 * - hipótesis: las registradas con la herramienta más las que el modelo puso en la salida;
 * - ningún texto lleva números largos (teléfonos o cuentas).
 */
export function finalizeProfile(box: NetworkToolbox, raw: PerfilRed): PerfilRed {
  const d = box.data;
  const st = territorialStats(d.cases, box.territorialLevel);
  const hyps: RegisteredHypothesis[] = [...box.hypotheses];
  const merged = [
    ...hyps.map((h) => ({ texto: h.texto, confianza: h.confianza, evidencia: h.evidencia })),
    ...raw.hipotesis.filter((h) => !hyps.some((r) => normalizePhrase(r.texto) === normalizePhrase(h.texto))),
  ];
  const perfil: PerfilRed = {
    ...raw,
    red: d.label,
    casos: d.cases.length,
    periodo: raw.periodo ?? activityPeriod(d.cases),
    sectores: sectorCounts(d.cases),
    territorio: st.disponible ? st.zonas : [],
    hipotesis: merged,
  };
  return mapStrings(perfil, (s) => redactLongNumbers(s));
}

/** Cartógrafo (10.3): perfil de red con hechos e hipótesis citados, en borrador para revisión. */
export async function runCartografo(env: Env, networkId: string, opts: CartografoOptions): Promise<ProfileView> {
  const data = await loadNetworkData(env, networkId);
  if (data.cases.length < 2) throw new ApiError("conflict", "La red no tiene casos suficientes para analizar");
  const graph = await buildGraph(data);
  const analysis = await analyzeGraph(env, graph, { timeoutMs: 30_000 });
  const box = new NetworkToolbox(env, data, graph, analysis);
  const client = metaClientFor(env);
  const task = taskFor(box);
  let previous: PerfilRed | null = null;

  let result;
  try {
    result = await runCheckedAgent<PerfilRed>(env, {
      agent: "cartografo",
      model: opts.model,
      target_type: "network",
      target_id: networkId,
      known: () => box.known,
      attempt: async (feedback) => {
        const input =
          feedback && previous
            ? `${task}\n\nTu respuesta anterior fue:\n${JSON.stringify(previous)}\n\n${feedback}\nPuedes volver a usar tus herramientas si lo necesitas.`
            : task;
        const res = await restartOnChainLag("cartografo", () =>
          client.runAgent(
            {
              model: opts.model,
              instructions: CARTOGRAFO_SYSTEM,
              input,
              tools: box.cartografoTools(),
              finalSchema: PerfilRed,
              finalSchemaName: "perfil_red",
              maxTurns: MAX_TURNS,
              reasoningEffort: "low",
              parallelToolCalls: true,
              extra: { metadata: { agente: "cartografo", red: data.label, prompt: PROMPT_VERSION } },
            },
            { operation: "cartografo", context: { network_id: networkId } },
          ),
        );
        const output = finalizeProfile(box, res.output);
        previous = output;
        return { output, cost_usd: res.usage.cost_usd, tool_calls: res.trace.length };
      },
    });
  } catch (err) {
    await audit(env, {
      ...opts.actor,
      action: "agent.cartografo.error",
      target_type: "network",
      target_id: networkId,
      details: { model: opts.model, error: (err as Error).name },
    });
    throw toAgentError(err, "Cartógrafo");
  }

  // Persistencia: perfil (borrador o inválido) e hipótesis HIP-n en borrador.
  const profileId = newId();
  const now = nowIso();
  const status = result.status === "ok" ? "borrador" : "invalido";
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO network_profiles (id, network_id, profile_json, citation_check_json, status, model, agent_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(profileId, networkId, JSON.stringify(result.output), JSON.stringify(result.check), status, opts.model, result.run_id, now),
  ];
  const hypIds: string[] = [];
  for (const h of result.output.hipotesis) {
    const reg = box.hypotheses.find((r) => normalizePhrase(r.texto) === normalizePhrase(h.texto));
    const num = reg?.num ?? (await nextCounter(env, "hypothesis"));
    const id = newId();
    hypIds.push(id);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO hypotheses (id, num, profile_id, network_id, texto, confianza, evidence_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?)`,
      ).bind(id, num, profileId, networkId, h.texto, h.confianza, JSON.stringify(h.evidencia), now),
    );
  }
  await env.DB.batch(stmts);

  await audit(env, {
    ...opts.actor,
    action: "agent.cartografo.result",
    target_type: "network",
    target_id: networkId,
    details: {
      profile_id: profileId,
      label: data.label,
      model: opts.model,
      status,
      attempts: result.attempts,
      hechos: result.output.hechos.length,
      hipotesis: hypIds.length,
      citas_ok: result.check.ok,
      territorio: result.output.territorio.length > 0,
      graph: analysis.source,
      cost_usd: Math.round(result.cost_usd * 1e6) / 1e6,
      agent_run_id: result.run_id,
    },
  });

  const profile = (await listProfiles(env, networkId)).find((p) => p.id === profileId);
  if (!profile) throw new ApiError("internal", "No se pudo leer el perfil recién creado");
  return profile;
}
