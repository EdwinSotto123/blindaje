import {
  districtById,
  imageLabel,
  statusForScore,
  voiceLabel,
  type CandidateSource,
  type VectorCaseSummary,
  type VectorCollection,
  type VectorIndexName,
  type VectorMap,
  type VectorOverview,
  type VectorQuery,
  type VectorStoreStatus,
  type VectorSyncResult,
  type VectorTrace,
} from "@blindaje/shared";
import type { Env } from "../env";
import { parseJsonColumn } from "../lib/db";
import { ApiError, notFound } from "../lib/errors";
import { errorFields, log } from "../lib/log";
import { tryGetMlClient } from "../ml/client";
import { findCandidates, loadCalibration, rebuildIndices, type VectorQueryTrace } from "../linking";
import { getChromaClient } from "./chroma";
import { decodeVector } from "./codec";
import { projectPca, vectorSample } from "./projection";
import { CHROMA_SYNC_KV_KEY, chromaSoloDemo, collectionName, syncChroma, VECTOR_INDEX_NAMES } from "./store";

/**
 * Lo que ve la administración en "Motor vectorial" (GET /v1/console/vectores y
 * POST /v1/console/vectores/consulta). Lee los vectores de D1 y consulta la misma base vectorial
 * que usa el motor de vinculación; no crea vínculos ni cambia nada.
 */

/** Modelo y dimensión por índice cuando D1 todavía no tiene vectores de ese índice. */
const DEFAULT_MODELS: Record<VectorIndexName, { modelo: string; dim: number }> = {
  voz: { modelo: "speechbrain/spkrec-ecapa-voxceleb", dim: 192 },
  voz_segmento: { modelo: "speechbrain/spkrec-ecapa-voxceleb", dim: 192 },
  texto: { modelo: "intfloat/multilingual-e5-small", dim: 384 },
  imagen: { modelo: "facebook/dinov2-small", dim: 384 },
};

/** Tope de puntos por mapa: la proyección corre en el Worker. */
const MAX_POINTS = 400;
const MAX_CASES = 60;

function mmss(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Etiquetas legibles de vectores ("V-1 · 0:04–0:07", "IMG-2 · bala", "Ficha") a partir de D1. */
interface RefInfo {
  case_id: string;
  caso: string;
  index: VectorIndexName;
  ref: string;
  evidencia: string | null;
}

async function resolveRefs(env: Env, faissIds: number[]): Promise<Map<number, RefInfo>> {
  const out = new Map<number, RefInfo>();
  const ids = [...new Set(faissIds)];
  const rows: Array<{ faiss_id: number; index_name: VectorIndexName; case_id: string; ref_type: string; ref_id: string; code: string }> = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT e.faiss_id, e.index_name, e.case_id, e.ref_type, e.ref_id, c.code FROM embeddings e JOIN cases c ON c.id = e.case_id
       WHERE c.indexed = 1 AND e.faiss_id IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(...chunk)
      .all<(typeof rows)[number]>();
    rows.push(...results);
  }
  const caseIds = [...new Set(rows.map((r) => r.case_id))];
  const prints = new Map<string, { num: number; evidence_id: string | null; segments: Array<{ start_ms: number; end_ms: number; faiss_id: number }> }>();
  const crops = new Map<string, { num: number; concept: string; evidence_id: string }>();
  const evidence = new Map<string, string>();
  for (let i = 0; i < caseIds.length; i += 90) {
    const chunk = caseIds.slice(i, i + 90);
    const marks = chunk.map(() => "?").join(",");
    const [p, cr, ev] = await env.DB.batch([
      env.DB.prepare(`SELECT id, num, evidence_id, segments_json FROM voice_prints WHERE case_id IN (${marks})`).bind(...chunk),
      env.DB.prepare(`SELECT id, num, concept, evidence_id FROM image_crops WHERE case_id IN (${marks})`).bind(...chunk),
      env.DB.prepare(`SELECT id, label FROM evidence WHERE case_id IN (${marks})`).bind(...chunk),
    ]);
    for (const r of p!.results as Array<{ id: string; num: number; evidence_id: string | null; segments_json: string | null }>) {
      prints.set(r.id, { num: r.num, evidence_id: r.evidence_id, segments: parseJsonColumn(r.segments_json) ?? [] });
    }
    for (const r of cr!.results as Array<{ id: string; num: number; concept: string; evidence_id: string }>) crops.set(r.id, r);
    for (const r of ev!.results as Array<{ id: string; label: string }>) evidence.set(r.id, r.label);
  }
  for (const r of rows) {
    let ref = "Vector";
    let ev: string | null = null;
    if (r.ref_type === "ficha") ref = "Ficha";
    else if (r.ref_type === "voice_print") {
      const p = prints.get(r.ref_id);
      ref = p ? voiceLabel(p.num) : "Voz";
      ev = p?.evidence_id ? (evidence.get(p.evidence_id) ?? null) : null;
    } else if (r.ref_type === "voice_segment") {
      const p = prints.get(r.ref_id.split(":")[0]!);
      const seg = p?.segments.find((s) => s.faiss_id === r.faiss_id);
      ref = p ? `${voiceLabel(p.num)}${seg ? ` · ${mmss(seg.start_ms)}–${mmss(seg.end_ms)}` : ""}` : "Segmento de voz";
      ev = p?.evidence_id ? (evidence.get(p.evidence_id) ?? null) : null;
    } else if (r.ref_type === "image_crop") {
      const c = crops.get(r.ref_id);
      ref = c ? `${imageLabel(c.num)} · ${c.concept}` : "Recorte";
      ev = c ? (evidence.get(c.evidence_id) ?? null) : null;
    }
    out.set(r.faiss_id, { case_id: r.case_id, caso: r.code, index: r.index_name, ref, evidencia: ev });
  }
  return out;
}

async function storeStatus(env: Env): Promise<VectorStoreStatus> {
  const soloDemo = chromaSoloDemo(env);
  const chroma = getChromaClient(env);
  if (chroma) {
    let latencia: number | null = null;
    try {
      latencia = await chroma.heartbeat();
    } catch (err) {
      log("warn", "chroma_heartbeat_failed", errorFields(err));
    }
    return {
      proveedor: "chroma-cloud",
      base: chroma.cfg.database,
      conectado: latencia !== null,
      latencia_ms: latencia,
      sincronizado_en: await env.CONFIG.get(CHROMA_SYNC_KV_KEY),
      solo_demo: soloDemo,
    };
  }
  const ml = tryGetMlClient(env);
  if (ml) {
    const t = Date.now();
    try {
      await ml.health();
      return { proveedor: "faiss", base: null, conectado: true, latencia_ms: Date.now() - t, sincronizado_en: null, solo_demo: false };
    } catch {
      return { proveedor: "faiss", base: null, conectado: false, latencia_ms: null, sincronizado_en: null, solo_demo: false };
    }
  }
  return { proveedor: "ninguno", base: null, conectado: false, latencia_ms: null, sincronizado_en: null, solo_demo: soloDemo };
}

async function collections(env: Env, statusP: Promise<VectorStoreStatus>): Promise<VectorCollection[]> {
  const chroma = getChromaClient(env);
  const demoOnly = Boolean(chroma) && chromaSoloDemo(env);
  const { results } = await env.DB.prepare(
    `SELECT e.index_name AS idx, e.model, e.dim, COUNT(*) AS n FROM embeddings e JOIN cases c ON c.id = e.case_id
     WHERE c.indexed = 1 ${demoOnly ? "AND c.is_demo = 1" : ""} GROUP BY e.index_name, e.model, e.dim ORDER BY n DESC`,
  ).all<{ idx: VectorIndexName; model: string; dim: number; n: number }>();
  // Sin Chroma, el estado (salud del contenedor ML) decide si se pueden leer los tamaños de FAISS.
  const status = chroma ? null : await statusP;
  let faissSizes: Partial<Record<VectorIndexName, number>> | null = null;
  if (status?.proveedor === "faiss" && status.conectado) {
    try {
      faissSizes = (await tryGetMlClient(env)!.health()).indices;
    } catch {
      faissSizes = null;
    }
  }
  const collection = async (indice: VectorIndexName): Promise<VectorCollection> => {
    const rows = results.filter((r) => r.idx === indice);
    const top = rows[0];
    let enBase: number | null = null;
    if (chroma) {
      try {
        const id = await chroma.collectionId(collectionName(indice));
        enBase = id ? await chroma.count(id) : 0;
      } catch (err) {
        log("warn", "chroma_count_failed", { index: indice, ...errorFields(err) });
      }
    } else if (faissSizes) enBase = faissSizes[indice] ?? 0;
    return {
      indice,
      coleccion: chroma ? collectionName(indice) : null,
      dim: top?.dim ?? DEFAULT_MODELS[indice].dim,
      modelo: top?.model ?? DEFAULT_MODELS[indice].modelo,
      en_d1: rows.reduce((s, r) => s + r.n, 0),
      en_base: enBase,
    };
  };
  return Promise.all(VECTOR_INDEX_NAMES.map(collection));
}

async function caseSummaries(env: Env): Promise<VectorCaseSummary[]> {
  const { results: cases } = await env.DB.prepare(
    `SELECT id, code, zona_cuadricula FROM cases WHERE indexed = 1 AND EXISTS (SELECT 1 FROM embeddings e WHERE e.case_id = cases.id)
     ORDER BY length(code), code LIMIT ?`,
  )
    .bind(MAX_CASES)
    .all<{ id: string; code: string; zona_cuadricula: string | null }>();
  if (!cases.length) return [];
  const marks = cases.map(() => "?").join(",");
  const ids = cases.map((c) => c.id);
  const [ev, emb, idf] = await env.DB.batch([
    env.DB.prepare(`SELECT case_id, label, tipo FROM evidence WHERE case_id IN (${marks}) ORDER BY seq`).bind(...ids),
    env.DB.prepare(`SELECT case_id, index_name, COUNT(*) AS n FROM embeddings WHERE case_id IN (${marks}) GROUP BY case_id, index_name`).bind(...ids),
    env.DB.prepare(`SELECT case_id, COUNT(*) AS n FROM case_identifiers WHERE case_id IN (${marks}) GROUP BY case_id`).bind(...ids),
  ]);
  const evRows = ev!.results as Array<{ case_id: string; label: string; tipo: VectorCaseSummary["evidencia"][number]["tipo"] }>;
  const embRows = emb!.results as Array<{ case_id: string; index_name: VectorIndexName; n: number }>;
  const idfRows = idf!.results as Array<{ case_id: string; n: number }>;
  return cases.map((c) => ({
    case_id: c.id,
    caso: c.code,
    distrito: districtById(c.zona_cuadricula)?.name ?? null,
    evidencia: evRows.filter((e) => e.case_id === c.id).map((e) => ({ label: e.label, tipo: e.tipo })),
    vectores: Object.fromEntries(VECTOR_INDEX_NAMES.map((i) => [i, embRows.find((r) => r.case_id === c.id && r.index_name === i)?.n ?? 0])) as Record<
      VectorIndexName,
      number
    >,
    identificadores: idfRows.find((r) => r.case_id === c.id)?.n ?? 0,
  }));
}

async function maps(env: Env): Promise<VectorMap[]> {
  return Promise.all(VECTOR_INDEX_NAMES.map((indice) => indexMap(env, indice)));
}

async function indexMap(env: Env, indice: VectorIndexName): Promise<VectorMap> {
  const { results } = await env.DB.prepare(
    `SELECT e.faiss_id, e.vector_b64 FROM embeddings e JOIN cases c ON c.id = e.case_id
     WHERE e.index_name = ? AND c.indexed = 1 ORDER BY e.faiss_id LIMIT ?`,
  )
    .bind(indice, MAX_POINTS)
    .all<{ faiss_id: number; vector_b64: string }>();
  const vectors = results.map((r) => decodeVector(r.vector_b64));
  const proj = projectPca(vectors);
  const refs = await resolveRefs(
    env,
    results.map((r) => r.faiss_id),
  );
  return {
    indice,
    varianza: proj.variance,
    puntos: results.flatMap((r, i) => {
      const info = refs.get(r.faiss_id);
      if (!info) return [];
      const [x, y] = proj.coords[i]!;
      return [{ id: r.faiss_id, case_id: info.case_id, caso: info.caso, ref: info.ref, evidencia: info.evidencia, x, y, muestra: vectorSample(vectors[i]!) }];
    }),
  };
}

export async function vectorOverview(env: Env): Promise<VectorOverview> {
  // El latido de la base va en paralelo con lo demás: los conteos ya dicen si la base respondió.
  const status = storeStatus(env);
  const [almacen, colecciones, casos, mapas] = await Promise.all([status, collections(env, status), caseSummaries(env), maps(env)]);
  return { almacen, colecciones, casos, mapas };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Corre la búsqueda de candidatos de un caso indexado tal como la hace el motor de vinculación y
 * devuelve cada consulta a la base vectorial (con su latencia real), los vecinos y las señales
 * calibradas. Solo lee: no crea ni cambia vínculos.
 */
export async function vectorTrace(env: Env, caseId: string): Promise<VectorTrace> {
  const started = Date.now();
  const [me, cal] = await Promise.all([
    env.DB.prepare("SELECT id, code, indexed FROM cases WHERE id = ?").bind(caseId).first<{ id: string; code: string; indexed: number }>(),
    loadCalibration(env),
  ]);
  if (!me) throw notFound("Caso");
  if (me.indexed !== 1) throw new ApiError("conflict", "El caso no está en los índices de comparación");
  const queries: VectorQueryTrace[] = [];
  const sources = new Map<string, Set<CandidateSource>>();
  let provider: VectorTrace["proveedor"] = "ninguno";
  const pairs = await findCandidates(env, caseId, cal, {
    provider: (p) => (provider = p),
    query: (q) => queries.push(q),
    source: (id, s) => sources.set(id, (sources.get(id) ?? new Set()).add(s)),
  });
  const refs = await resolveRefs(env, [...queries.map((q) => q.query_id), ...queries.flatMap((q) => q.hits.map((h) => h.id))]);
  const consultas: VectorQuery[] = queries.map((q) => ({
    indice: q.index,
    consulta: q.query_id,
    ref: refs.get(q.query_id)?.ref ?? "Vector",
    k: q.k,
    umbral: q.threshold,
    latencia_ms: q.ms,
    excluidos: q.excluded,
    vecinos: q.hits.flatMap((h) => {
      const info = refs.get(h.id);
      // Un id que ya no está en D1 (o cuyo caso salió de los índices) no se muestra: se filtra igual que en la vinculación.
      if (!info || info.case_id === caseId) return [];
      return [{ id: h.id, case_id: info.case_id, caso: info.caso, ref: info.ref, score: round4(h.score), pasa: q.threshold === null || h.score >= q.threshold }];
    }),
  }));
  const codes = new Map<string, string>();
  for (const info of refs.values()) codes.set(info.case_id, info.caso);
  const missing = pairs.map((p) => p.other_case_id).filter((id) => !codes.has(id));
  if (missing.length) {
    const { results } = await env.DB.prepare(`SELECT id, code FROM cases WHERE id IN (${missing.map(() => "?").join(",")})`)
      .bind(...missing)
      .all<{ id: string; code: string }>();
    for (const r of results) codes.set(r.id, r.code);
  }
  return {
    case_id: me.id,
    caso: me.code,
    proveedor: provider,
    consultas,
    candidatos: pairs.map((p) => ({
      case_id: p.other_case_id,
      caso: codes.get(p.other_case_id) ?? "?",
      fuentes: [...(sources.get(p.other_case_id) ?? [])],
      senales: {
        ...(p.signals.identificador ? { identificador: round4(p.signals.identificador.p) } : {}),
        ...(p.signals.voz ? { voz: round4(p.signals.voz.p) } : {}),
        ...(p.signals.imagen ? { imagen: round4(p.signals.imagen.p) } : {}),
        ...(p.signals.modus_operandi ? { modus_operandi: round4(p.signals.modus_operandi.p) } : {}),
      },
      puntaje: p.score_raw,
      estado: statusForScore(p.score_raw, cal),
    })),
    umbrales: { probable: cal.thresholds.probable, revisar: cal.thresholds.revisar },
    total_ms: Date.now() - started,
  };
}

/** Sincronización completa desde D1: Chroma si está configurado; si no, reconstruye FAISS. */
export async function vectorSync(env: Env): Promise<VectorSyncResult> {
  const t = Date.now();
  const chroma = await syncChroma(env);
  if (chroma) return { proveedor: "chroma-cloud", sincronizados: chroma.written, borrados: chroma.deleted, ms: Date.now() - t };
  const faiss = await rebuildIndices(env);
  if (faiss) return { proveedor: "faiss", sincronizados: faiss, borrados: 0, ms: Date.now() - t };
  throw new ApiError("conflict", "No hay base vectorial configurada");
}
