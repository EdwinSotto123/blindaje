/**
 * Errores tipados del cliente. Todos extienden `MetaError` para poder atraparlos juntos.
 *
 * - MetaApiError: la API respondió con un estado HTTP de error, o el stream terminó con un
 *   evento de error (`response.failed` o `error`). Trae status, code, type, param y request id.
 * - MetaTimeoutError: se agotó el tiempo de la petición (AbortSignal interno).
 * - MetaGuardError: una salvaguarda local bloqueó la llamada antes de salir (modelo
 *   contributor, búsqueda web, nombre de herramienta inválido, esquema fuera del modo strict…).
 * - MetaOutputError: la respuesta llegó pero no sirve (JSON inválido, no cumple el esquema,
 *   respuesta incompleta, salida vacía).
 * - MetaAgentError: el bucle de agente no pudo terminar (por ejemplo, agotó los turnos).
 */

export class MetaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Códigos de error de stream que la documentación declara reintentables. */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "server_error",
  "server_shutting_down",
  "service_overloaded",
  "backend_unavailable",
  "rate_limit_exceeded",
  "gateway_timeout",
]);

export interface MetaApiErrorInit {
  status: number;
  message: string;
  code?: string | null;
  type?: string | null;
  param?: string | null;
  requestId?: string | null;
  retryAfterMs?: number | null;
  /** true si el error llegó dentro de un stream SSE (HTTP 200) y no como estado HTTP. */
  inStream?: boolean;
}

export class MetaApiError extends MetaError {
  readonly status: number;
  readonly code: string | null;
  readonly type: string | null;
  readonly param: string | null;
  readonly requestId: string | null;
  readonly retryAfterMs: number | null;
  readonly inStream: boolean;

  constructor(init: MetaApiErrorInit) {
    const where = init.inStream ? "stream" : `HTTP ${init.status}`;
    super(`Meta API ${where}${init.code ? ` (${init.code})` : ""}: ${init.message}`);
    this.status = init.status;
    this.code = init.code ?? null;
    this.type = init.type ?? null;
    this.param = init.param ?? null;
    this.requestId = init.requestId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.inStream = init.inStream ?? false;
  }

  /** 429, 5xx y errores de stream con código transitorio se reintentan. */
  get retryable(): boolean {
    if (this.inStream) return this.code !== null && RETRYABLE_ERROR_CODES.has(this.code);
    return this.status === 429 || this.status >= 500;
  }
}

/** Falló la red antes de recibir respuesta (DNS, conexión cortada). Se reintenta. */
export class MetaNetworkError extends MetaError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Error de red al llamar a la Meta API: ${message}`, options);
  }
}

export class MetaTimeoutError extends MetaError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`La petición a la Meta API superó el tiempo límite de ${timeoutMs} ms`, options);
    this.timeoutMs = timeoutMs;
  }
}

export type MetaGuardCode =
  | "contributor_model_forbidden"
  | "web_search_forbidden"
  | "tool_choice_unsupported"
  | "invalid_tool_name"
  | "duplicate_tool_name"
  | "invalid_schema"
  | "invalid_input"
  | "unknown_model_pricing";

export class MetaGuardError extends MetaError {
  readonly code: MetaGuardCode;
  constructor(code: MetaGuardCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type MetaOutputCode = "empty_output" | "invalid_json" | "schema_mismatch" | "incomplete" | "failed";

export class MetaOutputError extends MetaError {
  readonly code: MetaOutputCode;
  readonly rawText: string;
  readonly responseId: string | null;
  readonly issues: unknown;
  constructor(
    code: MetaOutputCode,
    message: string,
    details: { rawText?: string; responseId?: string | null; issues?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.code = code;
    this.rawText = details.rawText ?? "";
    this.responseId = details.responseId ?? null;
    this.issues = details.issues;
  }
}

export type MetaAgentCode = "max_turns" | "invalid_final_output" | "tool_error";

export class MetaAgentError extends MetaError {
  readonly code: MetaAgentCode;
  /** Traza de herramientas y uso acumulado hasta el fallo, para registrar costos igual. */
  readonly partial: unknown;
  constructor(code: MetaAgentCode, message: string, partial: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.partial = partial;
  }
}
