import type { TokenPair } from "@blindaje/shared";

/**
 * Cliente HTTP del portal de negocios (copia del de la consola, con su propio refresh).
 *
 *  - Adjunta `Authorization: Bearer <access>` solo a la API configurada (nunca a otros orígenes).
 *  - Ante un 401 renueva la sesión una sola vez (refresh de una sola vuelta, compartido entre
 *    peticiones concurrentes) y reintenta la petición original.
 *  - Si el refresh falla, limpia la sesión y avisa con `onSessionExpired`.
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

export interface Session {
  accessToken: string | null;
  refreshToken: string;
  /** Unix ms en que vence el access token. */
  expiresAt: number;
}

export interface TokenStore {
  get(): Session | null;
  set(session: Session): void;
  clear(): void;
}

/** Guarda todo en memoria. Útil para tests. */
export class MemoryTokenStore implements TokenStore {
  private session: Session | null;
  constructor(initial: Session | null = null) {
    this.session = initial;
  }
  get(): Session | null {
    return this.session;
  }
  set(session: Session): void {
    this.session = session;
  }
  clear(): void {
    this.session = null;
  }
}

/**
 * El access token vive solo en memoria; el refresh token en sessionStorage (sobrevive a recargar
 * la pestaña, no a cerrarla, y no se comparte entre pestañas).
 */
export class SessionTokenStore implements TokenStore {
  private access: { token: string; expiresAt: number } | null = null;
  constructor(private readonly key = "blindaje.portal.refresh") {}

  get(): Session | null {
    let refresh: string | null = null;
    try {
      refresh = sessionStorage.getItem(this.key);
    } catch {
      refresh = null;
    }
    if (!refresh) return null;
    return { accessToken: this.access?.token ?? null, refreshToken: refresh, expiresAt: this.access?.expiresAt ?? 0 };
  }

  set(session: Session): void {
    this.access = session.accessToken ? { token: session.accessToken, expiresAt: session.expiresAt } : null;
    try {
      sessionStorage.setItem(this.key, session.refreshToken);
    } catch {
      // Sin sessionStorage la sesión dura lo que la pestaña en memoria.
    }
  }

  clear(): void {
    this.access = null;
    try {
      sessionStorage.removeItem(this.key);
    } catch {
      // nada
    }
  }
}

export interface Validator {
  safeParse(value: unknown): { success: boolean; error?: unknown };
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /** false para rutas públicas (login, health). */
  auth?: boolean;
  signal?: AbortSignal;
  /** Esquema de shared para avisar en consola si la respuesta no cumple el contrato. */
  validate?: Validator;
}

export interface HttpClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetch?: typeof fetch;
  now?: () => number;
  onSessionExpired?: () => void;
  refreshPath?: string;
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "No pudimos procesar el pedido. Revisa los datos e intenta otra vez.",
  401: "Tu sesión terminó. Vuelve a entrar.",
  403: "Tu cuenta no tiene acceso a esta sección. Consulta con tu gremio.",
  404: "No encontramos lo que buscabas.",
  409: "Algo cambió mientras mirabas. Recarga la página.",
  422: "Los datos no son válidos. Revísalos e intenta otra vez.",
  429: "Hiciste muchos pedidos seguidos. Espera un minuto.",
  500: "Algo falló de nuestro lado. Intenta otra vez en un momento.",
  502: "Algo falló de nuestro lado. Intenta otra vez en un momento.",
  503: "El servicio no está disponible ahora. Intenta en unos minutos.",
};

export function sessionFromTokenPair(pair: TokenPair, now: number): Session {
  return {
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
    expiresAt: now + Math.max(0, pair.expires_in) * 1000,
  };
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly store: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshPath: string;
  private refreshing: Promise<boolean> | null = null;
  onSessionExpired: (() => void) | undefined;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.origin = new URL(this.baseUrl).origin;
    this.store = opts.store;
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = opts.now ?? (() => Date.now());
    this.refreshPath = opts.refreshPath ?? "/v1/auth/business/refresh";
    this.onSessionExpired = opts.onSessionExpired;
  }

  hasSession(): boolean {
    return this.store.get() !== null;
  }

  setTokens(pair: TokenPair): void {
    this.store.set(sessionFromTokenPair(pair, this.now()));
  }

  clearSession(): void {
    this.store.clear();
  }

  getRefreshToken(): string | null {
    return this.store.get()?.refreshToken ?? null;
  }

  /** Convierte una ruta relativa (`/v1/...`) o una URL de la API en URL absoluta. */
  resolve(pathOrUrl: string, query?: RequestOptions["query"]): URL {
    const url = /^https?:\/\//i.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(this.baseUrl + (pathOrUrl.startsWith("/") ? "" : "/") + pathOrUrl);
    if (url.origin !== this.origin) {
      throw new ApiRequestError(0, "bad_request", "La URL no pertenece a la API configurada; no se envía la credencial.");
    }
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    return url;
  }

  async json<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.send(method, path, opts);
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

  async blob(path: string, opts: RequestOptions = {}): Promise<Blob> {
    const res = await this.send("GET", path, opts);
    return res.blob();
  }

  /** Renueva la sesión. Varias llamadas simultáneas comparten el mismo refresh. */
  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const current = this.store.get();
    if (!current) return false;
    const res = await this.fetchImpl(this.resolve(this.refreshPath).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ refresh_token: current.refreshToken }),
    });
    if (!res.ok) {
      this.store.clear();
      return false;
    }
    const pair = (await res.json()) as TokenPair;
    this.setTokens(pair);
    return true;
  }

  private async send(method: string, path: string, opts: RequestOptions, retried = false): Promise<Response> {
    const auth = opts.auth ?? true;
    if (auth) {
      const s = this.store.get();
      // Sin access token (recarga de pestaña) o a punto de vencer: renovar antes de pedir.
      if (s && (!s.accessToken || s.expiresAt - 5_000 <= this.now())) {
        await this.refresh();
      }
    }

    const headers: Record<string, string> = { accept: "application/json" };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const token = auth ? this.store.get()?.accessToken : null;
    if (token) headers.authorization = `Bearer ${token}`;

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    if (opts.signal) init.signal = opts.signal;
    const res = await this.fetchImpl(this.resolve(path, opts.query).toString(), init);

    if (res.status === 401 && auth) {
      if (!retried && this.store.get()) {
        const ok = await this.refresh();
        if (ok) return this.send(method, path, opts, true);
      }
      this.store.clear();
      this.onSessionExpired?.();
      throw await toError(res);
    }
    if (!res.ok) throw await toError(res);
    return res;
  }
}

export async function toError(res: Response): Promise<ApiRequestError> {
  let code = res.status === 401 ? "unauthorized" : "internal";
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

/** Mensaje en español para mostrar al usuario a partir de cualquier error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    // Los errores del servidor no se muestran tal cual: la persona no necesita el detalle técnico.
    if (err.status >= 500 || err.status === 0) return STATUS_MESSAGES[err.status] ?? STATUS_MESSAGES[500]!;
    return err.message;
  }
  if (err instanceof TypeError) return "No pudimos conectarnos. Revisa tu internet e intenta otra vez.";
  return "Algo salió mal. Intenta otra vez.";
}
