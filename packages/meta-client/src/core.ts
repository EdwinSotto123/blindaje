import { MetaApiError, MetaNetworkError, MetaTimeoutError } from "./errors";
import { assertModelAllowed } from "./guards";
import { estimateCost, isEssentialModel, type UsageUnits } from "./pricing";

/**
 * Transporte HTTP sobre `fetch` (sin APIs de Node: corre igual en Cloudflare Workers y en
 * Node 22) con reintentos, timeouts y errores tipados, más la instrumentación de costos.
 */

export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string | ArrayBuffer;
  signal: AbortSignal;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

/** Datos de una llamada que reciben los hooks. */
export interface CallInfo {
  model: string;
  /** Etiqueta libre para el registro de costos (ficha, transcribe, sam_image, vinculador…). */
  operation: string;
  /** false para modelos no esenciales (Muse Wonder, Muse Image), que se bloquean al 80% del presupuesto. */
  essential: boolean;
  /** Datos del llamador que pasan tal cual a los hooks (case_id, cache_key…). */
  context?: Record<string, unknown>;
}

export type UsageStatus = "ok" | "error" | "blocked";

export interface UsageEvent extends CallInfo {
  units: UsageUnits;
  cost_usd: number;
  status: UsageStatus;
  request_id: string | null;
  response_id: string | null;
  duration_ms: number;
  error?: { name: string; message: string; status?: number; code?: string | null };
}

export interface MetaHooks {
  /** Se llama antes de cada llamada facturable. Si lanza un error, la llamada se bloquea. */
  beforeCall?: (info: CallInfo) => void | Promise<void>;
  /** Se llama después de cada llamada facturable (ok, error o bloqueada). */
  onUsage?: (event: UsageEvent) => void | Promise<void>;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Tiempo máximo por intento, en ms. */
  timeoutMs?: number;
  /** Reintentos ante 429/5xx/red (además del primer intento). */
  maxRetries?: number;
  operation?: string;
  /** Permite marcar como no esencial una llamada a un modelo esencial (nunca al revés). */
  essential?: boolean;
  context?: Record<string, unknown>;
}

export interface MetaClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Tiempo máximo por intento (por defecto 120 s). */
  timeoutMs?: number;
  /** Reintentos ante 429, 5xx y errores de red (por defecto 3). */
  maxRetries?: number;
  /** Primer retraso del backoff exponencial (por defecto 500 ms). */
  retryBaseMs?: number;
  /** Tope del backoff exponencial (por defecto 30 s). */
  retryMaxMs?: number;
  /** Tope para respetar `Retry-After` (por defecto 60 s). */
  maxRetryAfterMs?: number;
  hooks?: MetaHooks;
  /** Inyectables para tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface RawRequest {
  method: "GET" | "POST" | "DELETE";
  path: string;
  json?: unknown;
  body?: ArrayBuffer;
  contentType?: string;
  accept?: string;
}

export interface Received<T> {
  value: T;
  requestId: string | null;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `Retry-After` en segundos o como fecha HTTP. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Convierte una respuesta HTTP de error en MetaApiError (con o sin sobre JSON `error`). */
export async function toApiError(res: Response, requestId: string | null): Promise<MetaApiError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    // cuerpo ilegible: seguimos con el estado
  }
  let message = text.trim() || res.statusText || "sin cuerpo";
  let code: string | null = null;
  let type: string | null = null;
  let param: string | null = null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const err = (parsed && typeof parsed.error === "object" ? parsed.error : parsed) as Record<string, unknown>;
    if (err && typeof err === "object") {
      if (typeof err.message === "string") message = err.message;
      if (typeof err.code === "string") code = err.code;
      if (typeof err.type === "string") type = err.type;
      if (typeof err.param === "string") param = err.param;
    }
  } catch {
    // no es JSON (404 sin cuerpo, texto plano de /v1/files)
  }
  if (message.length > 600) message = `${message.slice(0, 600)}…`;
  return new MetaApiError({
    status: res.status,
    message,
    code,
    type,
    param,
    requestId,
    retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
  });
}

export class ClientCore {
  readonly baseUrl: string;
  readonly hooks: MetaHooks;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #maxRetryAfterMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;

  constructor(options: MetaClientOptions) {
    if (!options.apiKey) throw new Error("MetaClient: falta apiKey");
    this.#apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const globalFetch = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    this.#fetch = options.fetch ?? globalFetch;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#retryBaseMs = options.retryBaseMs ?? 500;
    this.#retryMaxMs = options.retryMaxMs ?? 30_000;
    this.#maxRetryAfterMs = options.maxRetryAfterMs ?? 60_000;
    this.hooks = options.hooks ?? {};
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  /** Backoff exponencial con jitter: intento 0 → 500–750 ms, 1 → 1–1.5 s, 2 → 2–3 s… */
  backoffDelay(attempt: number, retryAfterMs: number | null): number {
    const exp = Math.min(this.#retryMaxMs, this.#retryBaseMs * 2 ** attempt);
    const jittered = exp + this.#random() * exp * 0.5;
    const floor = retryAfterMs === null ? 0 : Math.min(retryAfterMs, this.#maxRetryAfterMs);
    return Math.round(Math.max(jittered, floor));
  }

  /**
   * Envía una petición con reintentos. `consume` lee el cuerpo dentro del mismo intento (y del
   * mismo timeout), así un stream que se corta con un error transitorio también se reintenta.
   */
  async send<T>(
    req: RawRequest,
    call: CallOptions,
    consume: (res: Response, requestId: string | null) => Promise<T>,
  ): Promise<Received<T>> {
    const maxRetries = call.maxRetries ?? this.#maxRetries;
    const timeoutMs = call.timeoutMs ?? this.#timeoutMs;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#apiKey}` };
    let body: string | ArrayBuffer | undefined;
    if (req.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.json);
    } else if (req.body !== undefined) {
      body = req.body;
      if (req.contentType) headers["Content-Type"] = req.contentType;
    }
    if (req.accept) headers.Accept = req.accept;
    const url = `${this.baseUrl}${req.path}`;

    for (let attempt = 0; ; attempt++) {
      if (call.signal?.aborted) throw call.signal.reason ?? new Error("Petición cancelada");
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new MetaTimeoutError(timeoutMs));
      }, timeoutMs);
      const onAbort = () => controller.abort(call.signal?.reason);
      call.signal?.addEventListener("abort", onAbort, { once: true });
      let requestId: string | null = null;
      try {
        let res: Response;
        try {
          res = await this.#fetch(url, { method: req.method, headers, body, signal: controller.signal });
        } catch (error) {
          if (timedOut) throw new MetaTimeoutError(timeoutMs, { cause: error });
          if (call.signal?.aborted) throw error;
          throw new MetaNetworkError(error instanceof Error ? error.message : String(error), { cause: error });
        }
        requestId = res.headers.get("x-request-id");
        if (!res.ok) throw await toApiError(res, requestId);
        try {
          return { value: await consume(res, requestId), requestId };
        } catch (error) {
          if (timedOut) throw new MetaTimeoutError(timeoutMs, { cause: error });
          throw error;
        }
      } catch (error) {
        const retryable =
          (error instanceof MetaApiError && error.retryable) || error instanceof MetaNetworkError;
        if (!retryable || attempt >= maxRetries || call.signal?.aborted) throw error;
        const retryAfter = error instanceof MetaApiError ? error.retryAfterMs : null;
        await this.#sleep(this.backoffDelay(attempt, retryAfter));
      } finally {
        clearTimeout(timer);
        call.signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  /** JSON de ida y vuelta. */
  async json<T>(req: RawRequest, call: CallOptions = {}): Promise<Received<T>> {
    return this.send(req, call, async (res) => (await res.json()) as T);
  }

  /**
   * Envuelve una llamada facturable: salvaguarda de modelo, `beforeCall` (que puede bloquear),
   * y `onUsage` con unidades y costo estimado, también cuando la llamada falla o se bloquea.
   */
  async metered<T>(
    model: string,
    defaultOperation: string,
    call: CallOptions,
    run: () => Promise<{ value: T; units: UsageUnits; requestId: string | null; responseId?: string | null }>,
  ): Promise<T> {
    assertModelAllowed(model);
    const info: CallInfo = {
      model,
      operation: call.operation ?? defaultOperation,
      essential: isEssentialModel(model) && call.essential !== false,
      ...(call.context ? { context: call.context } : {}),
    };
    const started = Date.now();
    try {
      await this.hooks.beforeCall?.(info);
    } catch (error) {
      await this.#emit({ ...info, units: {}, cost_usd: 0, status: "blocked", request_id: null, response_id: null, duration_ms: 0, error: describe(error) });
      throw error;
    }
    try {
      const { value, units, requestId, responseId } = await run();
      await this.#emit({
        ...info,
        units,
        cost_usd: estimateCost(model, units),
        status: "ok",
        request_id: requestId,
        response_id: responseId ?? null,
        duration_ms: Date.now() - started,
      });
      return value;
    } catch (error) {
      await this.#emit({
        ...info,
        units: {},
        cost_usd: 0,
        status: "error",
        request_id: error instanceof MetaApiError ? error.requestId : null,
        response_id: null,
        duration_ms: Date.now() - started,
        error: describe(error),
      });
      throw error;
    }
  }

  async #emit(event: UsageEvent): Promise<void> {
    if (!this.hooks.onUsage) return;
    try {
      await this.hooks.onUsage(event);
    } catch (error) {
      // Un fallo al registrar el costo no debe tumbar la llamada que ya se pagó.
      console.warn("[meta-client] onUsage falló:", error instanceof Error ? error.message : error);
    }
  }
}

function describe(error: unknown): UsageEvent["error"] {
  if (error instanceof MetaApiError) {
    return { name: error.name, message: error.message, status: error.status, code: error.code };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}
