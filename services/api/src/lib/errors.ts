import type { ErrorCode } from "@blindaje/shared";

/**
 * Códigos de error de la API. `not_implemented` es local de services/api (stubs del pipeline);
 * se propone agregarlo a ErrorCode en packages/shared.
 */
export type ApiErrorCode = ErrorCode | "not_implemented";

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  integrity_mismatch: 422,
  budget_exceeded: 402,
  upstream_error: 503,
  internal: 500,
  demo_disabled: 404,
  not_implemented: 501,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { details?: unknown; status?: number; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = opts.status ?? STATUS[code];
    this.details = opts.details;
    this.headers = opts.headers;
  }
}

/** Lo lanzan los stubs del pipeline, linking y agentes mientras otro frente los completa. */
export class NotImplementedError extends ApiError {
  constructor(what: string) {
    super("not_implemented", `Todavía no implementado: ${what}`);
    this.name = "NotImplementedError";
  }
}

export function errorBody(code: ApiErrorCode, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export const notFound = (what = "Recurso") => new ApiError("not_found", `${what} no encontrado`);
