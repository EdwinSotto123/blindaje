import {
  Calibration,
  combineSignals,
  DEFAULT_CALIBRATION,
  imageLabel,
  signalProbabilities,
  statusForScore,
  voiceLabel,
  type CandidateSource,
  type FichaStored,
  type Signals,
  type VinculadorOutput,
} from "@blindaje/shared";
import type { Env } from "../env";
import { newId, nowIso } from "../lib/ids";
import { mapLimit } from "../lib/concurrency";
import { isUniqueViolation, nextCounter, parseJsonColumn } from "../lib/db";
import { errorFields, log } from "../lib/log";
import { tryGetMlClient, type MlClient, type MlIndexName } from "../ml/client";
import { recomputeNetworks } from "../networks";
import { decodeVector } from "../vectors/codec";
import { chromaRemove, chromaStoreFor, chromaUpsertCase, FaissStore, type VectorHit, type VectorStore, type VectorStoreProvider } from "../vectors/store";
import {
  commonPhrases,
  dot,
  hamming64,
  imageProbability,
  moProbability,
  sameGroup,
  segmentThreshold,
  syntheticVoiceAdjust,
  voiceProbability,
} from "./signals";

/**
 * Motor de vinculación (sección 9): indexación, búsqueda de candidatos en los cuatro índices,
 * señales calibradas, vínculos, desindexado, calibración y snapshots.
 *
 * Búsqueda: la base vectorial (Chroma Cloud para los casos ficticios del demo, FAISS en el contenedor
 * ML para el resto, ver `vectors/store.ts`) da los candidatos por voz (centroides y segmentos), texto
 * e imagen; D1 da los que comparten un identificador (join de HMAC) o un hash perceptual cercano. Las
 * señales se calculan después de forma exacta con los vectores de D1 (fuente de verdad).
 *
 * Invariantes que cualquier implementación debe respetar:
 * - Solo casos con `cases.indexed = 1` (consentimiento comunitario) participan en búsquedas y
 *   vínculos. Los resultados de la base vectorial se filtran SIEMPRE contra D1, porque un índice
 *   puede tener vectores viejos si el contenedor o Chroma no respondieron al desindexar.
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

// ---------------------------------------------------------------------------
// Vectores de un caso (desde D1)
// ---------------------------------------------------------------------------

interface SegmentVec {
  faiss_id: number;
  start_ms: number;
  end_ms: number;
  vector: number[];
}

interface PrintVec {
  id: string;
  label: string;
  evidence_id: string;
  evidence_label: string;
  faiss_id: number;
  centroid: number[];
  segments: SegmentVec[];
}

interface CropVec {
  id: string;
  label: string;
  evidence_label: string;
  concept: string;
  phash: string | null;
  faiss_id: number | null;
  vector: number[] | null;
}

interface CaseVectors {
  prints: PrintVec[];
  text: { faiss_id: number; vector: number[] } | null;
  crops: CropVec[];
  faissIds: Record<MlIndexName, number[]>;
  /** Etiquetas EV-… de audios con indicios fuertes de voz sintética o marca de IA (autenticidad). */
  syntheticAudio: Set<string>;
}

async function loadCaseVectors(env: Env, caseId: string): Promise<CaseVectors> {
  const [embRes, printRes, cropRes, evRes, authRes] = await env.DB.batch([
    env.DB.prepare("SELECT faiss_id, index_name, ref_type, ref_id, vector_b64 FROM embeddings WHERE case_id = ?").bind(caseId),
    env.DB.prepare("SELECT id, num, evidence_id, faiss_id, segments_json FROM voice_prints WHERE case_id = ? ORDER BY num").bind(caseId),
    env.DB.prepare("SELECT id, num, evidence_id, concept, phash, faiss_id FROM image_crops WHERE case_id = ? ORDER BY num").bind(caseId),
    env.DB.prepare("SELECT id, label FROM evidence WHERE case_id = ?").bind(caseId),
    env.DB.prepare(
      `SELECT e.label FROM derivatives d JOIN evidence e ON e.id = d.evidence_id
       WHERE d.case_id = ? AND d.tipo = 'autenticidad' AND e.tipo = 'audio'
         AND json_extract(d.content_json, '$.nivel') IN ('indicios_fuertes', 'generado_ia_confirmado')`,
    ).bind(caseId),
  ]);
  const syntheticAudio = new Set((authRes!.results as Array<{ label: string }>).map((r) => r.label));
  const emb = embRes!.results as Array<{ faiss_id: number; index_name: MlIndexName; ref_type: string; ref_id: string; vector_b64: string }>;
  const vec = new Map(emb.map((e) => [e.faiss_id, decodeVector(e.vector_b64)]));
  const evLabel = new Map((evRes!.results as Array<{ id: string; label: string }>).map((e) => [e.id, e.label]));
  const faissIds: Record<MlIndexName, number[]> = { voz: [], voz_segmento: [], texto: [], imagen: [] };
  for (const e of emb) faissIds[e.index_name].push(e.faiss_id);

  const prints: PrintVec[] = [];
  for (const p of printRes!.results as Array<{ id: string; num: number; evidence_id: string | null; faiss_id: number | null; segments_json: string | null }>) {
    const centroid = p.faiss_id != null ? vec.get(p.faiss_id) : undefined;
    if (!centroid || !p.evidence_id) continue;
    const segs = (parseJsonColumn<Array<{ start_ms: number; end_ms: number; faiss_id: number }>>(p.segments_json) ?? []).flatMap((s) => {
      const v = vec.get(s.faiss_id);
      return v ? [{ faiss_id: s.faiss_id, start_ms: s.start_ms, end_ms: s.end_ms, vector: v }] : [];
    });
    prints.push({
      id: p.id,
      label: voiceLabel(p.num),
      evidence_id: p.evidence_id,
      evidence_label: evLabel.get(p.evidence_id) ?? "",
      faiss_id: p.faiss_id!,
      centroid,
      segments: segs,
    });
  }
  const textRow = emb.find((e) => e.index_name === "texto" && e.ref_type === "ficha");
  const crops = (cropRes!.results as Array<{ id: string; num: number; evidence_id: string; concept: string; phash: string | null; faiss_id: number | null }>).map(
    (c) => ({
      id: c.id,
      label: imageLabel(c.num),
      evidence_label: evLabel.get(c.evidence_id) ?? "",
      concept: c.concept,
      phash: c.phash,
      faiss_id: c.faiss_id,
      vector: c.faiss_id != null ? (vec.get(c.faiss_id) ?? null) : null,
    }),
  );
  return { prints, text: textRow ? { faiss_id: textRow.faiss_id, vector: vec.get(textRow.faiss_id)! } : null, crops, faissIds, syntheticAudio };
}

// ---------------------------------------------------------------------------
// Índices FAISS
// ---------------------------------------------------------------------------

const INDEX_NAMES: MlIndexName[] = ["voz", "voz_segmento", "texto", "imagen"];

/**
 * Comprueba que FAISS tenga exactamente los vectores de los casos indexados en D1 (por tamaño de
 * cada índice). Si el contenedor se reinició o un desindexado no llegó, reconstruye desde D1.
 */
export async function ensureIndices(env: Env, ml: MlClient): Promise<{ cohort: number; rebuilt: boolean }> {
  const health = (await ml.health()) as Awaited<ReturnType<MlClient["health"]>> & { cohort?: { size?: number } };
  const { results } = await env.DB.prepare(
    `SELECT e.index_name AS idx, COUNT(*) AS n FROM embeddings e JOIN cases c ON c.id = e.case_id WHERE c.indexed = 1 GROUP BY e.index_name`,
  ).all<{ idx: MlIndexName; n: number }>();
  const expected = new Map(results.map((r) => [r.idx, r.n]));
  const stale = INDEX_NAMES.some((i) => (health.indices?.[i] ?? 0) !== (expected.get(i) ?? 0));
  if (stale) {
    log("info", "faiss_rebuild", { reason: "size_mismatch" });
    await rebuildIndices(env);
  }
  return { cohort: Number(health.cohort?.size ?? 0), rebuilt: stale };
}

/**
 * Agrega a los índices de comparación un caso con consentimiento comunitario: marca el caso y sus
 * identificadores como indexados y sube sus vectores a FAISS (upsert). Sin contenedor, FAISS se
 * pone al día en la próxima búsqueda (`ensureIndices`); D1 es la fuente de verdad.
 */
export async function indexCase(env: Env, caseId: string): Promise<{ indexed: boolean; stub: boolean }> {
  const c = await env.DB.prepare("SELECT consent_mode FROM cases WHERE id = ?").bind(caseId).first<{ consent_mode: string }>();
  if (!c || c.consent_mode !== "comunitario") return { indexed: false, stub: false };
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE cases SET indexed = 1, updated_at = ? WHERE id = ?").bind(now, caseId),
    env.DB.prepare("UPDATE case_identifiers SET indexed = 1 WHERE case_id = ?").bind(caseId),
  ]);
  const ml = tryGetMlClient(env);
  if (ml) {
    try {
      const { results } = await env.DB.prepare("SELECT faiss_id, index_name, vector_b64 FROM embeddings WHERE case_id = ?")
        .bind(caseId)
        .all<{ faiss_id: number; index_name: MlIndexName; vector_b64: string }>();
      for (const index of INDEX_NAMES) {
        const rows = results.filter((r) => r.index_name === index);
        if (rows.length) await ml.indexAdd(index, rows.map((r) => r.faiss_id), rows.map((r) => decodeVector(r.vector_b64)));
      }
      if (results.length) await persistIndexSnapshot(env);
    } catch (err) {
      log("warn", "index_case_faiss_failed", { case_id: caseId, ...errorFields(err) });
    }
  }
  await chromaUpsertCase(env, caseId);
  log("info", "case_indexed", { case_id: caseId });
  return { indexed: true, stub: false };
}

// ---------------------------------------------------------------------------
// Búsqueda de candidatos y señales
// ---------------------------------------------------------------------------

const K_VOICE = 10;
const K_SEGMENT = 20;
const K_TEXT = 10;
const K_IMAGE = 10;
const MAX_QUERY_SEGMENTS = 40;
const IMAGE_SEARCH_MIN = 0.5;
/** Consultas a la base vectorial y casos candidatos que se procesan a la vez. */
const SEARCH_CONCURRENCY = 6;
const SIGNALS_CONCURRENCY = 8;

interface CaseLite {
  id: string;
  code: string;
  device_id: string;
  indexed: number;
  is_demo: number;
  ficha_json: string | null;
}

async function idsToCases(env: Env, faissIds: number[]): Promise<string[]> {
  const out = new Set<string>();
  for (let i = 0; i < faissIds.length; i += 90) {
    const chunk = faissIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT DISTINCT case_id FROM embeddings WHERE faiss_id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ case_id: string }>();
    for (const r of results) out.add(r.case_id);
  }
  return [...out];
}

/** Una búsqueda en la base vectorial, para la vista del motor vectorial de la consola. */
export interface VectorQueryTrace {
  index: MlIndexName;
  /** Id del vector del caso usado como consulta. */
  query_id: number;
  k: number;
  /** Umbral desde el que un vecino cuenta como candidato; null si cuenta cualquiera de los k. */
  threshold: number | null;
  ms: number;
  excluded: number;
  hits: VectorHit[];
}

/** Observa `findCandidates` sin cambiar lo que hace (la consulta en vivo de la consola). */
export interface CandidateObserver {
  provider?(p: VectorStoreProvider | "ninguno"): void;
  query?(q: VectorQueryTrace): void;
  source?(caseId: string, source: CandidateSource): void;
}

type SearchQuery = { index: MlIndexName; vector: number[]; k: number };

/**
 * Las búsquedas de un caso, en el orden de `queries`. Si la base acepta lotes (Chroma), una llamada
 * por índice y k, todas en paralelo, y cada consulta lleva el tiempo de su lote; si no (FAISS), varias
 * consultas sueltas en vuelo a la vez.
 */
async function runSearches(store: VectorStore, queries: SearchQuery[], mine: CaseVectors): Promise<Array<{ ms: number; res: VectorHit[] }>> {
  const searchMany = store.searchMany?.bind(store);
  if (!searchMany) {
    return mapLimit(queries, SEARCH_CONCURRENCY, async (q) => {
      const t = Date.now();
      const res = await store.search(q.index, q.vector, q.k, mine.faissIds[q.index]);
      return { ms: Date.now() - t, res };
    });
  }
  const groups = new Map<string, number[]>();
  queries.forEach((q, i) => {
    const key = `${q.index}:${q.k}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out: Array<{ ms: number; res: VectorHit[] }> = new Array(queries.length);
  await Promise.all(
    [...groups.values()].map(async (idx) => {
      const { index, k } = queries[idx[0]!]!;
      const t = Date.now();
      const res = await searchMany(index, idx.map((i) => queries[i]!.vector), k, mine.faissIds[index]);
      const ms = Date.now() - t;
      idx.forEach((i, j) => (out[i] = { ms, res: res[j] ?? [] }));
    }),
  );
  return out;
}

async function vectorCandidates(
  env: Env,
  store: VectorStore,
  mine: CaseVectors,
  cal: Calibration,
  observer?: CandidateObserver,
): Promise<Map<string, Set<CandidateSource>>> {
  const segThr = segmentThreshold(cal);
  const queries: Array<{ index: MlIndexName; query_id: number; vector: number[]; k: number; threshold: number | null }> = [
    ...mine.prints.map((p) => ({ index: "voz" as const, query_id: p.faiss_id, vector: p.centroid, k: K_VOICE, threshold: null })),
    ...mine.prints
      .flatMap((p) => p.segments)
      .slice(0, MAX_QUERY_SEGMENTS)
      .map((sg) => ({ index: "voz_segmento" as const, query_id: sg.faiss_id, vector: sg.vector, k: K_SEGMENT, threshold: segThr })),
    ...(mine.text ? [{ index: "texto" as const, query_id: mine.text.faiss_id, vector: mine.text.vector, k: K_TEXT, threshold: null }] : []),
    ...mine.crops.flatMap((c) =>
      c.vector && c.faiss_id != null ? [{ index: "imagen" as const, query_id: c.faiss_id, vector: c.vector, k: K_IMAGE, threshold: IMAGE_SEARCH_MIN }] : [],
    ),
  ];
  const results = await runSearches(store, queries, mine);
  const hits = new Map<MlIndexName, Set<number>>();
  queries.forEach((q, i) => {
    const { ms, res } = results[i]!;
    observer?.query?.({ index: q.index, query_id: q.query_id, k: q.k, threshold: q.threshold, ms, excluded: mine.faissIds[q.index].length, hits: res });
    const set = hits.get(q.index) ?? new Set<number>();
    for (const h of res) if (q.threshold === null || h.score >= q.threshold) set.add(h.id);
    hits.set(q.index, set);
  });

  const out = new Map<string, Set<CandidateSource>>();
  const byIndex = await Promise.all([...hits].map(async ([index, ids]) => ({ index, cases: await idsToCases(env, [...ids]) })));
  for (const { index, cases } of byIndex) for (const caseId of cases) out.set(caseId, (out.get(caseId) ?? new Set<CandidateSource>()).add(index));
  return out;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

async function computeSignals(
  env: Env,
  me: CaseLite,
  mine: CaseVectors,
  other: CaseLite,
  theirs: CaseVectors,
  cal: Calibration,
  snorm: ((a: number[], b: number[]) => Promise<number | null>) | null,
): Promise<Signals> {
  const signals: Signals = {};

  // Identificador: HMAC idéntico (join en D1).
  const { results: shared } = await env.DB.prepare(
    `SELECT a.hmac, i.ref, i.tipo, i.ultimos_3, a.evidence_json AS ea, b.evidence_json AS eb
     FROM case_identifiers a JOIN case_identifiers b ON a.hmac = b.hmac JOIN identifiers i ON i.hmac = a.hmac
     WHERE a.case_id = ? AND b.case_id = ? AND a.indexed = 1 AND b.indexed = 1`,
  )
    .bind(me.id, other.id)
    .all<{ hmac: string; ref: string; tipo: string; ultimos_3: string; ea: string | null; eb: string | null }>();
  if (shared.length) {
    const byHmac = new Map<string, { ref: string; tipo: string; ultimos_3: string; evidencia: string[] }>();
    for (const r of shared) {
      const ev = [...(parseJsonColumn<string[]>(r.ea) ?? []), ...(parseJsonColumn<string[]>(r.eb) ?? [])];
      const cur = byHmac.get(r.hmac);
      byHmac.set(r.hmac, { ref: r.ref, tipo: r.tipo, ultimos_3: r.ultimos_3, evidencia: [...new Set([...(cur?.evidencia ?? []), ...ev])] });
    }
    signals.identificador = { p: cal.identificador.p, compartidos: [...byHmac.values()] };
  }

  // Voz: mejor par de huellas por coseno de centroides; segmentos que coinciden.
  let best: { p: PrintVec; q: PrintVec; cos: number } | null = null;
  for (const p of mine.prints) {
    for (const q of theirs.prints) {
      const cos = dot(p.centroid, q.centroid);
      if (!best || cos > best.cos) best = { p, q, cos };
    }
  }
  if (best) {
    const thr = segmentThreshold(cal);
    const b = best;
    const related = theirs.prints.filter((q) => q === b.q || dot(b.p.centroid, q.centroid) >= thr);
    const theirSegs = related.flatMap((q) => q.segments.map((s) => ({ q, s })));
    const pairs: Array<{ s: SegmentVec; q: PrintVec; t: SegmentVec; sim: number }> = [];
    for (const s of b.p.segments) {
      let top: { q: PrintVec; t: SegmentVec; sim: number } | null = null;
      for (const t of theirSegs) {
        const sim = dot(s.vector, t.s.vector);
        if (!top || sim > top.sim) top = { q: t.q, t: t.s, sim };
      }
      if (top && top.sim >= thr) pairs.push({ s, ...top });
    }
    let z: number | null = null;
    if (snorm) z = await snorm(b.p.centroid, b.q.centroid);
    pairs.sort((x, y) => y.sim - x.sim);
    const segmentos_coincidentes = pairs.slice(0, 3).flatMap((x) => [
      { huella: b.p.label, evidencia: b.p.evidence_label, evidence_id: b.p.evidence_id, start_ms: x.s.start_ms, end_ms: x.s.end_ms, similitud: round4(x.sim) },
      { huella: x.q.label, evidencia: x.q.evidence_label, evidence_id: x.q.evidence_id, start_ms: x.t.start_ms, end_ms: x.t.end_ms, similitud: round4(x.sim) },
    ]);
    const evidencia = [...new Set([b.p.evidence_label, ...related.map((q) => q.evidence_label)])];
    // Autenticidad: con indicios fuertes de voz sintética en algún audio comparado, p × 0.5.
    const adj = syntheticVoiceAdjust(voiceProbability(b.cos, pairs.length, cal), evidencia, new Set([...mine.syntheticAudio, ...theirs.syntheticAudio]));
    signals.voz = {
      p: adj.p,
      similitud: round4(b.cos),
      z: z === null ? null : round4(z),
      segmentos: pairs.length,
      segmentos_total: b.p.segments.length,
      huellas: [b.p.label, ...related.map((q) => q.label)],
      evidencia,
      segmentos_coincidentes,
      ...(adj.voz_sintetica ? { voz_sintetica: adj.voz_sintetica } : {}),
    };
  }

  // Modus operandi: texto + frases firma + canal + grupo (débil: nunca vincula solo).
  const fa = parseJsonColumn<FichaStored>(me.ficha_json);
  const fb = parseJsonColumn<FichaStored>(other.ficha_json);
  if (fa && fb) {
    const cos = mine.text && theirs.text ? dot(mine.text.vector, theirs.text.vector) : null;
    const frases = commonPhrases(fa.frases_firma ?? [], fb.frases_firma ?? []);
    const mismoCanal = Boolean(fa.canal_pago && fa.canal_pago === fb.canal_pago);
    const mismoGrupo = sameGroup(fa.grupo_que_dice_ser, fb.grupo_que_dice_ser);
    signals.modus_operandi = {
      p: moProbability({ similitud_texto: cos, frases_comunes: frases.length, mismo_canal_pago: mismoCanal, mismo_grupo: mismoGrupo }, cal),
      similitud_texto: round4(cos ?? 0),
      frases_comunes: frases,
      mismo_canal_pago: mismoCanal,
      mismo_grupo: mismoGrupo,
    };
  }

  // Imagen: hash perceptual primero, DINOv2 como refuerzo; solo recortes del mismo concepto.
  let hMin: { d: number; a: CropVec; b: CropVec } | null = null;
  let dMax: { d: number; a: CropVec; b: CropVec } | null = null;
  for (const a of mine.crops) {
    for (const b of theirs.crops) {
      if (a.concept !== b.concept) continue;
      if (a.phash && b.phash) {
        const h = hamming64(a.phash, b.phash);
        if (!hMin || h < hMin.d) hMin = { d: h, a, b };
      }
      if (a.vector && b.vector) {
        const d = dot(a.vector, b.vector);
        if (!dMax || d > dMax.d) dMax = { d, a, b };
      }
    }
  }
  if (hMin || dMax) {
    const p = imageProbability(hMin?.d ?? null, dMax?.d ?? null, cal);
    const decided = hMin && hMin.d <= cal.imagen.hamming_max ? hMin : (dMax ?? hMin)!;
    signals.imagen = {
      p,
      hamming_min: hMin?.d ?? null,
      dino_max: dMax ? round4(dMax.d) : null,
      recortes: [decided.a.label, decided.b.label],
      evidencia: [...new Set([decided.a.evidence_label, decided.b.evidence_label])],
    };
  }
  return signals;
}

/**
 * Candidatos de un caso indexado (sección 9.1) con sus señales calibradas (9.2) y el puntaje
 * combinado 1 − ∏(1 − pᵢ) (9.3). Filtro SIEMPRE contra D1: el otro caso debe estar indexado, no
 * ser del mismo dispositivo y seguir existiendo.
 */
export async function findCandidates(env: Env, caseId: string, calibration?: Calibration, observer?: CandidateObserver): Promise<CandidatePair[]> {
  const cal = calibration ?? (await loadCalibration(env));
  const me = await env.DB.prepare("SELECT id, code, device_id, indexed, is_demo, ficha_json FROM cases WHERE id = ?").bind(caseId).first<CaseLite>();
  if (!me || !me.indexed) return [];
  const mine = await loadCaseVectors(env, caseId);
  const candidates = new Set<string>();
  const add = (id: string, source: CandidateSource) => {
    candidates.add(id);
    observer?.source?.(id, source);
  };

  // Base vectorial: Chroma si está configurado y el caso puede estar en la nube; si no, FAISS.
  const ml = tryGetMlClient(env);
  const chroma = chromaStoreFor(env, me);
  observer?.provider?.(chroma ? "chroma-cloud" : ml ? "faiss" : "ninguno");
  let snorm: ((a: number[], b: number[]) => Promise<number | null>) | null = null;

  const vectorSearch = async (): Promise<Map<string, Set<CandidateSource>>> => {
    const found = new Map<string, Set<CandidateSource>>();
    const merge = (m: Map<string, Set<CandidateSource>>) => {
      for (const [id, sources] of m) for (const src of sources) found.set(id, (found.get(id) ?? new Set<CandidateSource>()).add(src));
    };
    if (chroma) {
      try {
        merge(await vectorCandidates(env, chroma, mine, cal, observer));
      } catch (err) {
        // Sin Chroma seguimos con identificadores y hash perceptual (D1).
        log("warn", "chroma_search_failed", { case_id: caseId, ...errorFields(err) });
      }
    }
    if (ml) {
      try {
        const { cohort } = await ensureIndices(env, ml);
        if (!chroma) merge(await vectorCandidates(env, new FaissStore(ml), mine, cal, observer));
        if (cohort > 0) {
          snorm = async (a, b) => {
            try {
              return (await ml.voiceCompare(a, b)).snorm;
            } catch {
              return null;
            }
          };
        }
      } catch (err) {
        // Sin FAISS seguimos con identificadores y hash perceptual (D1).
        log("warn", "faiss_search_failed", { case_id: caseId, ...errorFields(err) });
      }
    }
    return found;
  };

  const myHashes = mine.crops.map((c) => c.phash).filter((h): h is string => Boolean(h));
  const hashSearch = async (): Promise<string[]> => {
    if (!myHashes.length) return [];
    const { results } = await env.DB.prepare(
      `SELECT ic.case_id, ic.phash FROM image_crops ic JOIN cases c ON c.id = ic.case_id
       WHERE c.indexed = 1 AND ic.case_id != ? AND ic.phash IS NOT NULL LIMIT 5000`,
    )
      .bind(caseId)
      .all<{ case_id: string; phash: string }>();
    return results.filter((r) => myHashes.some((h) => hamming64(h, r.phash) <= cal.imagen.hamming_max)).map((r) => r.case_id);
  };

  const idSearch = env.DB.prepare(
    `SELECT DISTINCT b.case_id FROM case_identifiers a JOIN case_identifiers b ON a.hmac = b.hmac
     WHERE a.case_id = ? AND b.case_id != ? AND a.indexed = 1 AND b.indexed = 1`,
  )
    .bind(caseId, caseId)
    .all<{ case_id: string }>();

  // Las tres búsquedas son independientes: van en paralelo y se anotan en el orden de siempre.
  const [byVector, byHash, { results: idRows }] = await Promise.all([vectorSearch(), hashSearch(), idSearch]);
  for (const [id, sources] of byVector) for (const src of sources) add(id, src);
  for (const id of byHash) add(id, "hash_perceptual");
  for (const r of idRows) add(r.case_id, "identificador");
  candidates.delete(caseId);
  if (!candidates.size) return [];

  const ids = [...candidates].slice(0, 90);
  const { results: others } = await env.DB.prepare(
    `SELECT id, code, device_id, indexed, is_demo, ficha_json FROM cases WHERE id IN (${ids.map(() => "?").join(",")}) AND indexed = 1 AND device_id != ?`,
  )
    .bind(...ids, me.device_id)
    .all<CaseLite>();

  const pairs: CandidatePair[] = await mapLimit(others, SIGNALS_CONCURRENCY, async (other) => {
    const theirs = await loadCaseVectors(env, other.id);
    const signals = await computeSignals(env, me, mine, other, theirs, cal, snorm);
    const score_raw = combineSignals(signalProbabilities(signals));
    return { case_id: caseId, other_case_id: other.id, signals, score_raw: Math.round(score_raw * 10_000) / 10_000 };
  });
  pairs.sort((x, y) => y.score_raw - x.score_raw);
  log("info", "candidates_found", { case_id: caseId, candidates: pairs.length, top: pairs[0]?.score_raw ?? null });
  return pairs;
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
export async function upsertLink(env: Env, input: UpsertLinkInput, retried = false): Promise<{ id: string; num: number; status: string } | null> {
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
  try {
    await env.DB.prepare(
      `INSERT INTO links (id, num, case_a, case_b, score, score_raw, signals_json, vinculador_json, vinculador_valid,
         calibration_version, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, num, a, b, score, input.score_raw, JSON.stringify(input.signals), vinculadorJson, valid, input.calibration.version, autoStatus, now, now)
      .run();
  } catch (err) {
    // Otro consumidor creó el mismo par al mismo tiempo: se actualiza el existente.
    if (isUniqueViolation(err) && !retried) return upsertLink(env, input, true);
    throw err;
  }
  return { id, num, status: autoStatus };
}

export interface DeindexResult {
  removed_vectors: number;
  links_removed: number;
  ml_synced: boolean;
}

/**
 * Saca un caso de la comparación entre casos (retiro del consentimiento comunitario o borrado):
 * quita sus vectores de FAISS y de Chroma (mejor esfuerzo), marca el caso y sus identificadores como no
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
    await chromaRemove(env, vecs);
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

export { decodeVector, encodeVector } from "../vectors/codec";
