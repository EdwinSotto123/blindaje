import { z } from "zod";
import { MetaGuardError, MetaOutputError } from "./errors";
import type { UsageUnits } from "./pricing";

/**
 * Tipos de la Responses API (`POST /v1/responses`) y helpers puros para leer respuestas y armar
 * salida estructurada con Zod.
 */

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface InputTextPart {
  type: "input_text";
  text: string;
}
export interface InputImagePart {
  type: "input_image";
  image_url?: string;
  file_id?: string;
  detail?: "low" | "high" | "auto";
}
export interface InputVideoPart {
  type: "input_video";
  video_url?: string;
  file_id?: string;
}
export interface InputFilePart {
  type: "input_file";
  file_id?: string;
  file_data?: string;
  file_url?: string;
  filename?: string;
}
export interface OutputTextPart {
  type: "output_text";
  text: string;
  annotations?: unknown[];
}
export type ContentPart = InputTextPart | InputImagePart | InputVideoPart | InputFilePart | OutputTextPart;

export interface MessageInput {
  type?: "message";
  role: "user" | "system" | "developer" | "assistant";
  content: string | ContentPart[];
  phase?: "commentary" | "final_answer";
}
export interface FunctionCallOutputInput {
  type: "function_call_output";
  call_id: string;
  output: string;
}
export type InputItem = MessageInput | FunctionCallOutputInput | FunctionCallItem | ReasoningItem;

export interface FunctionToolDefinition {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}
/** Otras herramientas (custom, namespace…). `web_search` está bloqueada por las salvaguardas. */
export interface OtherToolDefinition {
  type: string;
  [key: string]: unknown;
}
export type ToolDefinition = FunctionToolDefinition | OtherToolDefinition;

export interface JsonSchemaTextFormat {
  type: "json_schema";
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  description?: string;
}

export interface ResponsesCreateParams {
  model: string;
  input: string | InputItem[];
  instructions?: string;
  previous_response_id?: string;
  store?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: "auto";
  parallel_tool_calls?: boolean;
  reasoning?: { effort?: ReasoningEffort; summary?: "auto" | "concise" | "detailed" };
  text?: { format?: JsonSchemaTextFormat | { type: "text" } };
  max_output_tokens?: number;
  metadata?: Record<string, string>;
  include?: string[];
  safety_identifier?: string;
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
  temperature?: number;
  top_p?: number;
}

export interface OutputMessage {
  type: "message";
  id: string;
  role: "assistant";
  status?: string;
  phase?: "commentary";
  content: Array<OutputTextPart | { type: "refusal"; refusal: string } | { type: string; [k: string]: unknown }>;
}
export interface FunctionCallItem {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: string;
}
export interface ReasoningItem {
  type: "reasoning";
  id?: string;
  summary: Array<{ type: string; text: string }>;
  encrypted_content?: string | null;
  content?: unknown[];
}
export type OutputItem = OutputMessage | FunctionCallItem | ReasoningItem | { type: string; [k: string]: unknown };

export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens?: number } | null;
  output_tokens_details?: { reasoning_tokens?: number } | null;
  /** SAM 3.1 en video: frames facturados (incluye el mínimo de 50). */
  video_frames_processed?: number;
  [key: string]: unknown;
}

export interface MetaResponse {
  id: string;
  object: "response";
  created_at?: number;
  status: "completed" | "incomplete" | "failed" | "in_progress" | "queued" | "cancelled";
  model: string;
  output: OutputItem[];
  usage?: ResponseUsage | null;
  error?: { code?: string | null; message?: string } | null;
  incomplete_details?: { reason?: string | null } | null;
  previous_response_id?: string | null;
  [key: string]: unknown;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
}

export function emptyTokenUsage(): TokenUsage {
  return { input_tokens: 0, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 0 };
}

/** Uso de tokens de una respuesta: entrada, salida, razonamiento y caché. */
export function extractUsage(response: Pick<MetaResponse, "usage">): TokenUsage {
  const u = response.usage;
  if (!u) return emptyTokenUsage();
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const input = n(u.input_tokens);
  const output = n(u.output_tokens);
  return {
    input_tokens: input,
    output_tokens: output,
    cached_tokens: n(u.input_tokens_details?.cached_tokens),
    reasoning_tokens: n(u.output_tokens_details?.reasoning_tokens),
    total_tokens: n(u.total_tokens) || input + output,
  };
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cached_tokens: a.cached_tokens + b.cached_tokens,
    reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

export function tokenUnits(usage: TokenUsage): UsageUnits {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cached_tokens: usage.cached_tokens,
    reasoning_tokens: usage.reasoning_tokens,
  };
}

/**
 * Texto final del asistente: concatena los `output_text` de los mensajes que no son comentario
 * intermedio (`phase: "commentary"`, el preámbulo antes de una llamada a herramienta).
 */
export function getOutputText(response: Pick<MetaResponse, "output">): string {
  let text = "";
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    const msg = item as OutputMessage;
    if (msg.phase === "commentary") continue;
    for (const part of msg.content ?? []) {
      if (part.type === "output_text" && typeof (part as OutputTextPart).text === "string") {
        text += (part as OutputTextPart).text;
      }
    }
  }
  return text;
}

export function getRefusal(response: Pick<MetaResponse, "output">): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of (item as OutputMessage).content ?? []) {
      if (part.type === "refusal" && typeof (part as { refusal?: unknown }).refusal === "string") {
        return (part as { refusal: string }).refusal;
      }
    }
  }
  return null;
}

export function getFunctionCalls(response: Pick<MetaResponse, "output">): FunctionCallItem[] {
  return (response.output ?? []).filter((item): item is FunctionCallItem => item.type === "function_call");
}

/** Lanza si la respuesta no terminó bien (incompleta por tokens, fallida o cancelada). */
export function assertCompleted(response: MetaResponse): void {
  if (response.status === "completed") return;
  const reason = response.incomplete_details?.reason ?? response.error?.message ?? response.status;
  throw new MetaOutputError(
    response.status === "incomplete" ? "incomplete" : "failed",
    `La respuesta ${response.id} terminó con estado ${response.status} (${reason})`,
    { responseId: response.id, rawText: getOutputText(response) },
  );
}

// ---------------------------------------------------------------------------------------------
// Salida estructurada
// ---------------------------------------------------------------------------------------------

const SCHEMA_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Convierte un esquema Zod a JSON Schema para la Meta API (sin `$schema`). */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/**
 * Verifica el subconjunto strict de la Meta API (documentación de structured output): raíz
 * objeto plano, sin allOf/oneOf, `additionalProperties: false` y `required` con todas las
 * propiedades en cada objeto. Devuelve la lista de problemas (vacía si cumple).
 */
export function strictSubsetProblems(schema: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (schema.type !== "object") problems.push("la raíz debe ser un objeto (type: object)");
  for (const key of ["anyOf", "oneOf", "allOf", "enum", "not"]) {
    if (key in schema) problems.push(`la raíz no puede usar ${key}`);
  }
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if ("allOf" in n) problems.push(`${path}: allOf no está soportado`);
    if ("oneOf" in n) problems.push(`${path}: oneOf no está soportado`);
    if (n.properties && typeof n.properties === "object") {
      if (n.additionalProperties !== false) problems.push(`${path}: falta additionalProperties: false`);
      const keys = Object.keys(n.properties as object);
      const required = new Set(Array.isArray(n.required) ? (n.required as string[]) : []);
      const missing = keys.filter((k) => !required.has(k));
      if (missing.length > 0) {
        problems.push(`${path}: required debe listar todas las propiedades (faltan ${missing.join(", ")}; usa .nullable() en vez de .optional())`);
      }
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === "enum" || key === "const" || key === "required") continue;
      walk(value, path === "" ? key : `${path}.${key}`);
    }
  };
  walk(schema, "");
  return problems;
}

export interface TextFormatOptions {
  /** Por defecto true: el servidor valida el esquema contra el subconjunto strict. */
  strict?: boolean;
  description?: string;
}

/**
 * Arma `text.format` para salida estructurada:
 * `{type: "json_schema", name, schema, strict: true}`. Con strict, revisa el subconjunto
 * localmente y lanza MetaGuardError antes de gastar una llamada.
 */
export function zodTextFormat(schema: z.ZodType, name: string, options: TextFormatOptions = {}): JsonSchemaTextFormat {
  if (!SCHEMA_NAME.test(name)) {
    throw new MetaGuardError("invalid_schema", `Nombre de esquema inválido: "${name}" (usa [a-zA-Z0-9_-], máx. 64)`);
  }
  const json = zodToJsonSchema(schema);
  const strict = options.strict ?? true;
  if (strict) {
    const problems = strictSubsetProblems(json);
    if (problems.length > 0) {
      throw new MetaGuardError("invalid_schema", `El esquema ${name} no cumple el modo strict: ${problems.join("; ")}`);
    }
  }
  return {
    type: "json_schema",
    name,
    schema: json,
    strict,
    ...(options.description ? { description: options.description } : {}),
  };
}

/** Parsea y valida el texto JSON de una respuesta con un esquema Zod. */
export function parseStructuredText<S extends z.ZodType>(text: string, schema: S, responseId: string | null = null): z.output<S> {
  const trimmed = stripCodeFence(text.trim());
  if (trimmed === "") throw new MetaOutputError("empty_output", "La respuesta no trae texto", { responseId });
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (cause) {
    throw new MetaOutputError("invalid_json", "La respuesta no es JSON válido", { rawText: text, responseId, cause });
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new MetaOutputError("schema_mismatch", `La respuesta no cumple el esquema: ${z.prettifyError(result.error)}`, {
      rawText: text,
      responseId,
      issues: result.error.issues,
    });
  }
  return result.data;
}

function stripCodeFence(text: string): string {
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/;
  const match = fence.exec(text);
  return match?.[1] !== undefined ? match[1].trim() : text;
}
