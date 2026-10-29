import type { Env } from "../env";
import { nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import type { MlClient, MlIndexName } from "../ml/client";
import { ChromaError, getChromaClient, type ChromaClient } from "./chroma";
import { decodeVector } from "./codec";

/**
 * Base vectorial del motor de vinculación. Dos implementaciones de la misma búsqueda:
 *  - Chroma Cloud (`ChromaStore`): colecciones blindaje-voz, blindaje-voz-segmento, blindaje-texto
 *    y blindaje-imagen, índice SPANN en espacio coseno, consultadas desde el Worker.
 *  - FAISS (`FaissStore`): `IndexIDMap2(IndexFlatIP)` en el contenedor ML.
 * En las dos, D1 es la fuente de verdad (`embeddings`) y todo resultado se filtra contra D1.
 *
 * Chroma Cloud es un servicio de terceros: con CHROMA_SOLO_DEMO (por defecto) solo recibe vectores
 * de casos ficticios del demo, con id numérico, tipo y modelo como únicos metadatos. Los casos
 * reales siguen en FAISS, dentro de nuestro contenedor.
 */

export type VectorStoreProvider = "chroma-cloud" | "faiss";

export interface VectorHit {
  id: number;
  /** Coseno con el vector de la consulta. */
  score: number;
}

export interface VectorStore {
  readonly provider: VectorStoreProvider;
  /** Los `k` vecinos más cercanos sin contar `excludeIds` (los vectores del mismo caso). */
  search(index: MlIndexName, vector: number[], k: number, excludeIds: number[]): Promise<VectorHit[]>;
}

export const VECTOR_INDEX_NAMES: MlIndexName[] = ["voz", "voz_segmento", "texto", "imagen"];

export function collectionName(index: MlIndexName): string {
  return `blindaje-${index.replace("_", "-")}`;
}

export function chromaSoloDemo(env: Env): boolean {
  return env.CHROMA_SOLO_DEMO?.trim().toLowerCase() !== "false";
}

/** ¿Este caso puede estar en Chroma? Con CHROMA_SOLO_DEMO, solo casos ficticios del demo. */
export function chromaEligible(env: Env, c: { is_demo: number }): boolean {
  return !chromaSoloDemo(env) || c.is_demo === 1;
}

export class FaissStore implements VectorStore {
  readonly provider = "faiss" as const;

  constructor(private readonly ml: MlClient) {}

  async search(index: MlIndexName, vector: number[], k: number, excludeIds: number[]): Promise<VectorHit[]> {
    return (await this.ml.indexSearch(index, vector, k, excludeIds)).results;
  }
}

export class ChromaStore implements VectorStore {
  readonly provider = "chroma-cloud" as const;

  constructor(readonly client: ChromaClient) {}

  async search(index: MlIndexName, vector: number[], k: number, excludeIds: number[]): Promise<VectorHit[]> {
    const name = collectionName(index);
    const id = await this.client.collectionId(name);
    if (!id) return [];
    const excl = new Set(excludeIds);
    let hits;
    try {
      hits = await this.client.query(id, vector, k + excl.size);
    } catch (err) {
      if (err instanceof ChromaError && err.status === 404) this.client.forget(name);
      throw err;
    }
    return hits
      .map((h) => ({ id: Number(h.id), score: h.score }))
      .filter((h) => Number.isSafeInteger(h.id) && !excl.has(h.id))
      .slice(0, k);
  }
}

/** Chroma para este caso si está configurado y el caso puede estar en la nube; si no, null. */
export function chromaStoreFor(env: Env, c: { is_demo: number }): ChromaStore | null {
  if (!chromaEligible(env, c)) return null;
  const client = getChromaClient(env);
  return client ? new ChromaStore(client) : null;
}

interface EmbeddingRow {
  faiss_id: number;
  index_name: MlIndexName;
  ref_type: string;
  model: string;
  vector_b64: string;
}

async function upsertRows(client: ChromaClient, rows: EmbeddingRow[]): Promise<Record<MlIndexName, number>> {
  const out = { voz: 0, voz_segmento: 0, texto: 0, imagen: 0 } as Record<MlIndexName, number>;
  for (const index of VECTOR_INDEX_NAMES) {
    const mine = rows.filter((r) => r.index_name === index);
    if (!mine.length) continue;
    const id = (await client.collectionId(collectionName(index), { create: true }))!;
    await client.upsert(
      id,
      mine.map((r) => String(r.faiss_id)),
      mine.map((r) => decodeVector(r.vector_b64)),
      mine.map((r) => ({ tipo: r.ref_type, modelo: r.model })),
    );
    out[index] = mine.length;
  }
  return out;
}

/** Sube a Chroma los vectores de un caso recién indexado (mejor esfuerzo; la sincronización completa lo repara). */
export async function chromaUpsertCase(env: Env, caseId: string): Promise<boolean> {
  const client = getChromaClient(env);
  if (!client) return false;
  try {
    const c = await env.DB.prepare("SELECT is_demo, indexed FROM cases WHERE id = ?").bind(caseId).first<{ is_demo: number; indexed: number }>();
    if (!c || c.indexed !== 1 || !chromaEligible(env, c)) return false;
    const { results } = await env.DB.prepare("SELECT faiss_id, index_name, ref_type, model, vector_b64 FROM embeddings WHERE case_id = ?")
      .bind(caseId)
      .all<EmbeddingRow>();
    if (!results.length) return false;
    await upsertRows(client, results);
    return true;
  } catch (err) {
    log("warn", "chroma_upsert_failed", { case_id: caseId, ...errorFields(err) });
    return false;
  }
}

/** Borra vectores de Chroma (mejor esfuerzo: si falla, la búsqueda igual los filtra contra D1). */
export async function chromaRemove(env: Env, vecs: Array<{ faiss_id: number; index_name: MlIndexName }>): Promise<boolean> {
  const client = getChromaClient(env);
  if (!client || !vecs.length) return false;
  try {
    for (const index of VECTOR_INDEX_NAMES) {
      const ids = vecs.filter((v) => v.index_name === index).map((v) => String(v.faiss_id));
      if (!ids.length) continue;
      const id = await client.collectionId(collectionName(index));
      if (id) await client.delete(id, ids);
    }
    return true;
  } catch (err) {
    log("warn", "chroma_remove_failed", errorFields(err));
    return false;
  }
}

export const CHROMA_SYNC_KV_KEY = "vectores:chroma:sincronizado_en";

export interface ChromaSyncResult {
  written: Record<MlIndexName, number>;
  deleted: number;
}

/**
 * Sincronización completa D1 → Chroma: sube los vectores de los casos indexados que pueden estar en
 * la nube y borra de cada colección los ids que ya no corresponden (caso borrado, desindexado o no
 * elegible). Idempotente.
 */
export async function syncChroma(env: Env): Promise<ChromaSyncResult | null> {
  const client = getChromaClient(env);
  if (!client) return null;
  const written = { voz: 0, voz_segmento: 0, texto: 0, imagen: 0 } as Record<MlIndexName, number>;
  let deleted = 0;
  const soloDemo = chromaSoloDemo(env);
  for (const index of VECTOR_INDEX_NAMES) {
    const { results } = await env.DB.prepare(
      `SELECT e.faiss_id, e.index_name, e.ref_type, e.model, e.vector_b64 FROM embeddings e JOIN cases c ON c.id = e.case_id
       WHERE e.index_name = ? AND c.indexed = 1 ${soloDemo ? "AND c.is_demo = 1" : ""} ORDER BY e.faiss_id`,
    )
      .bind(index)
      .all<EmbeddingRow>();
    const got = await upsertRows(client, results);
    written[index] = got[index];
    const colId = await client.collectionId(collectionName(index), { create: true });
    if (!colId) continue;
    const keep = new Set(results.map((r) => String(r.faiss_id)));
    const stale = (await client.ids(colId)).filter((id) => !keep.has(id));
    if (stale.length) await client.delete(colId, stale);
    deleted += stale.length;
  }
  await env.CONFIG.put(CHROMA_SYNC_KV_KEY, nowIso());
  log("info", "chroma_synced", { ...written, deleted });
  return { written, deleted };
}
