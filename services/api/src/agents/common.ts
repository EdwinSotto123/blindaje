import { createMetaClient, type FetchLike, type MetaClient } from "@blindaje/meta-client";
import { extractCitations, type CitationCheck } from "@blindaje/shared";
import type { Env } from "../env";
import { createMetaHooks } from "../costs";
import { newId, nowIso } from "../lib/ids";
import { log } from "../lib/log";

/**
 * Piezas comunes de los cuatro agentes (sección 10.1):
 * - cliente de Meta con los hooks de presupuesto y registro de costos;
 * - validador de citas: toda afirmación cita al menos un identificador y todos existen;
 * - un reintento con la lista de problemas; si vuelve a fallar, la salida queda inválida;
 * - cada ejecución queda en `agent_runs`.
 */

export type AgentKind = "ficha" | "vinculador" | "cartografo" | "vigia" | "redactor";

let metaFetchOverride: FetchLike | null = null;

/** Solo para pruebas: reemplaza el `fetch` de los clientes de Meta (sin reintentos). */
export function setMetaFetchForTests(fetch: FetchLike | null): void {
  metaFetchOverride = fetch;
}

export function metaClientFor(env: Env, defaults: { case_id?: string | null } = {}): MetaClient {
  return createMetaClient({
    apiKey: env.MODEL_API_KEY,
    hooks: createMetaHooks(env, defaults),
    ...(metaFetchOverride ? { fetch: metaFetchOverride, maxRetries: 0 } : {}),
  });
}

/** Campos de texto libre donde las citas se escriben dentro del texto, por ejemplo "(EV-A1)". */
const FREE_TEXT_FIELDS = new Set(["explicacion", "cuerpo", "resumen", "modus_operandi", "escalamiento"]);

function cleanCitation(raw: string): string {
  return raw.trim().replace(/^[([{"'“]+|[)\]}"'”.,;:]+$/g, "");
}

/**
 * Recorre la salida de un agente. Una "afirmación" es cualquier objeto con `texto` (string) y
 * `evidencia` (array): necesita al menos una cita y todas deben existir. Los demás arrays
 * `evidencia` y las citas escritas dentro de campos de texto libre también deben existir.
 */
export function validateCitations(output: unknown, known: Set<string>): CitationCheck {
  const sinCita: string[] = [];
  const inexistentes = new Set<string>();
  let total = 0;

  const checkRefs = (refs: unknown[]) => {
    for (const r of refs) {
      if (typeof r !== "string") continue;
      const c = cleanCitation(r);
      if (!known.has(c)) inexistentes.add(c);
    }
  };

  const walk = (node: unknown, key: string | null): void => {
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, key));
      return;
    }
    if (typeof node === "string") {
      if (key && FREE_TEXT_FIELDS.has(key)) checkRefs(extractCitations(node));
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.texto === "string" && Array.isArray(obj.evidencia)) {
      total++;
      const refs = obj.evidencia.filter((e): e is string => typeof e === "string" && e.trim() !== "");
      if (refs.length === 0) sinCita.push(obj.texto);
      checkRefs(refs);
      checkRefs(extractCitations(obj.texto));
    } else if (Array.isArray(obj.evidencia)) {
      checkRefs(obj.evidencia);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "evidencia") continue;
      if (k === "texto" && Array.isArray(obj.evidencia)) continue;
      walk(v, k);
    }
  };

  walk(output, null);
  const citas_inexistentes = [...inexistentes];
  return {
    ok: sinCita.length === 0 && citas_inexistentes.length === 0,
    total_afirmaciones: total,
    sin_cita: sinCita,
    citas_inexistentes,
  };
}

export function citationFeedback(check: CitationCheck): string {
  const parts = ["Tu respuesta anterior no pasó el validador de citas. Corrígela y entrégala completa otra vez."];
  if (check.sin_cita.length) parts.push(`Afirmaciones sin cita (agrega al menos un identificador que exista o elimínalas): ${check.sin_cita.map((t) => `"${t}"`).join("; ")}.`);
  if (check.citas_inexistentes.length) parts.push(`Identificadores que no existen en el material (no los uses): ${check.citas_inexistentes.join(", ")}.`);
  parts.push("Solo puedes citar identificadores que aparecen en el material o en lo que devolvieron tus herramientas.");
  return parts.join("\n");
}

export interface AgentAttempt<T> {
  output: T;
  cost_usd: number;
  tool_calls: number;
}

export interface CheckedAgentResult<T> {
  run_id: string;
  output: T;
  check: CitationCheck;
  status: "ok" | "invalido";
  attempts: number;
  cost_usd: number;
}

/**
 * Ejecuta un agente con validación de citas: si falla, reintenta una vez pasándole la lista de
 * problemas; si vuelve a fallar, devuelve la salida marcada como inválida (nunca se descarta en
 * silencio: la consola la muestra como inválida). Registra la ejecución en `agent_runs`.
 *
 * `known` puede ser una función porque las herramientas del agente van descubriendo etiquetas
 * durante la ejecución (el Cartógrafo solo puede citar lo que devolvieron sus herramientas).
 */
export async function runCheckedAgent<T>(
  env: Env,
  args: {
    agent: AgentKind;
    model: string;
    target_type: string;
    target_id: string;
    known: Set<string> | (() => Set<string>);
    attempt: (feedback: string | null) => Promise<AgentAttempt<T>>;
  },
): Promise<CheckedAgentResult<T>> {
  const knownSet = () => (typeof args.known === "function" ? args.known() : args.known);
  let cost = 0;
  let toolCalls = 0;
  let attempts = 0;
  let feedback: string | null = null;
  let last: { output: T; check: CitationCheck } | null = null;

  for (let i = 0; i < 2; i++) {
    attempts++;
    try {
      const res = await args.attempt(feedback);
      cost += res.cost_usd;
      toolCalls += res.tool_calls;
      const check = validateCitations(res.output, knownSet());
      last = { output: res.output, check };
      if (check.ok) break;
      feedback = citationFeedback(check);
      log("warn", "agent_citation_retry", { agent: args.agent, target: args.target_id, sin_cita: check.sin_cita.length, inexistentes: check.citas_inexistentes.length });
    } catch (err) {
      await recordAgentRun(env, { ...args, status: "error", attempts, tool_calls: toolCalls, output: null, check: null, cost_usd: cost });
      throw err;
    }
  }

  const final = last!;
  const status = final.check.ok ? "ok" : "invalido";
  const run_id = await recordAgentRun(env, { ...args, status, attempts, tool_calls: toolCalls, output: final.output, check: final.check, cost_usd: cost });
  return { run_id, output: final.output, check: final.check, status, attempts, cost_usd: cost };
}

export async function recordAgentRun(
  env: Env,
  r: {
    agent: AgentKind;
    model: string;
    target_type: string;
    target_id: string;
    status: "ok" | "invalido" | "error";
    attempts: number;
    tool_calls: number;
    output: unknown;
    check: CitationCheck | null;
    cost_usd: number;
  },
): Promise<string> {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO agent_runs (id, agent, target_type, target_id, model, status, attempts, tool_calls, output_json, citation_check_json, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      r.agent,
      r.target_type,
      r.target_id,
      r.model,
      r.status,
      r.attempts,
      r.tool_calls,
      r.output == null ? null : JSON.stringify(r.output),
      r.check == null ? null : JSON.stringify(r.check),
      r.cost_usd,
      nowIso(),
    )
    .run();
  return id;
}
