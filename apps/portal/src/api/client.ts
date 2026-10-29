/**
 * Cliente HTTP del portal público. No hay cuenta, sesión ni credenciales:
 *
 *  - Nunca manda `Authorization` ni cookies (`credentials: "omit"`) ni referer.
 *  - Solo habla con la API configurada: una URL de otro origen se rechaza antes de pedirla.
 *  - Los errores llegan como `{ error: { code, message, details? } }` y se convierten en
 *    `ApiRequestError`.
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface Validator {
  safeParse(value: unknown): { success: boolean; error?: unknown };
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
  /** Esquema de shared para avisar en consola si la respuesta no cumple el contrato. */
  validate?: Validator;
}

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "No pudimos procesar el pedido. Revisa el distrito y el rubro e intenta otra vez.",
  401: "Esta sección no está disponible ahora.",
  403: "Esta sección no está disponible ahora.",
  404: "No encontramos lo que buscabas.",
  422: "El distrito o el rubro no son válidos. Elige uno de la lista.",
  429: "Hiciste muchos pedidos seguidos. Espera un minuto.",
  500: "Algo falló de nuestro lado. Intenta otra vez en un momento.",
  502: "Algo falló de nuestro lado. Intenta otra vez en un momento.",
  503: "El servicio no está disponible ahora. Intenta en unos minutos.",
};

export class HttpClient {
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.origin = new URL(this.baseUrl).origin;
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** Convierte una ruta relativa (`/v1/...`) o una URL de la API en URL absoluta. */
  resolve(pathOrUrl: string, query?: RequestOptions["query"]): URL {
    const url = /^https?:\/\//i.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(this.baseUrl + (pathOrUrl.startsWith("/") ? "" : "/") + pathOrUrl);
    if (url.origin !== this.origin) {
      throw new ApiRequestError(0, "bad_request", "La URL no pertenece a la API configurada.");
    }
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    return url;
  }

  async json<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    };
    if (opts.signal) init.signal = opts.signal;
    const res = await this.fetchImpl(this.resolve(path, opts.query).toString(), init);
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (opts.validate) {
      const check = opts.validate.safeParse(data);
      if (!check.success) {
        console.warn(`[contrato] ${method} ${path}: la respuesta no cumple el esquema de @blindaje/shared`, check.error);
      }
    }
    return data as T;
  }
}

export async function toError(res: Response): Promise<ApiRequestError> {
  let code = "internal";
  let message = STATUS_MESSAGES[res.status] ?? `Error ${res.status}.`;
  let details: unknown;
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details;
    }
  } catch {
    // Cuerpo no JSON: se queda el mensaje por estado.
  }
  return new ApiRequestError(res.status, code, message, details);
}

/** Mensaje en español para mostrar a la persona a partir de cualquier error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    // Los errores del servidor no se muestran tal cual: la persona no necesita el detalle técnico.
    if (err.status >= 500 || err.status === 0) return STATUS_MESSAGES[err.status] ?? STATUS_MESSAGES[500]!;
    return err.message;
  }
  if (err instanceof TypeError) return "No pudimos conectarnos. Revisa tu internet e intenta otra vez.";
  return "Algo salió mal. Intenta otra vez.";
}
