import type { Env } from "../env";
import { putEncrypted } from "../lib/crypto";
import { derivativeR2Key } from "../evidence";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { encodeVector } from "../linking";
import { tryGetMlClient, type MlIndexName } from "../ml/client";
import type { DerivativeType } from "./types";

/**
 * Escritura de resultados del pipeline. Patrón de todos los procesadores:
 *  1. Llamadas externas (ML, Meta) y objetos cifrados en R2 primero.
 *  2. Un solo `DB.batch` (transacción) que borra lo que hubiera de una corrida anterior de la
 *     misma evidencia e inserta lo nuevo. Así un reintento nunca deja filas duplicadas.
 *  3. Mejor esfuerzo: borrar de R2 y de FAISS lo que quedó de la corrida anterior.
 */

export interface PendingWrites {
  statements: D1PreparedStatement[];
  /** Objetos de R2 escritos en esta corrida (se borran si el batch falla). */
  r2Written: string[];
}

export function emptyWrites(): PendingWrites {
  return { statements: [], r2Written: [] };
}

/** Derivado binario cifrado en R2 (AAD = id del derivado) + su fila. */
export async function binaryDerivative(
  env: Env,
  w: PendingWrites,
  ev: { id: string; case_id: string },
  tipo: DerivativeType,
  bytes: ArrayBuffer | Uint8Array,
  content: unknown,
): Promise<string> {
  const id = newId();
  const key = derivativeR2Key(ev.case_id, id);
  await putEncrypted(env.EVIDENCE, key, env.EVIDENCE_ENCRYPTION_KEY, bytes, id, { derivative_id: id, tipo });
  w.r2Written.push(key);
  w.statements.push(
    env.DB.prepare("INSERT INTO derivatives (id, evidence_id, case_id, tipo, content_json, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      ev.id,
      ev.case_id,
      tipo,
      content == null ? null : JSON.stringify(content),
      key,
      nowIso(),
    ),
  );
  return id;
}

/** Derivado solo con JSON en D1. */
export function jsonDerivative(env: Env, w: PendingWrites, ev: { id: string; case_id: string }, tipo: DerivativeType, content: unknown): string {
  const id = newId();
  w.statements.push(
    env.DB.prepare("INSERT INTO derivatives (id, evidence_id, case_id, tipo, content_json, r2_key, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)").bind(
      id,
      ev.id,
      ev.case_id,
      tipo,
      JSON.stringify(content),
      nowIso(),
    ),
  );
  return id;
}

export function embeddingStatement(
  env: Env,
  e: { faiss_id: number; index_name: MlIndexName; case_id: string; ref_type: string; ref_id: string; vector: number[]; model: string },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO embeddings (faiss_id, index_name, case_id, ref_type, ref_id, dim, vector_b64, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(e.faiss_id, e.index_name, e.case_id, e.ref_type, e.ref_id, e.vector.length, encodeVector(e.vector), e.model, nowIso());
}

export interface PreviousOutputs {
  statements: D1PreparedStatement[];
  r2Keys: string[];
  faiss: Map<MlIndexName, number[]>;
}

/**
 * Prepara el borrado de lo que produjo una corrida anterior de esta evidencia: derivados (salvo
 * los tipos de `keep`), huellas de voz, recortes y sus vectores.
 */
export async function previousOutputs(env: Env, evidenceId: string, keep: DerivativeType[] = []): Promise<PreviousOutputs> {
  const [ders, prints, crops] = await env.DB.batch([
    env.DB.prepare("SELECT id, tipo, r2_key FROM derivatives WHERE evidence_id = ?").bind(evidenceId),
    env.DB.prepare("SELECT id FROM voice_prints WHERE evidence_id = ?").bind(evidenceId),
    env.DB.prepare("SELECT id, r2_key FROM image_crops WHERE evidence_id = ?").bind(evidenceId),
  ]);
  const derRows = (ders!.results as Array<{ id: string; tipo: DerivativeType; r2_key: string | null }>).filter((d) => !keep.includes(d.tipo));
  const printIds = (prints!.results as Array<{ id: string }>).map((p) => p.id);
  const cropRows = crops!.results as Array<{ id: string; r2_key: string | null }>;
  const refIds = [...printIds, ...cropRows.map((c) => c.id)];

  const faiss = new Map<MlIndexName, number[]>();
  const statements: D1PreparedStatement[] = [];
  if (refIds.length) {
    const ph = refIds.map(() => "?").join(",");
    const likes = printIds.map(() => "ref_id LIKE ?").join(" OR ");
    const where = `ref_id IN (${ph})${likes ? ` OR ${likes}` : ""}`;
    const binds = [...refIds, ...printIds.map((p) => `${p}:%`)];
    const { results } = await env.DB.prepare(`SELECT faiss_id, index_name FROM embeddings WHERE ${where}`)
      .bind(...binds)
      .all<{ faiss_id: number; index_name: MlIndexName }>();
    for (const r of results) faiss.set(r.index_name, [...(faiss.get(r.index_name) ?? []), r.faiss_id]);
    statements.push(env.DB.prepare(`DELETE FROM embeddings WHERE ${where}`).bind(...binds));
  }
  if (derRows.length) {
    statements.push(env.DB.prepare(`DELETE FROM derivatives WHERE id IN (${derRows.map(() => "?").join(",")})`).bind(...derRows.map((d) => d.id)));
  }
  statements.push(env.DB.prepare("DELETE FROM voice_prints WHERE evidence_id = ?").bind(evidenceId));
  statements.push(env.DB.prepare("DELETE FROM image_crops WHERE evidence_id = ?").bind(evidenceId));
  const r2Keys = [...derRows.map((d) => d.r2_key), ...cropRows.map((c) => c.r2_key)].filter((k): k is string => Boolean(k));
  return { statements, r2Keys, faiss };
}

/** Ejecuta borrado + inserciones en una transacción y limpia lo viejo (mejor esfuerzo). */
export async function commitWrites(env: Env, prev: PreviousOutputs, w: PendingWrites): Promise<void> {
  try {
    await env.DB.batch([...prev.statements, ...w.statements]);
  } catch (err) {
    if (w.r2Written.length) await env.EVIDENCE.delete(w.r2Written).catch(() => undefined);
    throw err;
  }
  if (prev.r2Keys.length) await env.EVIDENCE.delete(prev.r2Keys).catch(() => undefined);
  if (prev.faiss.size) {
    const ml = tryGetMlClient(env);
    if (ml) {
      try {
        for (const [index, ids] of prev.faiss) await ml.indexRemove(index, ids);
      } catch (err) {
        // Si FAISS queda con vectores viejos, el tamaño ya no coincide con D1 y se reconstruye.
        log("warn", "faiss_remove_previous_failed", errorFields(err));
      }
    }
  }
}
