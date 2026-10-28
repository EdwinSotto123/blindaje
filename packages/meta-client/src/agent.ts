import { z } from "zod";
import type { CallOptions } from "./core";
import { MetaAgentError, MetaApiError, MetaOutputError } from "./errors";
import { assertToolName } from "./guards";
import { estimateCost } from "./pricing";
import {
  addTokenUsage,
  assertCompleted,
  emptyTokenUsage,
  extractUsage,
  getFunctionCalls,
  getOutputText,
  parseStructuredText,
  zodTextFormat,
  zodToJsonSchema,
  type FunctionCallItem,
  type FunctionCallOutputInput,
  type FunctionToolDefinition,
  type InputItem,
  type MetaResponse,
  type ReasoningEffort,
  type ResponsesCreateParams,
  type TokenUsage,
} from "./responses";

/**
 * Bucle de agente sobre la Responses API con `previous_response_id` y `store: true`: el
 * servidor conserva la historia y el razonamiento entre turnos. `instructions`, `tools`,
 * `reasoning` y `text` NO se arrastran entre turnos, así que se reenvían en cada uno.
 */

export interface ToolContext {
  callId: string;
  turn: number;
  signal?: AbortSignal;
}

export interface AgentTool<P extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: P;
  /** Lo que devuelve se manda al modelo: los strings tal cual, el resto como JSON. */
  handler(args: z.output<P>, ctx: ToolContext): unknown;
  /** Validación strict del esquema en el servidor (por defecto false: igual validamos con Zod). */
  strict?: boolean;
}

/** Ayuda a inferir el tipo de los argumentos del handler. */
export function defineTool<P extends z.ZodType>(tool: AgentTool<P>): AgentTool<P> {
  return tool;
}

export interface ToolCallTrace {
  turn: number;
  callId: string;
  name: string;
  /** Argumentos ya parseados (o el texto crudo si no eran JSON). */
  arguments: unknown;
  /** Lo que se le devolvió al modelo. */
  output: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface AggregatedUsage extends TokenUsage {
  cost_usd: number;
  calls: number;
}

export interface RunAgentParams<S extends z.ZodType | undefined = undefined> {
  model: string;
  instructions: string;
  input: string | InputItem[];
  tools: AgentTool[];
  /** Máximo de llamadas al modelo (por defecto 8). La última va sin herramientas para forzar la respuesta. */
  maxTurns?: number;
  /** Esquema de la salida final; se pide con text.format strict y se valida con Zod. */
  finalSchema?: S;
  finalSchemaName?: string;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  parallelToolCalls?: boolean;
  /** Reintentos si la salida final no valida (por defecto 1). */
  validationRetries?: number;
  /** Texto que se agrega en el último turno, cuando ya no hay herramientas. */
  finalTurnMessage?: string;
  /** "return" (por defecto): el error del handler se le devuelve al modelo. "throw": aborta. */
  onToolError?: "return" | "throw";
  /** Parámetros extra de la Responses API (metadata, safety_identifier, prompt_cache_key…). */
  extra?: Partial<Omit<ResponsesCreateParams, "model" | "input" | "instructions" | "tools" | "text" | "previous_response_id" | "store">>;
}

export interface AgentResult<T> {
  output: T;
  outputText: string;
  trace: ToolCallTrace[];
  usage: AggregatedUsage;
  turns: number;
  responseIds: string[];
}

export type CreateResponse = (params: ResponsesCreateParams, call?: CallOptions) => Promise<MetaResponse>;

const DEFAULT_FINAL_TURN_MESSAGE =
  "Ya no tienes más herramientas disponibles. Entrega ahora tu respuesta final con la información que reuniste.";

type AgentOutput<S> = S extends z.ZodType ? z.output<S> : string;

export async function runAgent<S extends z.ZodType | undefined = undefined>(
  create: CreateResponse,
  params: RunAgentParams<S>,
  call: CallOptions = {},
): Promise<AgentResult<AgentOutput<S>>> {
  const maxTurns = params.maxTurns ?? 8;
  if (maxTurns < 1) throw new Error("maxTurns debe ser al menos 1");
  const byName = new Map<string, AgentTool>();
  for (const tool of params.tools) {
    assertToolName(tool.name);
    if (byName.has(tool.name)) throw new Error(`Herramienta duplicada: ${tool.name}`);
    byName.set(tool.name, tool);
  }
  const toolDefs: FunctionToolDefinition[] = params.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters),
    ...(tool.strict ? { strict: true } : {}),
  }));
  const textFormat = params.finalSchema
    ? { format: zodTextFormat(params.finalSchema, params.finalSchemaName ?? "salida_final") }
    : undefined;

  const trace: ToolCallTrace[] = [];
  const responseIds: string[] = [];
  let tokens = emptyTokenUsage();
  let cost = 0;
  let calls = 0;
  const partial = () => ({ trace, responseIds, usage: { ...tokens, cost_usd: cost, calls } });

  const callModel = async (input: string | InputItem[], previous: string | null, withTools: boolean) => {
    const request: ResponsesCreateParams = {
      ...params.extra,
      model: params.model,
      instructions: params.instructions,
      input,
      store: true,
      ...(previous ? { previous_response_id: previous } : {}),
      ...(withTools && toolDefs.length > 0 ? { tools: toolDefs, tool_choice: "auto" as const } : {}),
      ...(withTools && toolDefs.length > 0 && params.parallelToolCalls !== undefined
        ? { parallel_tool_calls: params.parallelToolCalls }
        : {}),
      ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
      ...(params.maxOutputTokens ? { max_output_tokens: params.maxOutputTokens } : {}),
      ...(textFormat ? { text: textFormat } : {}),
    };
    const response = await createChained(create, request, call);
    calls++;
    responseIds.push(response.id);
    const usage = extractUsage(response);
    tokens = addTokenUsage(tokens, usage);
    cost += estimateCost(params.model, usage);
    return response;
  };

  let response = await callModel(params.input, null, maxTurns > 1);
  let turn = 1;
  let validationRetriesLeft = params.validationRetries ?? 1;

  for (;;) {
    const functionCalls = getFunctionCalls(response);
    if (functionCalls.length === 0) {
      try {
        assertCompleted(response);
        const text = getOutputText(response);
        const output = params.finalSchema
          ? parseStructuredText(text, params.finalSchema, response.id)
          : text;
        return {
          output: output as AgentOutput<S>,
          outputText: text,
          trace,
          usage: { ...tokens, cost_usd: round(cost), calls },
          turns: turn,
          responseIds,
        };
      } catch (error) {
        const fixable = error instanceof MetaOutputError && error.code !== "failed";
        if (!fixable || validationRetriesLeft <= 0 || turn >= maxTurns) {
          throw new MetaAgentError("invalid_final_output", `La salida final no es válida: ${(error as Error).message}`, partial(), {
            cause: error,
          });
        }
        validationRetriesLeft--;
        turn++;
        const fix = `Tu respuesta anterior no es válida (${(error as Error).message.slice(0, 400)}). Responde de nuevo solo con la salida final que cumple el esquema.`;
        response = await callModel([{ role: "user", content: fix }], response.id, false);
        continue;
      }
    }

    if (turn >= maxTurns) {
      throw new MetaAgentError("max_turns", `El agente agotó ${maxTurns} turnos sin respuesta final`, partial());
    }

    const outputs = await Promise.all(functionCalls.map((fc) => executeTool(fc, byName, turn, params.onToolError ?? "return", call.signal)));
    for (const o of outputs) trace.push(o.trace);
    const failed = outputs.find((o) => o.fatal);
    if (failed) {
      throw new MetaAgentError("tool_error", `La herramienta ${failed.trace.name} falló: ${failed.trace.error}`, partial(), {
        cause: failed.fatal,
      });
    }

    turn++;
    const lastTurn = turn >= maxTurns;
    const input: InputItem[] = outputs.map((o) => o.item);
    if (lastTurn) input.push({ role: "user", content: params.finalTurnMessage ?? DEFAULT_FINAL_TURN_MESSAGE });
    response = await callModel(input, response.id, !lastTurn);
  }
}

async function executeTool(
  fc: FunctionCallItem,
  tools: Map<string, AgentTool>,
  turn: number,
  onToolError: "return" | "throw",
  signal: AbortSignal | undefined,
): Promise<{ item: FunctionCallOutputInput; trace: ToolCallTrace; fatal?: unknown }> {
  const started = Date.now();
  const finish = (output: string, ok: boolean, args: unknown, error?: string, fatal?: unknown) => ({
    item: { type: "function_call_output" as const, call_id: fc.call_id, output },
    trace: { turn, callId: fc.call_id, name: fc.name, arguments: args, output, ok, ...(error ? { error } : {}), durationMs: Date.now() - started },
    ...(fatal !== undefined ? { fatal } : {}),
  });

  const tool = tools.get(fc.name);
  if (!tool) {
    const error = `Herramienta desconocida: ${fc.name}`;
    return finish(JSON.stringify({ error }), false, fc.arguments, error);
  }
  let raw: unknown;
  try {
    raw = fc.arguments ? JSON.parse(fc.arguments) : {};
  } catch {
    const error = "Los argumentos no son JSON válido";
    return finish(JSON.stringify({ error }), false, fc.arguments, error);
  }
  const parsed = tool.parameters.safeParse(raw);
  if (!parsed.success) {
    const error = `Argumentos inválidos: ${z.prettifyError(parsed.error)}`;
    return finish(JSON.stringify({ error }), false, raw, error);
  }
  try {
    const result = await tool.handler(parsed.data, { callId: fc.call_id, turn, ...(signal ? { signal } : {}) });
    const output = typeof result === "string" ? result : JSON.stringify(result ?? null);
    return finish(output, true, parsed.data);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return finish(JSON.stringify({ error }), false, parsed.data, error, onToolError === "throw" ? err : undefined);
  }
}

/**
 * La persistencia de una respuesta puede tardar un poco tras `response.completed`; encadenar
 * enseguida con `previous_response_id` puede dar 400/404 unos segundos. Se reintenta dos veces.
 */
async function createChained(create: CreateResponse, request: ResponsesCreateParams, call: CallOptions): Promise<MetaResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await create(request, call);
    } catch (error) {
      const chainingLag =
        request.previous_response_id !== undefined &&
        error instanceof MetaApiError &&
        (error.status === 400 || error.status === 404) &&
        (error.param === "previous_response_id" || /previous_response|not found/i.test(error.message));
      if (!chainingLag || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

const round = (usd: number): number => Math.round(usd * 1e8) / 1e8;
