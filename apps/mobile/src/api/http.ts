/** Capa HTTP mínima, inyectable (fetch real de Expo o servidor simulado en memoria). */

export type HttpRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers: Record<string, string>;
  body?: string | Uint8Array;
};

export type HttpResponse = {
  status: number;
  ok: boolean;
  header(name: string): string | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
};

export type Fetcher = (url: string, req: HttpRequest) => Promise<HttpResponse>;

/** El servidor respondió con un error del contrato ({ error: { code, message } }). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** No hubo respuesta (sin conexión, DNS, tiempo agotado). La cola reintenta. */
export class NetworkError extends Error {
  constructor(message = "Sin conexión") {
    super(message);
    this.name = "NetworkError";
  }
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}
