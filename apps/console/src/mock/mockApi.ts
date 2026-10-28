import type { BlindajeApi, MediaRange } from "../api/api";
import { ApiRequestError } from "../api/client";
import type {
  AlertDecisionRequest,
  AlertStatus,
  AlertView,
  AuditEntry,
  AuditVerifyResponse,
  CaseSide,
  CartografoModel,
  ConsoleRole,
  ConsoleUser,
  CostsResponse,
  CreateOrgRequest,
  CreateUserRequest,
  ExpedienteView,
  HealthResponse,
  HypothesisDecision,
  HypothesisView,
  InvitesRequest,
  LinkDecisionRequest,
  LinkStatus,
  LinkView,
  NetworkSummary,
  NetworkView,
  OrgView,
  ProfileView,
  UserView,
} from "../api/types";
import { appendEntry, verifyChain, type AuditDraft } from "./audit";
import {
  CASES,
  DEMO_PASSWORD,
  FRAGMENTS,
  ORGS,
  USERS,
  approvedAlertR002,
  buildGraph,
  initialLinks,
  profileForR001,
  profileR002Invalid,
  vigiaDrafts,
} from "./fixtures";
import { buildPdf, sha256Hex, synthImageSvg, synthVoiceWav } from "./media";

export type MockScenario = "inicio" | "red";

interface CostEntry {
  ts: string;
  model: string;
  operation: string;
  cost_usd: number;
  status: string;
  calls: number;
  units: Record<string, number>;
}

interface StoredExpediente extends ExpedienteView {
  ready_at: number;
}

interface MockState {
  version: 3;
  scenario: MockScenario;
  links: LinkView[];
  profiles: ProfileView[];
  alerts: AlertView[];
  expedientes: StoredExpediente[];
  audit: AuditEntry[];
  costs: CostEntry[];
  orgs: OrgView[];
  users: UserView[];
  seq: number;
}

const STATE_KEY = "blindaje.mock.state";
const USER_KEY = "blindaje.mock.user";
const BUDGET_USD = 150;

function forbidden(): never {
  throw new ApiRequestError(403, "forbidden", "Tu rol no tiene permiso para esta acción.");
}
function notFound(what = "el recurso"): never {
  throw new ApiRequestError(404, "not_found", `No se encontró ${what}.`);
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Historial de costos ficticio: los últimos tres días, relativo a la hora actual. */
function seedCosts(now: Date): CostEntry[] {
  const out: CostEntry[] = [];
  const t0 = now.getTime();
  // "2026-10-26T20:00:00Z" → mismo desfase respecto de 2026-10-28T15:00Z, trasladado a "ahora".
  const rel = (iso: string) => new Date(t0 - (Date.parse("2026-10-28T15:00:00Z") - Date.parse(iso))).toISOString();
  const batch = (ts: string, model: string, operation: string, calls: number, cost: number, units: Record<string, number>) =>
    out.push({ ts: rel(ts), model, operation, calls, cost_usd: cost, status: "ok", units });
  batch("2026-10-26T20:00:00Z", "muse-spark-1.3", "ficha", 28, 1.31, { input_tokens: 812_000, output_tokens: 84_000 });
  batch("2026-10-26T21:00:00Z", "muse-voice-transcribe-1.0", "transcribe", 22, 0.07, { audio_seconds: 1_420 });
  batch("2026-10-26T22:00:00Z", "sam-3.1", "sam_image", 36, 0.09, { images: 36 });
  batch("2026-10-27T15:00:00Z", "muse-spark-1.3", "ficha", 54, 2.62, { input_tokens: 1_610_000, output_tokens: 142_000 });
  batch("2026-10-27T16:00:00Z", "muse-spark-1.3", "vinculador", 24, 1.58, { input_tokens: 1_020_000, output_tokens: 72_000 });
  batch("2026-10-27T17:00:00Z", "muse-voice-transcribe-1.0", "transcribe", 41, 0.19, { audio_seconds: 3_810 });
  batch("2026-10-27T18:00:00Z", "sam-3.1", "sam_image", 72, 0.18, { images: 72 });
  batch("2026-10-27T19:00:00Z", "sam-3.1", "sam_video", 3, 0.03, { frames: 150 });
  batch("2026-10-27T20:00:00Z", "muse-wonder-1.0", "cartografo", 2, 2.08, { input_tokens: 402_000, output_tokens: 23_500 });
  batch("2026-10-27T21:00:00Z", "muse-image-1.0", "image", 4, 0.04, { images: 4 });
  batch("2026-10-27T22:00:00Z", "muse-spark-1.2", "transcribe_audio", 6, 0.29, { input_tokens: 196_000, output_tokens: 10_000 });
  batch("2026-10-28T13:00:00Z", "muse-spark-1.3", "ficha", 22, 1.07, { input_tokens: 662_000, output_tokens: 57_000 });
  batch("2026-10-28T13:30:00Z", "muse-voice-transcribe-1.0", "transcribe", 18, 0.08, { audio_seconds: 1_550 });
  const recent: [string, string, string, number, Record<string, number>, string?][] = [
    ["2026-10-28T14:02:11Z", "muse-voice-transcribe-1.0", "transcribe", 0.0021, { audio_seconds: 42 }],
    ["2026-10-28T14:02:40Z", "muse-spark-1.3", "ficha", 0.0482, { input_tokens: 29_800, output_tokens: 2_570 }],
    ["2026-10-28T14:03:05Z", "sam-3.1", "sam_image", 0.0025, { images: 1 }],
    ["2026-10-28T14:05:51Z", "muse-spark-1.3", "vinculador", 0.0661, { input_tokens: 42_100, output_tokens: 3_180 }],
    ["2026-10-28T14:06:30Z", "muse-wonder-1.0", "cartografo", 0, { input_tokens: 0, output_tokens: 0 }, "blocked"],
    ["2026-10-28T14:07:12Z", "muse-spark-1.3", "ficha", 0, { input_tokens: 0, output_tokens: 0 }, "cached"],
    ["2026-10-28T14:09:44Z", "muse-spark-1.3", "vinculador", 0.0634, { input_tokens: 40_500, output_tokens: 3_010 }],
  ];
  for (const [ts, model, operation, cost, units, status] of recent) {
    out.push({ ts: rel(ts), model, operation, calls: 1, cost_usd: cost, status: status ?? "ok", units });
  }
  return out;
}

function limaDay(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

export interface MockApiOptions {
  /** Latencia simulada en ms (0 en tests). */
  latency?: number;
  now?: () => Date;
  persist?: boolean;
}

/** API simulada en memoria (y en sessionStorage para sobrevivir a una recarga). */
export class MockApi implements BlindajeApi {
  readonly mode = "mock" as const;
  private state: MockState | null = null;
  private ready: Promise<void> | null = null;
  private user: ConsoleUser | null = null;
  private readonly latency: number;
  private readonly now: () => Date;
  private readonly persist: boolean;
  private expiredCb: (() => void) | null = null;

  constructor(opts: MockApiOptions = {}) {
    this.latency = opts.latency ?? 280;
    this.now = opts.now ?? (() => new Date());
    this.persist = opts.persist ?? true;
  }

  // -------------------------------------------------------------------------
  // Estado
  // -------------------------------------------------------------------------

  private async init(): Promise<MockState> {
    if (this.state) return this.state;
    if (!this.ready) {
      this.ready = (async () => {
        const raw = this.persist ? storage()?.getItem(STATE_KEY) : null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as MockState;
            if (parsed.version === 3) {
              this.state = parsed;
              return;
            }
          } catch {
            // estado corrupto: se regenera
          }
        }
        this.state = await this.freshState("inicio");
        this.save();
      })();
    }
    await this.ready;
    return this.state!;
  }

  private save(): void {
    if (!this.persist || !this.state) return;
    try {
      storage()?.setItem(STATE_KEY, JSON.stringify(this.state));
    } catch {
      // sin almacenamiento: el estado vive en memoria
    }
  }

  private async freshState(scenario: MockScenario): Promise<MockState> {
    const links = initialLinks();
    const state: MockState = {
      version: 3,
      scenario,
      links,
      profiles: [profileR002Invalid()],
      alerts: [approvedAlertR002()],
      expedientes: [],
      audit: [],
      costs: seedCosts(this.now()),
      orgs: ORGS.map((o) => ({ ...o })),
      users: USERS.map((u) => ({ ...u })),
      seq: 10,
    };
    const log = (d: AuditDraft) => appendEntry(state.audit, d);
    const sys = (ts: string, action: string, target_type: string | null, target_id: string | null, details: Record<string, unknown> | null = null) =>
      log({ ts, actor_type: "system", actor_id: "system", action, target_type, target_id, details });

    // Historia de custodia de los casos, en orden cronológico.
    const pseudo: Record<string, string> = { A: "V-7F3K", B: "V-Q2M8", C: "V-H5T1", D: "V-N4D2", E: "V-R8W6", F: "V-K3P9" };
    const events: { ts: string; fn: () => Promise<AuditEntry> }[] = [];
    for (const c of Object.values(CASES)) {
      for (const ev of c.evidencia) {
        events.push({
          ts: ev.received_utc,
          fn: () =>
            log({
              ts: ev.received_utc,
              actor_type: "victim",
              actor_id: pseudo[c.code] ?? "V-0000",
              action: "evidence.upload",
              target_type: "evidence",
              target_id: ev.label,
              details: { sha256: ev.sha256, tipo: ev.tipo },
            }),
        });
      }
    }
    for (const l of links) {
      events.push({ ts: l.created_at, fn: () => sys(l.created_at, "link.propose", "link", l.label, { score: l.score }) });
    }
    events.push({
      ts: "2026-10-01T15:30:00Z",
      fn: () =>
        log({ ts: "2026-10-01T15:30:00Z", actor_type: "analyst", actor_id: "usr-analista", action: "link.confirm", target_type: "link", target_id: "VIN-4", details: null }),
    });
    events.push({ ts: "2026-10-02T16:00:00Z", fn: () => sys("2026-10-02T16:00:00Z", "cartografo.invalid_citations", "network", "R-002", { citas_inexistentes: ["EV-D9"] }) });
    events.push({
      ts: "2026-10-02T18:30:00Z",
      fn: () =>
        log({ ts: "2026-10-02T18:30:00Z", actor_type: "reviewer", actor_id: "usr-revisor-moto", action: "alert.approve", target_type: "alert", target_id: "alert-0", details: null }),
    });
    events.sort((a, b) => a.ts.localeCompare(b.ts));
    for (const e of events) await e.fn();

    if (scenario === "red") {
      for (const id of ["link-1", "link-2"]) {
        const l = links.find((x) => x.id === id)!;
        l.status = "confirmado";
        l.reviewed_by = "Analista Demo";
        l.reviewed_at = "2026-10-20T15:00:00Z";
        l.review_note = id === "link-1" ? "La voz coincide en los dos audios del caso B." : "Misma cuenta de cobro en los dos mensajes.";
        await log({ ts: "2026-10-20T15:00:00Z", actor_type: "analyst", actor_id: "usr-analista", action: "link.confirm", target_type: "link", target_id: l.label, details: null });
      }
      state.profiles.unshift(profileForR001("prof-r001-1", "muse-spark-1.3", "2026-10-20T15:20:00Z", 3));
      await sys("2026-10-20T15:20:00Z", "cartografo.run", "network", "R-001", { model: "muse-spark-1.3" });
      state.alerts.unshift(...vigiaDrafts("2026-10-21T11:00:00Z", 1));
      await sys("2026-10-21T11:00:00Z", "vigia.run", null, null, { borradores: 2 });
    }
    return state;
  }

  private async wait(ms = this.latency): Promise<void> {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private nextId(prefix: string): string {
    const s = this.state!;
    s.seq += 1;
    return `${prefix}-${s.seq}`;
  }

  private requireRole(...roles: ConsoleRole[]): ConsoleUser {
    const u = this.user;
    if (!u) {
      this.expiredCb?.();
      throw new ApiRequestError(401, "unauthorized", "Tu sesión expiró. Vuelve a entrar.");
    }
    if (!roles.includes(u.role)) forbidden();
    return u;
  }

  private async audit(action: string, target_type: string | null, target_id: string | null, details: Record<string, unknown> | null = null): Promise<void> {
    const u = this.user;
    await appendEntry(this.state!.audit, {
      ts: this.nowIso(),
      actor_type: u?.role ?? "system",
      actor_id: u?.id ?? "system",
      action,
      target_type,
      target_id,
      details,
    });
  }

  private addCost(model: string, operation: string, cost: number, units: Record<string, number>, status = "ok"): void {
    this.state!.costs.push({ ts: this.nowIso(), model, operation, cost_usd: cost, status, calls: 1, units });
  }

  // -------------------------------------------------------------------------
  // Utilidades exclusivas del modo simulado
  // -------------------------------------------------------------------------

  async reset(scenario: MockScenario): Promise<void> {
    this.state = await this.freshState(scenario);
    this.ready = Promise.resolve();
    this.save();
  }

  async scenario(): Promise<MockScenario> {
    return (await this.init()).scenario;
  }

  /** Altera una entrada sin recalcular su hash, para mostrar que la verificación lo detecta. */
  async tamperAudit(): Promise<number> {
    const s = await this.init();
    const target = s.audit[Math.floor(s.audit.length / 2)];
    if (!target) return 0;
    target.details = { ...(target.details ?? {}), alterado: true };
    this.save();
    return target.seq;
  }

  // -------------------------------------------------------------------------
  // BlindajeApi
  // -------------------------------------------------------------------------

  async health(): Promise<HealthResponse> {
    await this.wait(60);
    return { ok: true, env: "demo", version: "simulado" };
  }

  onSessionExpired(cb: () => void): void {
    this.expiredCb = cb;
  }

  async login(email: string, password: string): Promise<ConsoleUser> {
    const s = await this.init();
    await this.wait();
    const u = s.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && !x.disabled);
    if (!u || password !== DEMO_PASSWORD) {
      throw new ApiRequestError(401, "unauthorized", "Correo o contraseña incorrectos.");
    }
    this.user = { id: u.id, email: u.email, display_name: u.display_name, role: u.role, org: u.org };
    try {
      storage()?.setItem(USER_KEY, u.id);
    } catch {
      // nada
    }
    await this.audit("console.login", "user", u.id);
    this.save();
    return this.user;
  }

  async restore(): Promise<ConsoleUser | null> {
    const s = await this.init();
    let id: string | null = null;
    try {
      id = storage()?.getItem(USER_KEY) ?? null;
    } catch {
      id = null;
    }
    const u = id ? s.users.find((x) => x.id === id) : undefined;
    if (!u) return null;
    this.user = { id: u.id, email: u.email, display_name: u.display_name, role: u.role, org: u.org };
    return this.user;
  }

  async logout(): Promise<void> {
    await this.wait(80);
    this.user = null;
    try {
      storage()?.removeItem(USER_KEY);
    } catch {
      // nada
    }
  }

  // Vínculos ------------------------------------------------------------------

  async listLinks(status?: LinkStatus[]): Promise<LinkView[]> {
    const s = await this.init();
    this.requireRole("reviewer", "analyst");
    await this.wait();
    const wanted = status && status.length > 0 ? status : (["probable", "por_revisar"] as LinkStatus[]);
    return s.links
      .filter((l) => wanted.includes(l.status))
      .sort((a, b) => b.score - a.score)
      .map((l) => structuredClone(l));
  }

  async getLink(id: string): Promise<LinkView> {
    const s = await this.init();
    this.requireRole("reviewer", "analyst");
    await this.wait();
    const l = s.links.find((x) => x.id === id || x.label === id);
    if (!l) notFound("el vínculo");
    return structuredClone(l);
  }

  async decideLink(id: string, req: LinkDecisionRequest): Promise<LinkView> {
    const s = await this.init();
    const u = this.requireRole("reviewer", "analyst");
    await this.wait();
    const l = s.links.find((x) => x.id === id);
    if (!l) notFound("el vínculo");
    if (l.status === "confirmado" || l.status === "descartado") {
      throw new ApiRequestError(409, "conflict", "Este vínculo ya fue revisado.");
    }
    l.status = req.decision === "confirmar" ? "confirmado" : "descartado";
    l.reviewed_by = u.display_name;
    l.reviewed_at = this.nowIso();
    l.review_note = req.note?.trim() ? req.note.trim() : null;
    await this.audit(req.decision === "confirmar" ? "link.confirm" : "link.discard", "link", l.label, l.review_note ? { nota: true } : null);
    if (req.decision === "confirmar") await this.audit("network.recompute", "network", null);
    this.save();
    return structuredClone(l);
  }

  async fetchMedia(url: string, range?: MediaRange): Promise<Blob> {
    await this.init();
    this.requireRole("reviewer", "analyst", "admin");
    await this.wait(350);
    const m = /\/evidence\/([^/?]+)\/media/.exec(url);
    const evId = m?.[1];
    const ev = Object.values(CASES)
      .flatMap((c) => c.evidencia)
      .find((e) => e.id === evId);
    if (!ev) notFound("el archivo");
    const q = new URL(url, "https://mock.invalid").searchParams;
    const start = Number(q.get("start_ms") ?? range?.start_ms ?? 0);
    const end = Number(q.get("end_ms") ?? range?.end_ms ?? ev.duration_ms ?? 6000);
    await this.audit("media.access", "evidence", ev.label, { start_ms: start, end_ms: end });
    this.save();
    if (ev.tipo === "audio") {
      const frag = Object.values(FRAGMENTS).find((f) => f.evidence_id === ev.id);
      return synthVoiceWav(frag?.voice_label ?? "V-0", Math.max(1000, end - start), ev.label.length + start);
    }
    return synthImageSvg(`${ev.label} · imagen redactada`, "Ilustración ficticia: rostros y datos tapados");
  }

  async getCase(id: string): Promise<CaseSide> {
    await this.init();
    this.requireRole("reviewer", "analyst");
    await this.wait(120);
    const c = Object.values(CASES).find((x) => x.id === id || x.code === id);
    if (!c) notFound("el caso");
    return structuredClone(c);
  }

  // Redes ---------------------------------------------------------------------

  /** Componentes conexos de los vínculos confirmados. */
  private networks(): { id: string; label: string; cases: string[]; links: LinkView[] }[] {
    const s = this.state!;
    const confirmed = s.links.filter((l) => l.status === "confirmado");
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const p = parent.get(x) ?? x;
      if (p === x) return x;
      const r = find(p);
      parent.set(x, r);
      return r;
    };
    for (const l of confirmed) {
      const a = find(l.case_a.code);
      const b = find(l.case_b.code);
      if (a !== b) parent.set(a, b);
    }
    const groups = new Map<string, Set<string>>();
    for (const l of confirmed) {
      for (const c of [l.case_a.code, l.case_b.code]) {
        const r = find(c);
        if (!groups.has(r)) groups.set(r, new Set());
        groups.get(r)!.add(c);
      }
    }
    return [...groups.values()].map((set) => {
      const cases = [...set].sort();
      const isR002 = cases.includes("D") || cases.includes("E");
      return {
        id: isR002 ? "net-2" : "net-1",
        label: isR002 ? "R-002" : "R-001",
        cases,
        links: confirmed.filter((l) => set.has(l.case_a.code) && set.has(l.case_b.code)),
      };
    });
  }

  private summary(n: { id: string; label: string; cases: string[]; links: LinkView[] }): NetworkSummary {
    const s = this.state!;
    const g = buildGraph(n.cases, n.links);
    const dates = g.timeline.map((t) => t.fecha.slice(0, 10)).sort();
    const sectores = [...new Set(n.cases.map((c) => CASES[c]?.sector).filter((x): x is string => !!x))];
    const profile = s.profiles.find((p) => p.network_id === n.id);
    const updated = n.links.map((l) => l.reviewed_at ?? l.created_at).sort().pop() ?? this.nowIso();
    return {
      id: n.id,
      label: n.label,
      n_cases: n.cases.length,
      sectores,
      periodo: dates.length ? `${dates[0]} a ${dates[dates.length - 1]}` : null,
      updated_at: updated,
      profile_status: profile?.status ?? null,
    };
  }

  async listNetworks(): Promise<NetworkSummary[]> {
    await this.init();
    this.requireRole("analyst", "admin");
    await this.wait();
    return this.networks()
      .map((n) => this.summary(n))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async getNetwork(id: string): Promise<NetworkView> {
    await this.init();
    this.requireRole("analyst", "admin");
    await this.wait();
    const n = this.networks().find((x) => x.id === id || x.label === id);
    if (!n) notFound("la red");
    const g = buildGraph(n.cases, n.links);
    return {
      ...this.summary(n),
      nodes: g.nodes,
      edges: g.edges,
      timeline: g.timeline,
      links: n.links.map((l) => ({ id: l.id, label: l.label, case_a: l.case_a.code, case_b: l.case_b.code, score: l.score })),
    };
  }

  async listProfiles(networkId: string): Promise<ProfileView[]> {
    const s = await this.init();
    this.requireRole("analyst", "admin");
    await this.wait();
    return s.profiles.filter((p) => p.network_id === networkId).map((p) => structuredClone(p));
  }

  async runCartografo(networkId: string, model: CartografoModel): Promise<ProfileView> {
    const s = await this.init();
    this.requireRole("analyst");
    const costs = await this.costsNow();
    if (model === "muse-wonder-1.0" && costs.nonessential_blocked) {
      this.addCost(model, "cartografo", 0, { input_tokens: 0, output_tokens: 0 }, "blocked");
      this.save();
      throw new ApiRequestError(402, "budget_exceeded", "Muse Wonder está bloqueado: el gasto superó el 80% del presupuesto.");
    }
    const n = this.networks().find((x) => x.id === networkId);
    if (!n) notFound("la red");
    await this.wait(model === "muse-wonder-1.0" ? 2600 : 1800);
    const id = this.nextId("prof");
    let profile: ProfileView;
    if (n.id === "net-1") {
      profile = profileForR001(id, model, this.nowIso(), n.cases.length);
    } else {
      const base = profileR002Invalid();
      profile = {
        ...base,
        id,
        model,
        status: "borrador",
        created_at: this.nowIso(),
        perfil: {
          ...base.perfil,
          hechos: base.perfil.hechos.filter((h) => h.evidencia.length > 0),
          hipotesis: [{ texto: "La moto de ID-a4419b hace el seguimiento físico.", confianza: "media", evidencia: ["ID-a4419b", "EV-D2", "EV-E1"] }],
        },
        hypotheses: [
          { id: `${id}-h1`, texto: "La moto de ID-a4419b hace el seguimiento físico.", confianza: "media", evidencia: ["ID-a4419b", "EV-D2", "EV-E1"], status: "borrador", reviewed_by: null },
        ],
        citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] },
      };
    }
    s.profiles.unshift(profile);
    const wonder = model === "muse-wonder-1.0";
    this.addCost(model, "cartografo", wonder ? 1.04 : 0.31, wonder ? { input_tokens: 201_000, output_tokens: 11_800 } : { input_tokens: 198_000, output_tokens: 14_600 });
    await this.audit("cartografo.run", "network", n.label, { model, citation_ok: profile.citation_check.ok });
    this.save();
    return structuredClone(profile);
  }

  async decideHypothesis(id: string, decision: HypothesisDecision): Promise<HypothesisView> {
    const s = await this.init();
    const u = this.requireRole("analyst");
    await this.wait();
    for (const p of s.profiles) {
      const h = p.hypotheses.find((x) => x.id === id);
      if (!h) continue;
      if (p.status === "invalido") throw new ApiRequestError(409, "conflict", "El perfil no pasó el validador de citas: no se pueden aprobar sus hipótesis.");
      h.status = decision === "aprobar" ? "aprobada" : "descartada";
      h.reviewed_by = u.display_name;
      if (p.hypotheses.every((x) => x.status !== "borrador")) {
        p.status = p.hypotheses.some((x) => x.status === "aprobada") ? "aprobado" : "rechazado";
      }
      await this.audit(decision === "aprobar" ? "hypothesis.approve" : "hypothesis.discard", "hypothesis", id);
      this.save();
      return structuredClone(h);
    }
    notFound("la hipótesis");
  }

  // Alertas -------------------------------------------------------------------

  async listAlerts(status?: AlertStatus): Promise<AlertView[]> {
    const s = await this.init();
    const u = this.requireRole("reviewer", "analyst", "admin");
    await this.wait();
    return s.alerts
      .filter((a) => (u.role === "reviewer" ? a.org_id === u.org.id : true))
      .filter((a) => (status ? a.status === status : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((a) => structuredClone(a));
  }

  async decideAlert(id: string, req: AlertDecisionRequest): Promise<AlertView> {
    const s = await this.init();
    const u = this.requireRole("reviewer", "admin");
    await this.wait();
    const a = s.alerts.find((x) => x.id === id);
    if (!a || (u.role === "reviewer" && a.org_id !== u.org.id)) notFound("la alerta");
    if (a.status !== "borrador") throw new ApiRequestError(409, "conflict", "Esta alerta ya fue revisada.");
    if (req.titulo?.trim()) a.borrador.titulo = req.titulo.trim();
    if (req.cuerpo?.trim()) a.borrador.cuerpo = req.cuerpo.trim();
    a.status = req.decision === "aprobar" ? "aprobada" : "rechazada";
    a.approved_by = u.display_name;
    a.approved_at = this.nowIso();
    await this.audit(req.decision === "aprobar" ? "alert.approve" : "alert.reject", "alert", a.id, { org: a.org_id });
    this.save();
    return structuredClone(a);
  }

  async runVigia(): Promise<AlertView[]> {
    const s = await this.init();
    this.requireRole("analyst", "admin");
    await this.wait(1200);
    const net = this.networks().find((n) => n.id === "net-1");
    this.addCost("muse-spark-1.3", "vigia", 0.04, { input_tokens: 21_000, output_tokens: 1_900 });
    const exists = s.alerts.some((a) => a.network_id === "net-1" && a.status !== "rechazada");
    let created: AlertView[] = [];
    if (net && net.cases.length >= 2 && !exists) {
      s.seq += 2;
      created = vigiaDrafts(this.nowIso(), s.seq - 1);
      s.alerts.unshift(...created);
    }
    await this.audit("vigia.run", null, null, { borradores: created.length });
    this.save();
    return structuredClone(created);
  }

  // Expedientes ----------------------------------------------------------------

  private pdfFor(e: StoredExpediente): Uint8Array {
    const n = this.networks().find((x) => x.id === e.network_id);
    const cases = n?.cases ?? [];
    const g = buildGraph(cases, n?.links ?? []);
    const lines = [
      `Expediente de red ${n?.label ?? e.network_id} - DATOS FICTICIOS`,
      `Generado: ${e.created_at} (modo simulado de la consola de Blindaje)`,
      `Casos: ${cases.join(", ")}`,
      `Vinculos confirmados: ${(n?.links ?? []).map((l) => `${l.label} (${l.score.toFixed(2)})`).join(", ")}`,
      "",
      "Cronologia:",
      ...g.timeline.map((t) => `  ${t.fecha.slice(0, 10)}  Caso ${t.caso}: ${t.texto} [${t.evidencia.join(", ")}]`),
      "",
      "Evidencia (SHA-256):",
      ...cases.flatMap((c) => (CASES[c]?.evidencia ?? []).map((ev) => `  ${ev.label}  ${ev.sha256}`)),
      "",
      "Cadena de custodia: ver registro de auditoria encadenado.",
      "Documento ficticio. No contiene datos de personas reales.",
    ];
    return buildPdf(lines);
  }

  async createExpediente(networkId: string): Promise<ExpedienteView> {
    const s = await this.init();
    this.requireRole("analyst");
    await this.wait();
    if (!this.networks().some((n) => n.id === networkId)) notFound("la red");
    const e: StoredExpediente = {
      id: this.nextId("exp"),
      network_id: networkId,
      status: "generando",
      sha256: null,
      created_at: this.nowIso(),
      download_url: null,
      ready_at: this.now().getTime() + 1500,
    };
    s.expedientes.unshift(e);
    await this.audit("expediente.generate", "network", networkId);
    this.save();
    const { ready_at: _r, ...view } = e;
    return view;
  }

  async getExpediente(id: string): Promise<ExpedienteView> {
    const s = await this.init();
    this.requireRole("analyst");
    await this.wait(150);
    const e = s.expedientes.find((x) => x.id === id);
    if (!e) notFound("el expediente");
    if (e.status === "generando" && this.now().getTime() >= e.ready_at) {
      e.sha256 = await sha256Hex(this.pdfFor(e) as Uint8Array<ArrayBuffer>);
      e.status = "listo";
      e.download_url = `/v1/console/expedientes/${e.id}/pdf`;
      await this.audit("expediente.ready", "expediente", e.id, { sha256: e.sha256 });
      this.save();
    }
    const { ready_at: _r, ...view } = e;
    return view;
  }

  async downloadExpediente(id: string): Promise<Blob> {
    const s = await this.init();
    this.requireRole("analyst");
    await this.wait();
    const e = s.expedientes.find((x) => x.id === id);
    if (!e || e.status !== "listo") notFound("el expediente");
    await this.audit("expediente.download", "expediente", e.id);
    this.save();
    return new Blob([this.pdfFor(e) as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
  }

  // Auditoría y costos ------------------------------------------------------------

  async listAudit(opts: { before_seq?: number; limit?: number } = {}): Promise<AuditEntry[]> {
    const s = await this.init();
    this.requireRole("admin", "analyst");
    await this.wait();
    const limit = opts.limit ?? 50;
    return [...s.audit]
      .sort((a, b) => b.seq - a.seq)
      .filter((e) => (opts.before_seq ? e.seq < opts.before_seq : true))
      .slice(0, limit)
      .map((e) => structuredClone(e));
  }

  async verifyAudit(): Promise<AuditVerifyResponse> {
    const s = await this.init();
    this.requireRole("admin", "analyst");
    await this.wait(600);
    return verifyChain(s.audit);
  }

  private async costsNow(): Promise<CostsResponse> {
    const s = await this.init();
    const total = s.costs.reduce((acc, c) => acc + c.cost_usd, 0);
    const byModel = new Map<string, { model: string; calls: number; cost_usd: number; units: Record<string, number> }>();
    const byDay = new Map<string, number>();
    for (const c of s.costs) {
      const m = byModel.get(c.model) ?? { model: c.model, calls: 0, cost_usd: 0, units: {} };
      m.calls += c.calls;
      m.cost_usd += c.cost_usd;
      for (const [k, v] of Object.entries(c.units)) m.units[k] = (m.units[k] ?? 0) + v;
      byModel.set(c.model, m);
      const d = limaDay(c.ts);
      byDay.set(d, (byDay.get(d) ?? 0) + c.cost_usd);
    }
    const pct = (total / BUDGET_USD) * 100;
    return {
      total_usd: Math.round(total * 10_000) / 10_000,
      budget_usd: BUDGET_USD,
      pct: Math.round(pct * 100) / 100,
      nonessential_blocked: pct >= 80,
      by_model: [...byModel.values()].sort((a, b) => b.cost_usd - a.cost_usd),
      by_day: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cost_usd]) => ({ day, cost_usd })),
      recent: s.costs
        .filter((c) => c.calls === 1)
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, 15)
        .map((c) => ({ ts: c.ts, model: c.model, operation: c.operation, cost_usd: c.cost_usd, status: c.status })),
    };
  }

  async costs(): Promise<CostsResponse> {
    await this.init();
    this.requireRole("admin", "analyst");
    await this.wait();
    return this.costsNow();
  }

  // Administración ------------------------------------------------------------------

  async listOrgs(): Promise<OrgView[]> {
    const s = await this.init();
    this.requireRole("admin");
    await this.wait();
    return s.orgs.map((o) => ({ ...o }));
  }

  async createOrg(req: CreateOrgRequest): Promise<OrgView> {
    const s = await this.init();
    this.requireRole("admin");
    await this.wait();
    if (req.name.trim().length < 3) throw new ApiRequestError(400, "bad_request", "El nombre debe tener al menos 3 letras.");
    const org: OrgView = { id: this.nextId("org"), name: req.name.trim(), kind: req.kind, district: req.district?.trim() || null, created_at: this.nowIso() };
    s.orgs.push(org);
    await this.audit("org.create", "org", org.id);
    this.save();
    return { ...org };
  }

  async createInvites(req: InvitesRequest): Promise<string[]> {
    await this.init();
    const u = this.requireRole("admin", "reviewer");
    await this.wait();
    const count = Math.min(Math.max(1, Math.floor(req.count)), 50);
    const orgId = u.role === "reviewer" ? u.org.id : (req.org_id ?? u.org.id);
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const codes = Array.from({ length: count }, () => {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      const raw = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
      return `${raw.slice(0, 4)}-${raw.slice(4)}`;
    });
    await this.audit("invite.create", "org", orgId, { count });
    this.save();
    return codes;
  }

  async listUsers(): Promise<UserView[]> {
    const s = await this.init();
    this.requireRole("admin");
    await this.wait();
    return s.users.map((u) => ({ ...u }));
  }

  async createUser(req: CreateUserRequest): Promise<UserView> {
    const s = await this.init();
    this.requireRole("admin");
    await this.wait();
    if (s.users.some((u) => u.email.toLowerCase() === req.email.toLowerCase())) {
      throw new ApiRequestError(409, "conflict", "Ya existe un usuario con ese correo.");
    }
    if (req.password.length < 8) throw new ApiRequestError(400, "bad_request", "La contraseña debe tener al menos 8 caracteres.");
    const org = s.orgs.find((o) => o.id === req.org_id);
    if (!org) throw new ApiRequestError(400, "bad_request", "La organización no existe.");
    const user: UserView = {
      id: this.nextId("usr"),
      email: req.email.trim(),
      display_name: req.display_name.trim(),
      role: req.role,
      org: { id: org.id, name: org.name },
      disabled: false,
      created_at: this.nowIso(),
    };
    s.users.push(user);
    await this.audit("user.create", "user", user.id, { role: user.role });
    this.save();
    return { ...user };
  }
}
