import type { Env } from "../env";
import { timed } from "../lib/timing";

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
/** Vectores de consulta por petición: un caso con muchos segmentos de voz no cabe en una sola. */
export const CHROMA_QUERY_BATCH = 25;
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

/** Los ids también se guardan en KV: un aislado nuevo no pregunta a Chroma por cada colección. */
const ID_KV_PREFIX = "vectores:chroma:coleccion:";

export class ChromaClient {
  private readonly fetchImpl: ChromaFetch;

  constructor(
    readonly cfg: ChromaConfig,
    fetchImpl?: ChromaFetch,
    private readonly idCache?: KVNamespace,
  ) {
    this.fetchImpl = fetchImpl ?? testOverride?.fetch ?? ((input, init) => fetch(input, init));
  }

  private idKvKey(name: string): string {
    return `${ID_KV_PREFIX}${this.cfg.database}/${name}`;
  }

  private get dbPath(): string {
    return `/api/v2/tenants/${encodeURIComponent(this.cfg.tenant)}/databases/${encodeURIComponent(this.cfg.database)}`;
  }

  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const res = await timed("ext", () =>
      this.fetchImpl(this.cfg.url + path, {
        method,
        headers: { "x-chroma-token": this.cfg.apiKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );
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
    // Al crear se pregunta siempre (get_or_create es idempotente): si alguien borró la colección,
    // el id de KV ya no sirve. Una colección borrada a mano se nota en hasta 5 minutos (404 y forget).
    const stored = opts.create ? null : await this.idCache?.get(this.idKvKey(name), { cacheTtl: 300 }).catch(() => null);
    if (stored) {
      collectionIds.set(key, stored);
      return stored;
    }
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
    await this.idCache?.put(this.idKvKey(name), id).catch(() => undefined);
    return id;
  }

  /** Olvida el id guardado (por ejemplo, después de un 404 porque alguien borró la colección). */
  /** Olvida el id de una colección borrada (en este aislado y en KV). */
  async forget(name: string): Promise<void> {
    collectionIds.delete(`${this.cfg.tenant}/${this.cfg.database}/${name}`);
    await this.idCache?.delete(this.idKvKey(name)).catch(() => undefined);
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
    return (await this.queryMany(collectionId, [embedding], n))[0] ?? [];
  }

  /** Varias consultas en una sola ida y vuelta (de a CHROMA_QUERY_BATCH); un resultado por vector. */
  async queryMany(collectionId: string, embeddings: number[][], n: number): Promise<ChromaHit[][]> {
    if (n <= 0 || !embeddings.length) return embeddings.map(() => []);
    const out: ChromaHit[][] = [];
    for (let i = 0; i < embeddings.length; i += CHROMA_QUERY_BATCH) {
      const chunk = embeddings.slice(i, i + CHROMA_QUERY_BATCH);
      const res = await this.call<{ ids: string[][] | null; distances: Array<Array<number | null>> | null }>(
        "POST",
        `${this.dbPath}/collections/${collectionId}/query`,
        { query_embeddings: chunk, n_results: n, include: ["distances"] },
      );
      chunk.forEach((_, q) => {
        const ids = res.ids?.[q] ?? [];
        const dist = res.distances?.[q] ?? [];
        out.push(ids.map((id, j) => ({ id, score: 1 - Number(dist[j] ?? 1) })));
      });
    }
    return out;
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
  return cfg ? new ChromaClient(cfg, undefined, env.CONFIG) : null;
}
