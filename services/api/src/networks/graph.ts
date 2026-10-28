import {
  canShowTerritorialStats,
  fichaLabel,
  identifierLabel,
  imageLabel,
  linkLabel,
  networkLabel,
  voiceLabel,
  type FichaStored,
  type NetworkView,
  type ReviewStatus,
  type Signals,
  type VinculadorOutput,
} from "@blindaje/shared";
import type { Env } from "../env";
import { canonicalJson } from "../lib/canonical";
import { sha256Hex } from "../lib/crypto";
import { parseJsonColumn } from "../lib/db";
import { notFound } from "../lib/errors";
import { log } from "../lib/log";
import { tryGetMlClient, type GraphAnalyzeResponse } from "../ml/client";

/**
 * Grafo de una red (sección 10.3): nodos de cinco tipos (caso, huella de voz, identificador,
 * frase firma e imagen plantilla), aristas caso–señal y aristas caso–caso por cada vínculo
 * CONFIRMADO. Comunidades y centralidad las calcula el contenedor ML (/graph/analyze, Louvain e
 * intermediación con networkx); si no responde, el Worker calcula componentes conexos, grado e
 * intermediación exacta (Brandes), que para redes de decenas de nodos es instantáneo.
 *
 * Este módulo no devuelve datos de las víctimas: ni seudónimos, ni dispositivos, ni
 * identificadores en claro (solo ID-xxxxxx y los últimos 3 dígitos).
 */

export type GraphNode = NetworkView["nodes"][number];
export type GraphEdge = NetworkView["edges"][number];
export type TimelineItem = NetworkView["timeline"][number];

export interface NetCase {
  id: string;
  code: string;
  org_id: string;
  /** Solo para contar víctimas distintas. Nunca sale de este módulo hacia un agente. */
  device_id: string;
  is_demo: boolean;
  sector: string | null;
  zona: string | null;
  primer_contacto: string | null;
  created_at: string;
  ficha: FichaStored | null;
}

export interface NetLink {
  id: string;
  num: number;
  label: string;
  case_a: string;
  case_b: string;
  score: number;
  signals: Signals;
  vinculador: VinculadorOutput | null;
  vinculador_valid: boolean | null;
  reviewed_at: string | null;
}

export interface NetVoice {
  num: number;
  label: string;
  case_id: string;
  evidence_label: string | null;
  segmentos: number;
  duracion_seg: number;
}

export interface NetIdentifier {
  ref: string;
  tipo: string;
  rol: string;
  ultimos_3: string;
  case_id: string;
  evidencia: string[];
}

export interface NetCrop {
  num: number;
  label: string;
  case_id: string;
  concept: string;
  evidence_label: string | null;
}

export interface NetEvidence {
  id: string;
  case_id: string;
  label: string;
  tipo: string;
  sha256: string;
  received_utc: string;
  captured_at: string | null;
  duration_ms: number | null;
  /** Llama Prompt Guard 2: "inyeccion" si se revisó y quedó marcada (para avisar a los agentes). */
  pg_label?: string | null;
  pg_score?: number | null;
}

export interface NetworkData {
  id: string;
  num: number;
  label: string;
  n_casos: number;
  updated_at: string;
  profile_status: ReviewStatus | null;
  cases: NetCase[];
  links: NetLink[];
  voices: NetVoice[];
  identifiers: NetIdentifier[];
  crops: NetCrop[];
  evidence: NetEvidence[];
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

export async function loadNetworkData(env: Env, networkId: string): Promise<NetworkData> {
  const n = await env.DB.prepare(
    `SELECT n.id, n.num, n.n_casos, n.updated_at,
       (SELECT p.status FROM network_profiles p WHERE p.network_id = n.id ORDER BY p.created_at DESC LIMIT 1) AS profile_status
     FROM networks n WHERE n.id = ?`,
  )
    .bind(networkId)
    .first<{ id: string; num: number; n_casos: number; updated_at: string; profile_status: ReviewStatus | null }>();
  if (!n) throw notFound("Red");

  const { results: caseRows } = await env.DB.prepare(
    `SELECT c.id, c.code, c.org_id, c.device_id, c.is_demo, c.sector, c.zona_cuadricula, c.primer_contacto, c.created_at, c.ficha_json
     FROM network_cases nc JOIN cases c ON c.id = nc.case_id WHERE nc.network_id = ? ORDER BY c.code`,
  )
    .bind(networkId)
    .all<{
      id: string;
      code: string;
      org_id: string;
      device_id: string;
      is_demo: number;
      sector: string | null;
      zona_cuadricula: string | null;
      primer_contacto: string | null;
      created_at: string;
      ficha_json: string | null;
    }>();
  const cases: NetCase[] = caseRows.map((c) => {
    const ficha = parseJsonColumn<FichaStored>(c.ficha_json);
    return {
      id: c.id,
      code: c.code,
      org_id: c.org_id,
      device_id: c.device_id,
      is_demo: c.is_demo === 1,
      sector: c.sector ?? ficha?.sector ?? null,
      zona: c.zona_cuadricula ?? ficha?.zona ?? null,
      primer_contacto: ficha?.primer_contacto ?? c.primer_contacto ?? null,
      created_at: c.created_at,
      ficha,
    };
  });

  const ids = cases.map((c) => c.id);
  const ph = ids.map(() => "?").join(",") || "''";
  const [links, voices, idents, crops, evidence] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, num, case_a, case_b, score, signals_json, vinculador_json, vinculador_valid, reviewed_at FROM links
       WHERE status = 'confirmado' AND case_a IN (${ph}) AND case_b IN (${ph}) ORDER BY num`,
    ).bind(...ids, ...ids),
    env.DB.prepare(
      `SELECT v.num, v.case_id, v.segmentos, v.duracion_seg, e.label AS evidence_label FROM voice_prints v
       LEFT JOIN evidence e ON e.id = v.evidence_id WHERE v.case_id IN (${ph}) ORDER BY v.num`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT ci.case_id, ci.rol, ci.evidence_json, i.ref, i.hmac, i.tipo, i.ultimos_3 FROM case_identifiers ci
       JOIN identifiers i ON i.hmac = ci.hmac WHERE ci.case_id IN (${ph}) ORDER BY i.ref, ci.case_id`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT m.num, m.case_id, m.concept, e.label AS evidence_label FROM image_crops m
       LEFT JOIN evidence e ON e.id = m.evidence_id WHERE m.case_id IN (${ph}) ORDER BY m.num`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT e.id, e.case_id, e.label, e.tipo, e.sha256, e.received_utc, e.captured_at, e.duration_ms,
         (SELECT json_extract(d.content_json, '$.label') FROM derivatives d
            WHERE d.evidence_id = e.id AND d.tipo = 'prompt_guard' AND json_extract(d.content_json, '$.status') = 'revisado' LIMIT 1) AS pg_label,
         (SELECT json_extract(d.content_json, '$.score') FROM derivatives d WHERE d.evidence_id = e.id AND d.tipo = 'prompt_guard' LIMIT 1) AS pg_score
       FROM evidence e WHERE e.case_id IN (${ph}) ORDER BY e.case_id, e.seq`,
    ).bind(...ids),
  ]);

  return {
    id: n.id,
    num: n.num,
    label: networkLabel(n.num),
    n_casos: n.n_casos,
    updated_at: n.updated_at,
    profile_status: n.profile_status ?? null,
    cases,
    links: (
      links!.results as Array<{
        id: string;
        num: number;
        case_a: string;
        case_b: string;
        score: number;
        signals_json: string;
        vinculador_json: string | null;
        vinculador_valid: number | null;
        reviewed_at: string | null;
      }>
    ).map((l) => ({
      id: l.id,
      num: l.num,
      label: linkLabel(l.num),
      case_a: l.case_a,
      case_b: l.case_b,
      score: l.score,
      signals: parseJsonColumn<Signals>(l.signals_json) ?? {},
      vinculador: parseJsonColumn<VinculadorOutput>(l.vinculador_json),
      vinculador_valid: l.vinculador_valid == null ? null : l.vinculador_valid === 1,
      reviewed_at: l.reviewed_at,
    })),
    voices: (
      voices!.results as Array<{ num: number; case_id: string; segmentos: number; duracion_seg: number; evidence_label: string | null }>
    ).map((v) => ({ ...v, label: voiceLabel(v.num) })),
    identifiers: (
      idents!.results as Array<{ case_id: string; rol: string; evidence_json: string | null; ref: string | null; hmac: string; tipo: string; ultimos_3: string }>
    ).map((i) => ({
      ref: i.ref ?? identifierLabel(i.hmac),
      tipo: i.tipo,
      rol: i.rol,
      ultimos_3: i.ultimos_3,
      case_id: i.case_id,
      evidencia: (parseJsonColumn<unknown[]>(i.evidence_json) ?? []).filter((e): e is string => typeof e === "string"),
    })),
    crops: (crops!.results as Array<{ num: number; case_id: string; concept: string; evidence_label: string | null }>).map((m) => ({
      ...m,
      label: imageLabel(m.num),
    })),
    evidence: evidence!.results as unknown as NetEvidence[],
  };
}

export function caseCodeOf(data: NetworkData, caseId: string): string {
  return data.cases.find((c) => c.id === caseId)?.code ?? "?";
}

export function distinctVictims(cases: Array<Pick<NetCase, "device_id">>): number {
  return new Set(cases.map((c) => c.device_id)).size;
}

// ---------------------------------------------------------------------------
// Grafo
// ---------------------------------------------------------------------------

/** Normaliza una frase firma para comparar: minúsculas, sin tildes ni puntuación. */
export function normalizePhrase(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function phraseNodeId(phrase: string): Promise<string> {
  return `frase:${(await sha256Hex(normalizePhrase(phrase))).slice(0, 12)}`;
}

export const caseNodeId = (caseId: string) => `caso:${caseId}`;

/** Etiquetas EV-… de donde sale una señal (para que la consola pueda citarlas). */
function evidenceOf(rows: Array<{ evidence_label: string | null }>): string[] {
  return [...new Set(rows.map((r) => r.evidence_label).filter((l): l is string => Boolean(l)))].sort();
}

export interface NetworkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function buildGraph(data: NetworkData): Promise<NetworkGraph> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const seenEdge = new Set<string>();
  const addNode = (node: GraphNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge: GraphEdge) => {
    if (seenEdge.has(edge.id)) return;
    seenEdge.add(edge.id);
    edges.push(edge);
  };

  for (const c of data.cases) {
    addNode({ id: caseNodeId(c.id), type: "caso", label: `Caso ${c.code}`, data: { case_id: c.id, code: c.code, sector: c.sector, zona: c.zona, ficha: fichaLabel(c.code) } });
  }
  for (const v of data.voices) {
    const id = `voz:${v.num}`;
    addNode({ id, type: "voz", label: v.label, data: { evidencia: evidenceOf(data.voices.filter((x) => x.num === v.num)) } });
    addEdge({ id: `e:${v.case_id}:${id}`, source: caseNodeId(v.case_id), target: id, type: "senal", label: "voz", weight: 1 });
  }
  for (const i of data.identifiers) {
    const id = `id:${i.ref}`;
    addNode({ id, type: "identificador", label: i.ref, data: { tipo: i.tipo, ultimos_3: i.ultimos_3 } });
    addEdge({ id: `e:${i.case_id}:${id}:${i.rol}`, source: caseNodeId(i.case_id), target: id, type: "senal", label: i.rol, weight: 1 });
  }
  for (const m of data.crops) {
    const id = `img:${m.num}`;
    addNode({ id, type: "imagen", label: m.label, data: { concept: m.concept, evidencia: evidenceOf(data.crops.filter((x) => x.num === m.num)) } });
    addEdge({ id: `e:${m.case_id}:${id}`, source: caseNodeId(m.case_id), target: id, type: "senal", label: m.concept, weight: 1 });
  }
  for (const c of data.cases) {
    for (const frase of c.ficha?.frases_firma ?? []) {
      if (!normalizePhrase(frase)) continue;
      const id = await phraseNodeId(frase);
      addNode({ id, type: "frase", label: frase.trim() });
      addEdge({ id: `e:${c.id}:${id}`, source: caseNodeId(c.id), target: id, type: "senal", label: "frase", weight: 1 });
    }
  }
  for (const l of data.links) {
    addEdge({ id: `vin:${l.num}`, source: caseNodeId(l.case_a), target: caseNodeId(l.case_b), type: "vinculo", label: l.label, weight: l.score });
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Análisis: ML (/graph/analyze) con alternativa en el Worker
// ---------------------------------------------------------------------------

export interface GraphAnalysis {
  communities: string[][];
  centrality: Record<string, number>;
  degree: Record<string, number>;
  membership: Record<string, number>;
  source: "ml" | "worker";
}

function adjacency(graph: NetworkGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of graph.nodes) adj.set(n.id, new Set());
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  return adj;
}

/** Intermediación de Brandes (grafo no dirigido, sin pesos), normalizada como networkx. */
export function betweenness(adj: Map<string, Set<string>>): Record<string, number> {
  const nodes = [...adj.keys()].sort();
  const cb: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, 0]));
  for (const s of nodes) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>(nodes.map((n) => [n, []]));
    const sigma = new Map<string, number>(nodes.map((n) => [n, 0]));
    const dist = new Map<string, number>(nodes.map((n) => [n, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi]!;
      stack.push(v);
      for (const w of adj.get(v) ?? []) {
        if (dist.get(w)! < 0) {
          queue.push(w);
          dist.set(w, dist.get(v)! + 1);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }
    const delta = new Map<string, number>(nodes.map((n) => [n, 0]));
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      if (w !== s) cb[w]! += delta.get(w)!;
    }
  }
  const n = nodes.length;
  // No dirigido: cada camino se contó dos veces; normalización 2 / ((n-1)(n-2)).
  const scale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 0;
  for (const k of nodes) cb[k] = Math.round(cb[k]! * scale * 1e6) / 1e6;
  return cb;
}

/** Alternativa sin ML: componentes conexos sobre la proyección en casos, grado e intermediación. */
export function analyzeInWorker(graph: NetworkGraph): GraphAnalysis {
  const adj = adjacency(graph);
  const degree: Record<string, number> = {};
  for (const [k, v] of adj) degree[k] = v.size;
  const caseIds = graph.nodes.filter((n) => n.type === "caso").map((n) => n.id);
  const caseSet = new Set(caseIds);
  // Proyección: dos casos se unen si tienen arista directa o comparten una señal.
  const parent = new Map<string, string>(caseIds.map((c) => [c, c]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (const [node, nbrs] of adj) {
    const caseNbrs = [...nbrs].filter((n) => caseSet.has(n));
    if (caseSet.has(node)) for (const m of caseNbrs) union(node, m);
    else for (let i = 1; i < caseNbrs.length; i++) union(caseNbrs[0]!, caseNbrs[i]!);
  }
  const groups = new Map<string, string[]>();
  for (const c of caseIds) groups.set(find(c), [...(groups.get(find(c)) ?? []), c]);
  const communities = [...groups.values()].map((g) => g.sort()).sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1));
  const membership: Record<string, number> = {};
  communities.forEach((c, i) => c.forEach((n) => (membership[n] = i)));
  for (const [node, nbrs] of adj) {
    if (node in membership) continue;
    const votes = new Map<number, number>();
    for (const m of nbrs) if (m in membership) votes.set(membership[m]!, (votes.get(membership[m]!) ?? 0) + 1);
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (best) membership[node] = best[0];
  }
  return { communities, centrality: betweenness(adj), degree, membership, source: "worker" };
}

const GRAPH_CACHE_TTL = 86_400;

/**
 * Comunidades y centralidad. Primero la caché en KV (por hash del grafo), después el contenedor
 * ML con un tiempo máximo corto y, si no responde, el cálculo en el Worker.
 */
export async function analyzeGraph(env: Env, graph: NetworkGraph, opts: { timeoutMs?: number } = {}): Promise<GraphAnalysis> {
  if (!graph.nodes.length) return { communities: [], centrality: {}, degree: {}, membership: {}, source: "worker" };
  const req = {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type })),
    edges: graph.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight ?? 1 })),
  };
  const key = `graph:v1:${await sha256Hex(canonicalJson(req))}`;
  try {
    const cached = await env.CONFIG.get<GraphAnalysis>(key, "json");
    if (cached) return cached;
  } catch {
    // KV no disponible: seguimos sin caché.
  }
  const ml = tryGetMlClient(env);
  if (ml) {
    try {
      const res = await ml.raw("/graph/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      });
      const body = (await res.json()) as GraphAnalyzeResponse & { membership?: Record<string, number> };
      if (Array.isArray(body.communities) && body.centrality && body.degree) {
        const membership = body.membership ?? Object.fromEntries(body.communities.flatMap((c, i) => c.map((n) => [n, i] as const)));
        const analysis: GraphAnalysis = { communities: body.communities, centrality: body.centrality, degree: body.degree, membership, source: "ml" };
        try {
          await env.CONFIG.put(key, JSON.stringify(analysis), { expirationTtl: GRAPH_CACHE_TTL });
        } catch {
          // sin caché
        }
        return analysis;
      }
      log("warn", "graph_analyze_bad_response", {});
    } catch (err) {
      log("warn", "graph_analyze_fallback", { error_name: (err as Error).name });
    }
  }
  return analyzeInWorker(graph);
}

/** Copia los resultados del análisis en `data` de cada nodo (para la consola). */
export function annotateNodes(graph: NetworkGraph, analysis: GraphAnalysis): GraphNode[] {
  return graph.nodes.map((n) => ({
    ...n,
    data: {
      ...(n.data ?? {}),
      degree: analysis.degree[n.id] ?? 0,
      centrality: analysis.centrality[n.id] ?? 0,
      community: analysis.membership[n.id] ?? null,
      analysis: analysis.source,
    },
  }));
}

// ---------------------------------------------------------------------------
// Línea de tiempo y escalamiento
// ---------------------------------------------------------------------------

export function timeOf(fecha: string): number {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha}T12:00:00-05:00` : fecha);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Fecha en hora de Lima (YYYY-MM-DD HH:mm) para los eventos calculados. */
function limaIso(ms: number): string {
  const d = new Date(ms - 5 * 3600_000);
  return `${d.toISOString().slice(0, 16)}:00-05:00`;
}

export function buildTimeline(data: NetworkData): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const c of data.cases) {
    const f = c.ficha;
    const ficha = fichaLabel(c.code);
    if (c.primer_contacto) items.push({ fecha: c.primer_contacto, texto: "Primer contacto", evidencia: f ? [ficha] : [], caso: c.code });
    if (c.primer_contacto && f?.plazo_horas) {
      const start = timeOf(c.primer_contacto);
      if (Number.isFinite(start)) {
        items.push({ fecha: limaIso(start + f.plazo_horas * 3600_000), texto: `Vence el plazo de ${f.plazo_horas} horas (calculado desde el primer contacto)`, evidencia: [ficha], caso: c.code });
      }
    }
    for (const e of f?.escalamiento ?? []) {
      if (e.fecha) items.push({ fecha: e.fecha, texto: e.tipo, evidencia: e.evidencia.length ? e.evidencia : [ficha], caso: c.code });
    }
    for (const ev of data.evidence.filter((x) => x.case_id === c.id && x.captured_at)) {
      items.push({ fecha: ev.captured_at!, texto: `Evidencia de tipo ${ev.tipo}`, evidencia: [ev.label], caso: c.code });
    }
  }
  for (const l of data.links) {
    if (l.reviewed_at) {
      items.push({ fecha: l.reviewed_at, texto: `Vínculo ${l.label} confirmado por una persona revisora`, evidencia: [l.label], caso: `${caseCodeOf(data, l.case_a)}, ${caseCodeOf(data, l.case_b)}` });
    }
  }
  return items.sort((a, b) => timeOf(a.fecha) - timeOf(b.fecha) || a.caso.localeCompare(b.caso));
}

export interface EscalationAfterDeadline {
  caso: string;
  ficha: string;
  evento: string;
  dias_despues_del_plazo: number;
  evidencia: string[];
}

/** Días entre el plazo vencido y cada intimidación física posterior (patrón de escalamiento). */
export function escalationAfterDeadline(data: NetworkData): EscalationAfterDeadline[] {
  const out: EscalationAfterDeadline[] = [];
  for (const c of data.cases) {
    const f = c.ficha;
    if (!f?.plazo_horas || !c.primer_contacto) continue;
    const deadline = timeOf(c.primer_contacto) + f.plazo_horas * 3600_000;
    if (!Number.isFinite(deadline)) continue;
    for (const e of f.escalamiento) {
      if (!e.fecha) continue;
      const t = timeOf(e.fecha);
      if (!Number.isFinite(t) || t < deadline) continue;
      out.push({
        caso: c.code,
        ficha: fichaLabel(c.code),
        evento: e.tipo,
        dias_despues_del_plazo: Math.round(((t - deadline) / 86_400_000) * 10) / 10,
        evidencia: e.evidencia.length ? e.evidencia : [fichaLabel(c.code)],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Estadísticas territoriales (umbral de agregación, sección 12.2)
// ---------------------------------------------------------------------------

export type TerritorialLevel = "distrito" | "cuadricula";

export function zoneAt(zona: string | null, nivel: TerritorialLevel): string | null {
  if (!zona) return null;
  const z = zona.trim();
  if (!z) return null;
  return nivel === "distrito" ? z.split(/\s+-\s+/)[0]!.trim() : z;
}

export interface TerritorialStats {
  disponible: boolean;
  nivel: TerritorialLevel;
  zonas: Array<{ zona: string; casos: number }>;
}

export const OTHER_ZONES = "Otras zonas (agregado)";

/**
 * Conteos por zona. Vacío si la red tiene menos de 5 casos o menos de 3 víctimas distintas.
 * Además, cada zona listada cumple el mismo umbral; el resto se suma en "Otras zonas".
 */
export function territorialStats(cases: Array<Pick<NetCase, "device_id" | "zona">>, nivel: TerritorialLevel): TerritorialStats {
  if (!canShowTerritorialStats(cases.length, distinctVictims(cases))) return { disponible: false, nivel, zonas: [] };
  const byZone = new Map<string, Array<Pick<NetCase, "device_id">>>();
  let other = 0;
  for (const c of cases) {
    const z = zoneAt(c.zona, nivel);
    if (!z) {
      other++;
      continue;
    }
    byZone.set(z, [...(byZone.get(z) ?? []), c]);
  }
  const zonas: Array<{ zona: string; casos: number }> = [];
  for (const [zona, list] of [...byZone.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    if (canShowTerritorialStats(list.length, distinctVictims(list))) zonas.push({ zona, casos: list.length });
    else other += list.length;
  }
  if (other > 0) zonas.push({ zona: OTHER_ZONES, casos: other });
  return { disponible: true, nivel, zonas };
}

export function sectorCounts(cases: Array<Pick<NetCase, "sector">>): Array<{ sector: string; casos: number }> {
  const m = new Map<string, number>();
  for (const c of cases) m.set(c.sector ?? "sin_dato", (m.get(c.sector ?? "sin_dato") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([sector, casos]) => ({ sector, casos }));
}

export function activityPeriod(cases: Array<Pick<NetCase, "primer_contacto" | "created_at">>): string | null {
  const ds = cases.map((c) => (c.primer_contacto ?? c.created_at).slice(0, 10)).sort();
  if (!ds.length) return null;
  return ds[0] === ds[ds.length - 1] ? ds[0]! : `${ds[0]} a ${ds[ds.length - 1]}`;
}
