import {
  Calibration,
  DEFAULT_CALIBRATION,
  statusForScore,
  type Signals,
  type VinculadorOutput,
} from "@blindaje/shared";
import type { Env } from "../env";
import { newId, nowIso } from "../lib/ids";
import { nextCounter } from "../lib/db";
import { errorFields, log } from "../lib/log";
import { tryGetMlClient, type MlIndexName } from "../ml/client";
import { recomputeNetworks } from "../networks";

/**
 * Motor de vinculación (sección 9). Este módulo deja implementado lo que la API necesita
 * (sacar un caso de los índices, guardar vínculos, calibración, snapshots) y como STUBS la
 * búsqueda de candidatos y la indexación, que completa el frente de pipeline.
 *
 * Invariantes que cualquier implementación debe respetar:
 * - Solo casos con `cases.indexed = 1` (consentimiento comunitario) participan en búsquedas y
 *   vínculos. Los resultados de FAISS se filtran SIEMPRE contra D1, porque un índice puede tener
 *   vectores viejos si el contenedor no estaba disponible al desindexar.
 * - `embeddings` es la fuente de verdad de los vectores; al reconstruir, solo entran los de
 *   casos indexados (`rebuildIndices`).
 * - Ningún vínculo existe en el grafo sin revisión humana (`confirmado`).
 */

export const CALIBRATION_KV_KEY = "calibration:v1";
const INDEX_SNAPSHOT_KEY = "faiss/latest.zip";

export async function loadCalibration(env: Env): Promise<Calibration> {
  try {
    const raw = await env.CONFIG.get(CALIBRATION_KV_KEY, "json");
    if (raw) {
      const parsed = Calibration.safeParse(raw);
      if (parsed.success) return parsed.data;
      log("warn", "calibration_invalid_in_kv");
    }
  } catch (err) {
    log("warn", "calibration_read_failed", errorFields(err));
  }
  return DEFAULT_CALIBRATION;
}

export interface CandidatePair {
  case_id: string;
  other_case_id: string;
  signals: Signals;
  /** 1 − ∏(1 − pᵢ) antes del Vinculador. */
  score_raw: number;
}

/** STUB (M3): busca candidatos en los cuatro índices y calcula señales calibradas. */
export async function findCandidates(_env: Env, _caseId: string): Promise<CandidatePair[]> {
  return [];
}

/** STUB (M2): agrega los vectores e identificadores de un caso a los índices de comparación. */
export async function indexCase(_env: Env, _caseId: string): Promise<{ indexed: boolean; stub: boolean }> {
  return { indexed: false, stub: true };
}

export interface UpsertLinkInput {
  case_x: string;
  case_y: string;
  signals: Signals;
  score_raw: number;
  /** Puntaje final (después del Vinculador). Por defecto, score_raw. */
  score?: number;
  vinculador?: VinculadorOutput | null;
  vinculador_valid?: boolean | null;
  calibration: Calibration;
}

/**
 * Crea o actualiza el vínculo entre dos casos (siempre case_a < case_b). Si una persona ya
 * decidió (confirmado o descartado), no cambia el estado: solo actualiza señales y puntaje.
 */
export async function upsertLink(env: Env, input: UpsertLinkInput): Promise<{ id: string; num: number; status: string } | null> {
  if (input.case_x === input.case_y) return null;
  const [a, b] = input.case_x < input.case_y ? [input.case_x, input.case_y] : [input.case_y, input.case_x];
  const indexed = await env.DB.prepare("SELECT COUNT(*) AS n FROM cases WHERE id IN (?, ?) AND indexed = 1")
    .bind(a, b)
    .first<{ n: number }>();
  if ((indexed?.n ?? 0) < 2) {
    log("warn", "link_rejected_not_indexed", { case_a: a, case_b: b });
    return null;
  }
  const score = input.score ?? input.score_raw;
  const autoStatus = statusForScore(score, input.calibration);
  const now = nowIso();
  const existing = await env.DB.prepare("SELECT id, num, status FROM links WHERE case_a = ? AND case_b = ?")
    .bind(a, b)
    .first<{ id: string; num: number; status: string }>();
  const vinculadorJson = input.vinculador ? JSON.stringify(input.vinculador) : null;
  const valid = input.vinculador_valid == null ? null : input.vinculador_valid ? 1 : 0;
  if (existing) {
    const humanDecided = existing.status === "confirmado" || existing.status === "descartado";
    const status = humanDecided ? existing.status : autoStatus;
    await env.DB.prepare(
      `UPDATE links SET score = ?, score_raw = ?, signals_json = ?, vinculador_json = COALESCE(?, vinculador_json),
         vinculador_valid = COALESCE(?, vinculador_valid), calibration_version = ?, status = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(score, input.score_raw, JSON.stringify(input.signals), vinculadorJson, valid, input.calibration.version, status, now, existing.id)
      .run();
    return { id: existing.id, num: existing.num, status };
  }
  const id = newId();
  const num = await nextCounter(env, "link");
  await env.DB.prepare(
    `INSERT INTO links (id, num, case_a, case_b, score, score_raw, signals_json, vinculador_json, vinculador_valid,
       calibration_version, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, num, a, b, score, input.score_raw, JSON.stringify(input.signals), vinculadorJson, valid, input.calibration.version, autoStatus, now, now)
    .run();
  return { id, num, status: autoStatus };
}

export interface DeindexResult {
  removed_vectors: number;
  links_removed: number;
  ml_synced: boolean;
}

/**
 * Saca un caso de la comparación entre casos (retiro del consentimiento comunitario o borrado):
 * quita sus vectores de FAISS (mejor esfuerzo), marca el caso y sus identificadores como no
 * indexados, borra sus vínculos (cualquier estado) y recalcula las redes.
 */
export async function deindexCase(env: Env, caseId: string, opts: { recompute?: boolean } = {}): Promise<DeindexResult> {
  const { results: vecs } = await env.DB.prepare("SELECT faiss_id, index_name FROM embeddings WHERE case_id = ?")
    .bind(caseId)
    .all<{ faiss_id: number; index_name: MlIndexName }>();
  let mlSynced = vecs.length === 0;
  if (vecs.length) {
    const ml = tryGetMlClient(env);
    if (ml) {
      try {
        const byIndex = new Map<MlIndexName, number[]>();
        for (const v of vecs) byIndex.set(v.index_name, [...(byIndex.get(v.index_name) ?? []), v.faiss_id]);
        for (const [index, ids] of byIndex) await ml.indexRemove(index, ids);
        mlSynced = true;
      } catch (err) {
        log("warn", "deindex_ml_failed", { case_id: caseId, ...errorFields(err) });
      }
    }
  }
  const now = nowIso();
  const [, , del] = await env.DB.batch([
    env.DB.prepare("UPDATE cases SET indexed = 0, updated_at = ? WHERE id = ?").bind(now, caseId),
    env.DB.prepare("UPDATE case_identifiers SET indexed = 0 WHERE case_id = ?").bind(caseId),
    env.DB.prepare("DELETE FROM links WHERE case_a = ? OR case_b = ?").bind(caseId, caseId),
  ]);
  const linksRemoved = del?.meta.changes ?? 0;
  if (opts.recompute !== false) await recomputeNetworks(env);
  if (vecs.length && mlSynced) await persistIndexSnapshot(env);
  log("info", "case_deindexed", { case_id: caseId, vectors: vecs.length, links_removed: linksRemoved, ml_synced: mlSynced });
  return { removed_vectors: vecs.length, links_removed: linksRemoved, ml_synced: mlSynced };
}

/** Reconstruye los índices FAISS desde D1 con los vectores de casos indexados. */
export async function rebuildIndices(env: Env): Promise<Record<MlIndexName, number> | null> {
  const ml = tryGetMlClient(env);
  if (!ml) return null;
  const sizes = {} as Record<MlIndexName, number>;
  for (const index of ["voz", "voz_segmento", "texto", "imagen"] as const) {
    const { results } = await env.DB.prepare(
      `SELECT e.faiss_id, e.vector_b64 FROM embeddings e JOIN cases c ON c.id = e.case_id
       WHERE e.index_name = ? AND c.indexed = 1 ORDER BY e.faiss_id`,
    )
      .bind(index)
      .all<{ faiss_id: number; vector_b64: string }>();
    const vectors = results.map((r) => decodeVector(r.vector_b64));
    const res = await ml.indexRebuild(
      index,
      results.map((r) => r.faiss_id),
      vectors,
    );
    sizes[index] = res.size;
  }
  await persistIndexSnapshot(env);
  return sizes;
}

/** Guarda un snapshot de los índices en R2 `blindaje-indices` (mejor esfuerzo). */
export async function persistIndexSnapshot(env: Env): Promise<boolean> {
  const ml = tryGetMlClient(env);
  if (!ml) return false;
  try {
    const zip = await ml.indexSnapshot();
    await env.INDICES.put(INDEX_SNAPSHOT_KEY, zip, { customMetadata: { saved_at: nowIso() } });
    return true;
  } catch (err) {
    log("warn", "index_snapshot_failed", errorFields(err));
    return false;
  }
}

/** Float32 little-endian en base64 → number[]. */
export function decodeVector(b64: string): number[] {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return Array.from(new Float32Array(buf));
}

/** number[] → Float32 little-endian en base64. */
export function encodeVector(v: number[]): string {
  const u8 = new Uint8Array(new Float32Array(v).buffer);
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin);
}
