import type { Env } from "../env";

/**
 * Cliente mínimo de Chroma Cloud (API REST v2) para el Worker: colecciones, upsert, consulta por
 * coseno, borrado y conteo. Sin SDK: el Worker solo necesita `fetch`.
 *
 * Las colecciones se crean con índice SPANN en espacio coseno; Chroma devuelve la distancia
 * coseno (1 − coseno), que aquí se convierte de vuelta en coseno.
 */

export const CHROMA_DEFAULT_URL = "https://api.trychroma.com";
/** Registros por petición de escritura (Chroma Cloud limita el tamaño de cada lote). */
export const CHROMA_BATCH = 100;
const TIMEOUT_MS = 8_000;

export interface ChromaConfig {
  url: string;
  apiKey: string;
  tenant: string;
  database: string;
}

export type ChromaFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ChromaTestOverride {
  /** null: los tests ven un despliegue sin Chroma. */
  cfg: ChromaConfig | null;
  fetch?: ChromaFetch;
}

let testOverride: ChromaTestOverride | null = null;

/** Solo para pruebas: fija la configuración y el `fetch` de Chroma (null vuelve a leer el entorno). */
export function setChromaForTests(o: ChromaTestOverride | null): void {
  testOverride = o;
  collectionIds.clear();
}

/** Solo para pruebas: lo instalado con setChromaForTests, o null. */
export function chromaForTests(): ChromaTestOverride | null {
  return testOverride;
}

/** Configuración desde los secretos; null si falta alguno (sin Chroma, el motor usa FAISS). */
export function chromaConfig(env: Env): ChromaConfig | null {
  if (testOverride) return testOverride.cfg;
  const apiKey = env.CHROMA_API_KEY?.trim();
  const tenant = env.CHROMA_TENANT?.trim();
  const database = env.CHROMA_DATABASE?.trim();
  if (!apiKey || !tenant || !database) return null;
  return { url: (env.CHROMA_URL?.trim() || CHROMA_DEFAULT_URL).replace(/\/+$/, ""), apiKey, tenant, database };
}

export class ChromaError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`chroma_${status}: ${path} ${detail}`.slice(0, 300));
    this.name = "ChromaError";
  }
}

export interface ChromaHit {
  id: string;
  /** Coseno: 1 − distancia coseno. */
  score: number;
}

/** Ids de colección por nombre, por aislado del Worker (no cambian salvo que se borre la colección). */
const collectionIds = new Map<string, string>();

export class ChromaClient {
  private readonly fetchImpl: ChromaFetch;

  constructor(
    readonly cfg: ChromaConfig,
    fetchImpl?: ChromaFetch,
  ) {
    this.fetchImpl = fetchImpl ?? testOverride?.fetch ?? ((input, init) => fetch(input, init));
  }

  private get dbPath(): string {
    return `/api/v2/tenants/${encodeURIComponent(this.cfg.tenant)}/databases/${encodeURIComponent(this.cfg.database)}`;
  }

  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.cfg.url + path, {
      method,
      headers: { "x-chroma-token": this.cfg.apiKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    // Nunca se registra la ruta completa: lleva el tenant.
    if (!res.ok) throw new ChromaError(res.status, path.replace(this.cfg.tenant, "<tenant>"), text.slice(0, 160));
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Ida y vuelta del heartbeat, en ms. */
  async heartbeat(): Promise<number> {
    const t = Date.now();
    await this.call("GET", "/api/v2/heartbeat");
    return Date.now() - t;
  }

  /** Id de la colección; la crea (coseno) si `create` y no existe. null si no existe y no se crea. */
  async collectionId(name: string, opts: { create?: boolean } = {}): Promise<string | null> {
    const key = `${this.cfg.tenant}/${this.cfg.database}/${name}`;
    const cached = collectionIds.get(key);
    if (cached) return cached;
    let id: string | null = null;
    if (opts.create) {
      const col = await this.call<{ id: string }>("POST", `${this.dbPath}/collections`, {
        name,
        get_or_create: true,
        configuration: { spann: { space: "cosine" } },
        metadata: { origen: "blindaje" },
      });
      id = col.id;
    } else {
      try {
        id = (await this.call<{ id: string }>("GET", `${this.dbPath}/collections/${encodeURIComponent(name)}`)).id;
      } catch (err) {
        if (err instanceof ChromaError && err.status === 404) return null;
        throw err;
      }
    }
    collectionIds.set(key, id);
    return id;
  }

  /** Olvida el id guardado (por ejemplo, después de un 404 porque alguien borró la colección). */
  forget(name: string): void {
    collectionIds.delete(`${this.cfg.tenant}/${this.cfg.database}/${name}`);
  }

  async upsert(collectionId: string, ids: string[], embeddings: number[][], metadatas: Array<Record<string, string | number>>): Promise<void> {
    for (let i = 0; i < ids.length; i += CHROMA_BATCH) {
      await this.call("POST", `${this.dbPath}/collections/${collectionId}/upsert`, {
        ids: ids.slice(i, i + CHROMA_BATCH),
        embeddings: embeddings.slice(i, i + CHROMA_BATCH),
        metadatas: metadatas.slice(i, i + CHROMA_BATCH),
      });
    }
  }

  /** Los `n` vecinos más cercanos de un vector, de más a menos parecido. */
  async query(collectionId: string, embedding: number[], n: number): Promise<ChromaHit[]> {
    if (n <= 0) return [];
    const res = await this.call<{ ids: string[][]; distances: Array<Array<number | null>> | null }>(
      "POST",
      `${this.dbPath}/collections/${collectionId}/query`,
      { query_embeddings: [embedding], n_results: n, include: ["distances"] },
    );
    const ids = res.ids?.[0] ?? [];
    const dist = res.distances?.[0] ?? [];
    return ids.map((id, i) => ({ id, score: 1 - Number(dist[i] ?? 1) }));
  }

  async delete(collectionId: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += CHROMA_BATCH) {
      await this.call("POST", `${this.dbPath}/collections/${collectionId}/delete`, { ids: ids.slice(i, i + CHROMA_BATCH) });
    }
  }

  async count(collectionId: string): Promise<number> {
    return Number(await this.call<number>("GET", `${this.dbPath}/collections/${collectionId}/count`));
  }

  /** Todos los ids de la colección, por páginas (Chroma Cloud acepta hasta 300 por lectura). */
  async ids(collectionId: string, page = 300): Promise<string[]> {
    const out: string[] = [];
    for (let offset = 0; ; offset += page) {
      const res = await this.call<{ ids: string[] }>("POST", `${this.dbPath}/collections/${collectionId}/get`, {
        limit: page,
        offset,
        include: [],
      });
      out.push(...(res.ids ?? []));
      if ((res.ids ?? []).length < page) return out;
    }
  }
}

export function getChromaClient(env: Env): ChromaClient | null {
  const cfg = chromaConfig(env);
  return cfg ? new ChromaClient(cfg) : null;
}
