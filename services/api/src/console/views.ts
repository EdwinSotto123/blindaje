import {
  identifierLabel,
  imageLabel,
  linkLabel,
  networkLabel,
  voiceLabel,
  type AlertView,
  type AlertaBorrador,
  type CaseSide,
  type ExpedienteView,
  type FichaStored,
  type LinkView,
  type NetworkSummary,
  type NetworkView,
  type ProfileView,
  type Signals,
  type VinculadorOutput,
} from "@blindaje/shared";
import type { z } from "zod";
import type { Env } from "../env";
import { sha256Hex } from "../lib/crypto";
import { parseJsonColumn } from "../lib/db";
import { notFound } from "../lib/errors";
import type { TranscripcionContent } from "../pipeline/types";
import type { AuthContext } from "../types";

type GraphNode = NetworkView["nodes"][number];
type GraphEdge = NetworkView["edges"][number];
type TimelineItem = NetworkView["timeline"][number];

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

interface CaseLite {
  id: string;
  code: string;
  org_id: string;
  sector: string | null;
  zona_cuadricula: string | null;
  primer_contacto: string | null;
  ficha_json: string | null;
  consent_mode: string;
  created_at: string;
}

/**
 * Caso visible para la consola: solo con consentimiento comunitario ("solo mi denuncia" significa
 * que nada sale de su caso) y, para revisores, solo de su organización. Si no, 404.
 */
export async function getConsoleCase(env: Env, caseId: string, auth: AuthContext): Promise<CaseLite> {
  const c = await env.DB.prepare(
    "SELECT id, code, org_id, sector, zona_cuadricula, primer_contacto, ficha_json, consent_mode, created_at FROM cases WHERE id = ?",
  )
    .bind(caseId)
    .first<CaseLite>();
  if (!c || c.consent_mode !== "comunitario") throw notFound("Caso");
  if (auth.role === "reviewer" && c.org_id !== auth.org) throw notFound("Caso");
  return c;
}

export async function buildCaseSide(env: Env, caseId: string, preloaded?: CaseLite): Promise<CaseSide> {
  const c =
    preloaded ??
    (await env.DB.prepare("SELECT id, code, org_id, sector, zona_cuadricula, primer_contacto, ficha_json, consent_mode, created_at FROM cases WHERE id = ?")
      .bind(caseId)
      .first<CaseLite>());
  if (!c) throw notFound("Caso");
  const { results } = await env.DB.prepare(
    "SELECT id, label, tipo, sha256, received_utc, duration_ms FROM evidence WHERE case_id = ? ORDER BY seq",
  )
    .bind(caseId)
    .all<CaseSide["evidencia"][number]>();
  return {
    id: c.id,
    code: c.code,
    sector: c.sector,
    zona: c.zona_cuadricula,
    primer_contacto: c.primer_contacto,
    ficha: parseJsonColumn<FichaStored>(c.ficha_json),
    evidencia: results,
  };
}

export async function caseTranscripts(env: Env, caseId: string) {
  const { results } = await env.DB.prepare(
    `SELECT d.evidence_id, e.label, d.content_json FROM derivatives d JOIN evidence e ON e.id = d.evidence_id
     WHERE d.case_id = ? AND d.tipo = 'transcripcion' ORDER BY e.seq`,
  )
    .bind(caseId)
    .all<{ evidence_id: string; label: string; content_json: string | null }>();
  return results.map((r) => ({
    evidence_id: r.evidence_id,
    label: r.label,
    turns: parseJsonColumn<TranscripcionContent>(r.content_json)?.turns ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Vínculos
// ---------------------------------------------------------------------------

export interface LinkRow {
  id: string;
  num: number;
  case_a: string;
  case_b: string;
  score: number;
  score_raw: number;
  signals_json: string;
  vinculador_json: string | null;
  vinculador_valid: number | null;
  status: LinkView["status"];
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  reviewer_name?: string | null;
}

/** Filtro SQL de vínculos visibles: revisores solo ven vínculos entre casos de su organización. */
export function linkVisibilitySql(auth: AuthContext): { sql: string; binds: unknown[] } {
  if (auth.role === "reviewer") {
    return {
      sql: " AND l.case_a IN (SELECT id FROM cases WHERE org_id = ?) AND l.case_b IN (SELECT id FROM cases WHERE org_id = ?)",
      binds: [auth.org, auth.org],
    };
  }
  return { sql: "", binds: [] };
}

export async function getLinkRow(env: Env, linkId: string, auth: AuthContext): Promise<LinkRow> {
  const vis = linkVisibilitySql(auth);
  const row = await env.DB.prepare(
    `SELECT l.*, u.display_name AS reviewer_name FROM links l LEFT JOIN users u ON u.id = l.reviewer_id WHERE l.id = ?${vis.sql}`,
  )
    .bind(linkId, ...vis.binds)
    .first<LinkRow>();
  if (!row) throw notFound("Vínculo");
  return row;
}

interface VoicePrintRow {
  id: string;
  num: number;
  case_id: string;
  evidence_id: string | null;
  segments_json: string | null;
}

async function buildFragments(env: Env, row: LinkRow, signals: Signals): Promise<LinkView["fragments"]> {
  // El motor guarda los segmentos que coinciden (de ambos casos): esos son los fragmentos.
  const matched = signals.voz?.segmentos_coincidentes ?? [];
  if (matched.length) {
    const out: LinkView["fragments"] = [];
    for (const m of matched) {
      const tr = await env.DB.prepare("SELECT content_json FROM derivatives WHERE evidence_id = ? AND tipo = 'transcripcion' LIMIT 1")
        .bind(m.evidence_id)
        .first<{ content_json: string | null }>();
      const text = (parseJsonColumn<TranscripcionContent>(tr?.content_json)?.turns ?? [])
        .filter((t) => !t.es_victima && t.end_ms > m.start_ms && t.start_ms < m.end_ms)
        .map((t) => t.text)
        .join(" ")
        .trim();
      out.push({
        evidence_label: m.evidencia,
        evidence_id: m.evidence_id,
        voice_label: m.huella,
        start_ms: m.start_ms,
        end_ms: m.end_ms,
        text: text || null,
        media_url: `/v1/console/evidence/${m.evidence_id}/media?start_ms=${m.start_ms}&end_ms=${m.end_ms}`,
      });
    }
    return out;
  }
  const nums = (signals.voz?.huellas ?? [])
    .map((h) => /^V-(\d+)$/.exec(h)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);
  if (!nums.length) return [];
  const { results: prints } = await env.DB.prepare(
    `SELECT id, num, case_id, evidence_id, segments_json FROM voice_prints
     WHERE case_id IN (?, ?) AND num IN (${nums.map(() => "?").join(",")})`,
  )
    .bind(row.case_a, row.case_b, ...nums)
    .all<VoicePrintRow>();
  const fragments: LinkView["fragments"] = [];
  for (const p of prints) {
    if (!p.evidence_id) continue;
    const ev = await env.DB.prepare("SELECT label FROM evidence WHERE id = ?").bind(p.evidence_id).first<{ label: string }>();
    const tr = await env.DB.prepare("SELECT content_json FROM derivatives WHERE evidence_id = ? AND tipo = 'transcripcion' LIMIT 1")
      .bind(p.evidence_id)
      .first<{ content_json: string | null }>();
    const turns = parseJsonColumn<TranscripcionContent>(tr?.content_json)?.turns ?? [];
    const segs = (parseJsonColumn<Array<{ start_ms: number; end_ms: number }>>(p.segments_json) ?? []).slice(0, 2);
    for (const s of segs) {
      const text = turns
        .filter((t) => t.end_ms > s.start_ms && t.start_ms < s.end_ms)
        .map((t) => t.text)
        .join(" ")
        .trim();
      fragments.push({
        evidence_label: ev?.label ?? "",
        evidence_id: p.evidence_id,
        voice_label: voiceLabel(p.num),
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        text: text || null,
        media_url: `/v1/console/evidence/${p.evidence_id}/media?start_ms=${s.start_ms}&end_ms=${s.end_ms}`,
      });
    }
  }
  return fragments;
}

export async function buildLinkView(env: Env, row: LinkRow): Promise<LinkView> {
  const signals = parseJsonColumn<Signals>(row.signals_json) ?? {};
  const [caseA, caseB, fragments] = await Promise.all([
    buildCaseSide(env, row.case_a),
    buildCaseSide(env, row.case_b),
    buildFragments(env, row, signals),
  ]);
  return {
    id: row.id,
    label: linkLabel(row.num),
    status: row.status,
    score: row.score,
    score_raw: row.score_raw,
    signals,
    vinculador: parseJsonColumn<VinculadorOutput>(row.vinculador_json),
    vinculador_valid: row.vinculador_valid == null ? null : row.vinculador_valid === 1,
    case_a: caseA,
    case_b: caseB,
    fragments,
    created_at: row.created_at,
    reviewed_by: row.reviewer_name ?? row.reviewer_id ?? null,
    reviewed_at: row.reviewed_at,
    review_note: row.review_note,
  };
}

// ---------------------------------------------------------------------------
// Redes
// ---------------------------------------------------------------------------

interface NetworkRow {
  id: string;
  num: number;
  n_casos: number;
  updated_at: string;
  profile_status: NetworkSummary["profile_status"];
}

const NETWORK_SELECT = `SELECT n.id, n.num, n.n_casos, n.updated_at,
  (SELECT p.status FROM network_profiles p WHERE p.network_id = n.id ORDER BY p.created_at DESC LIMIT 1) AS profile_status
  FROM networks n`;

function periodo(dates: Array<string | null>): string | null {
  const ds = dates.filter((d): d is string => Boolean(d)).map((d) => d.slice(0, 10)).sort();
  if (!ds.length) return null;
  return ds[0] === ds[ds.length - 1] ? ds[0]! : `${ds[0]} a ${ds[ds.length - 1]}`;
}

export async function listNetworkSummaries(env: Env): Promise<NetworkSummary[]> {
  const [nets, members] = await env.DB.batch([
    env.DB.prepare(`${NETWORK_SELECT} ORDER BY n.updated_at DESC`),
    env.DB.prepare(
      "SELECT nc.network_id, c.sector, c.primer_contacto, c.created_at FROM network_cases nc JOIN cases c ON c.id = nc.case_id",
    ),
  ]);
  const byNet = new Map<string, Array<{ sector: string | null; primer_contacto: string | null; created_at: string }>>();
  for (const m of members!.results as Array<{ network_id: string; sector: string | null; primer_contacto: string | null; created_at: string }>) {
    byNet.set(m.network_id, [...(byNet.get(m.network_id) ?? []), m]);
  }
  return (nets!.results as unknown as NetworkRow[]).map((n) => summaryFrom(n, byNet.get(n.id) ?? []));
}

function summaryFrom(n: NetworkRow, cases: Array<{ sector: string | null; primer_contacto: string | null; created_at: string }>): NetworkSummary {
  return {
    id: n.id,
    label: networkLabel(n.num),
    n_cases: n.n_casos,
    sectores: [...new Set(cases.map((c) => c.sector).filter((s): s is string => Boolean(s)))].sort(),
    periodo: periodo(cases.map((c) => c.primer_contacto ?? c.created_at)),
    updated_at: n.updated_at,
    profile_status: n.profile_status ?? null,
  };
}

export async function buildNetworkView(env: Env, networkId: string): Promise<NetworkView> {
  const n = await env.DB.prepare(`${NETWORK_SELECT} WHERE n.id = ?`).bind(networkId).first<NetworkRow>();
  if (!n) throw notFound("Red");
  const { results: cases } = await env.DB.prepare(
    `SELECT c.id, c.code, c.org_id, c.sector, c.zona_cuadricula, c.primer_contacto, c.ficha_json, c.consent_mode, c.created_at
     FROM network_cases nc JOIN cases c ON c.id = nc.case_id WHERE nc.network_id = ? ORDER BY c.code`,
  )
    .bind(networkId)
    .all<CaseLite>();
  const ids = cases.map((c) => c.id);
  const ph = ids.map(() => "?").join(",") || "''";
  const [voices, idents, crops, links] = await env.DB.batch([
    env.DB.prepare(`SELECT num, case_id FROM voice_prints WHERE case_id IN (${ph})`).bind(...ids),
    env.DB.prepare(
      `SELECT ci.case_id, ci.hmac, ci.rol, i.tipo, i.ultimos_3 FROM case_identifiers ci JOIN identifiers i ON i.hmac = ci.hmac
       WHERE ci.case_id IN (${ph})`,
    ).bind(...ids),
    env.DB.prepare(`SELECT num, case_id, concept FROM image_crops WHERE case_id IN (${ph})`).bind(...ids),
    env.DB.prepare(
      `SELECT id, num, case_a, case_b, score FROM links WHERE status = 'confirmado' AND case_a IN (${ph}) AND case_b IN (${ph})`,
    ).bind(...ids, ...ids),
  ]);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const addNode = (node: GraphNode) => {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      nodes.push(node);
    }
  };
  const caseNode = (id: string) => `caso:${id}`;
  for (const c of cases) {
    addNode({ id: caseNode(c.id), type: "caso", label: `Caso ${c.code}`, data: { case_id: c.id, code: c.code, sector: c.sector, zona: c.zona_cuadricula } });
  }
  for (const v of voices!.results as Array<{ num: number; case_id: string }>) {
    const id = `voz:${v.num}`;
    addNode({ id, type: "voz", label: voiceLabel(v.num) });
    edges.push({ id: `e:${v.case_id}:${id}`, source: caseNode(v.case_id), target: id, type: "senal", label: "voz" });
  }
  for (const i of idents!.results as Array<{ case_id: string; hmac: string; rol: string; tipo: string; ultimos_3: string }>) {
    const label = identifierLabel(i.hmac);
    const id = `id:${label}`;
    addNode({ id, type: "identificador", label, data: { tipo: i.tipo, ultimos_3: i.ultimos_3 } });
    edges.push({ id: `e:${i.case_id}:${id}:${i.rol}`, source: caseNode(i.case_id), target: id, type: "senal", label: i.rol });
  }
  for (const im of crops!.results as Array<{ num: number; case_id: string; concept: string }>) {
    const id = `img:${im.num}`;
    addNode({ id, type: "imagen", label: imageLabel(im.num), data: { concept: im.concept } });
    edges.push({ id: `e:${im.case_id}:${id}`, source: caseNode(im.case_id), target: id, type: "senal", label: im.concept });
  }
  const timeline: TimelineItem[] = [];
  for (const c of cases) {
    const ficha = parseJsonColumn<FichaStored>(c.ficha_json);
    for (const frase of ficha?.frases_firma ?? []) {
      const norm = frase.trim().toLowerCase();
      if (!norm) continue;
      const id = `frase:${(await sha256Hex(norm)).slice(0, 12)}`;
      addNode({ id, type: "frase", label: frase.trim() });
      edges.push({ id: `e:${c.id}:${id}`, source: caseNode(c.id), target: id, type: "senal", label: "frase" });
    }
    const primer = ficha?.primer_contacto ?? c.primer_contacto;
    if (primer) timeline.push({ fecha: primer, texto: "Primer contacto", evidencia: ficha ? [`FICHA-${c.code}`] : [], caso: c.code });
    for (const e of ficha?.escalamiento ?? []) {
      if (e.fecha) timeline.push({ fecha: e.fecha, texto: e.tipo, evidencia: e.evidencia, caso: c.code });
    }
  }
  timeline.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  const linkRows = links!.results as Array<{ id: string; num: number; case_a: string; case_b: string; score: number }>;
  for (const l of linkRows) {
    edges.push({
      id: `vin:${l.num}`,
      source: caseNode(l.case_a),
      target: caseNode(l.case_b),
      type: "vinculo",
      label: linkLabel(l.num),
      weight: l.score,
    });
  }
  return {
    ...summaryFrom(n, cases),
    nodes,
    edges,
    timeline,
    links: linkRows.map((l) => ({ id: l.id, label: linkLabel(l.num), case_a: l.case_a, case_b: l.case_b, score: l.score })),
  };
}

// ---------------------------------------------------------------------------
// Perfiles, hipótesis, alertas, expedientes
// ---------------------------------------------------------------------------

export interface HypothesisRow {
  id: string;
  num: number;
  profile_id: string | null;
  network_id: string;
  texto: string;
  confianza: "baja" | "media" | "alta";
  evidence_json: string;
  status: "borrador" | "aprobada" | "descartada";
  reviewer_id: string | null;
  reviewer_name?: string | null;
}

export function hypothesisView(h: HypothesisRow) {
  return {
    id: h.id,
    texto: h.texto,
    confianza: h.confianza,
    evidencia: parseJsonColumn<string[]>(h.evidence_json) ?? [],
    status: h.status,
    reviewed_by: h.reviewer_name ?? h.reviewer_id ?? null,
  };
}

export async function listProfiles(env: Env, networkId: string): Promise<ProfileView[]> {
  const [profiles, hyps] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM network_profiles WHERE network_id = ? ORDER BY created_at DESC").bind(networkId),
    env.DB.prepare(
      `SELECT h.*, u.display_name AS reviewer_name FROM hypotheses h LEFT JOIN users u ON u.id = h.reviewer_id
       WHERE h.network_id = ? ORDER BY h.num`,
    ).bind(networkId),
  ]);
  const hypRows = hyps!.results as unknown as HypothesisRow[];
  return (
    profiles!.results as Array<{
      id: string;
      network_id: string;
      status: ProfileView["status"];
      model: string;
      profile_json: string;
      citation_check_json: string;
      created_at: string;
    }>
  ).map((p) => {
    const cc = parseJsonColumn<{ ok?: boolean; sin_cita?: string[]; citas_inexistentes?: string[] }>(p.citation_check_json) ?? {};
    return {
      id: p.id,
      network_id: p.network_id,
      status: p.status,
      model: p.model,
      perfil: JSON.parse(p.profile_json) as ProfileView["perfil"],
      hypotheses: hypRows.filter((h) => h.profile_id === p.id).map(hypothesisView),
      citation_check: { ok: Boolean(cc.ok), sin_cita: cc.sin_cita ?? [], citas_inexistentes: cc.citas_inexistentes ?? [] },
      created_at: p.created_at,
    };
  });
}

export interface AlertRow {
  id: string;
  org_id: string;
  network_id: string | null;
  draft_json: string;
  status: AlertView["status"];
  image_r2_key: string | null;
  approved_by: string | null;
  approver_name?: string | null;
  approved_at: string | null;
  created_at: string;
}

export function alertView(a: AlertRow): AlertView {
  return {
    id: a.id,
    org_id: a.org_id,
    status: a.status,
    borrador: JSON.parse(a.draft_json) as AlertaBorrador,
    network_id: a.network_id,
    created_at: a.created_at,
    approved_by: a.approver_name ?? a.approved_by,
    approved_at: a.approved_at,
    image_url: a.image_r2_key ? `/v1/console/alerts/${a.id}/image` : null,
  };
}

export interface ExpedienteRow {
  id: string;
  network_id: string;
  status: "generando" | "listo" | "error";
  r2_key: string | null;
  sha256: string | null;
  created_at: string;
}

export function expedienteView(e: ExpedienteRow): z.infer<typeof ExpedienteView> {
  return {
    id: e.id,
    network_id: e.network_id,
    status: e.status,
    sha256: e.sha256,
    created_at: e.created_at,
    download_url: e.status === "listo" && e.r2_key ? `/v1/console/expedientes/${e.id}/pdf` : null,
  };
}
