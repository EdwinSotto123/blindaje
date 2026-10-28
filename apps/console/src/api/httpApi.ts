import * as S from "@blindaje/shared";
import type { BlindajeApi, MediaRange } from "./api";
import { HttpClient, SessionTokenStore, type TokenStore, type Validator } from "./client";
import type {
  AlertDecisionRequest,
  AlertStatus,
  AlertView,
  AuditEntry,
  AuditVerifyResponse,
  CaseSide,
  CartografoModel,
  ConsoleLoginResponse,
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
} from "./types";

/** Valida `{ [key]: T[] }` elemento por elemento con un esquema de shared. */
function listOf(key: string, schema: Validator): Validator {
  return {
    safeParse(value: unknown) {
      const arr = (value as Record<string, unknown> | undefined)?.[key];
      if (!Array.isArray(arr)) return { success: false, error: `Falta el arreglo "${key}"` };
      for (const [i, item] of arr.entries()) {
        const r = schema.safeParse(item);
        if (!r.success) return { success: false, error: { index: i, error: r.error } };
      }
      return { success: true };
    },
  };
}

/** Implementación contra la API real (docs/API.md). */
export class HttpApi implements BlindajeApi {
  readonly mode = "http" as const;
  readonly client: HttpClient;
  private user: ConsoleUser | null = null;

  constructor(baseUrl: string, store: TokenStore = new SessionTokenStore(), fetchImpl?: typeof fetch) {
    this.client = new HttpClient(fetchImpl ? { baseUrl, store, fetch: fetchImpl } : { baseUrl, store });
  }

  onSessionExpired(cb: () => void): void {
    this.client.onSessionExpired = () => {
      this.user = null;
      cb();
    };
  }

  health(): Promise<HealthResponse> {
    return this.client.json<HealthResponse>("GET", "/v1/health", { auth: false });
  }

  async login(email: string, password: string): Promise<ConsoleUser> {
    const res = await this.client.json<ConsoleLoginResponse>("POST", "/v1/auth/console/login", {
      auth: false,
      body: { email, password },
      validate: S.ConsoleLoginResponse,
    });
    this.client.setTokens(res);
    this.user = res.user;
    return res.user;
  }

  async restore(): Promise<ConsoleUser | null> {
    if (!this.client.hasSession()) return null;
    try {
      this.user = await this.client.json<ConsoleUser>("GET", "/v1/console/me", { validate: S.ConsoleUser });
      return this.user;
    } catch {
      this.client.clearSession();
      return null;
    }
  }

  async logout(): Promise<void> {
    const refresh = this.client.getRefreshToken();
    try {
      if (refresh) await this.client.json<void>("POST", "/v1/auth/logout", { body: { refresh_token: refresh } });
    } catch {
      // Cerrar la sesión local aunque la API no responda.
    } finally {
      this.client.clearSession();
      this.user = null;
    }
  }

  async listLinks(status?: LinkStatus[]): Promise<LinkView[]> {
    const res = await this.client.json<{ links: LinkView[] }>("GET", "/v1/console/links", {
      query: { status: status?.join(",") },
      validate: listOf("links", S.LinkView),
    });
    return res.links;
  }

  getLink(id: string): Promise<LinkView> {
    return this.client.json<LinkView>("GET", `/v1/console/links/${encodeURIComponent(id)}`, { validate: S.LinkView });
  }

  decideLink(id: string, req: LinkDecisionRequest): Promise<LinkView> {
    return this.client.json<LinkView>("POST", `/v1/console/links/${encodeURIComponent(id)}/decision`, {
      body: req,
      validate: S.LinkView,
    });
  }

  fetchMedia(url: string, range?: MediaRange): Promise<Blob> {
    const query: Record<string, number | undefined> = {};
    // Si la URL ya trae el rango, se respeta; si no, se agrega.
    const hasRange = /[?&]start_ms=/.test(url);
    if (!hasRange && range) {
      query.start_ms = range.start_ms;
      query.end_ms = range.end_ms;
    }
    return this.client.blob(url, { query });
  }

  getCase(id: string): Promise<CaseSide> {
    return this.client.json<CaseSide>("GET", `/v1/console/cases/${encodeURIComponent(id)}`, { validate: S.CaseSide });
  }

  async listNetworks(): Promise<NetworkSummary[]> {
    const res = await this.client.json<{ networks: NetworkSummary[] }>("GET", "/v1/console/networks", {
      validate: listOf("networks", S.NetworkSummary),
    });
    return res.networks;
  }

  getNetwork(id: string): Promise<NetworkView> {
    return this.client.json<NetworkView>("GET", `/v1/console/networks/${encodeURIComponent(id)}`, {
      validate: S.NetworkView,
    });
  }

  async listProfiles(networkId: string): Promise<ProfileView[]> {
    const res = await this.client.json<{ profiles: ProfileView[] }>(
      "GET",
      `/v1/console/networks/${encodeURIComponent(networkId)}/profiles`,
      { validate: listOf("profiles", S.ProfileView) },
    );
    return res.profiles;
  }

  runCartografo(networkId: string, model: CartografoModel): Promise<ProfileView> {
    return this.client.json<ProfileView>("POST", `/v1/console/networks/${encodeURIComponent(networkId)}/cartografo`, {
      body: { model },
      validate: S.ProfileView,
    });
  }

  decideHypothesis(id: string, decision: HypothesisDecision): Promise<HypothesisView> {
    return this.client.json<HypothesisView>("POST", `/v1/console/hypotheses/${encodeURIComponent(id)}/decision`, {
      body: { decision },
      validate: S.HypothesisView,
    });
  }

  async listAlerts(status?: AlertStatus): Promise<AlertView[]> {
    const res = await this.client.json<{ alerts: AlertView[] }>("GET", "/v1/console/alerts", {
      query: { status },
      validate: listOf("alerts", S.AlertView),
    });
    return res.alerts;
  }

  decideAlert(id: string, req: AlertDecisionRequest): Promise<AlertView> {
    return this.client.json<AlertView>("POST", `/v1/console/alerts/${encodeURIComponent(id)}/decision`, {
      body: req,
      validate: S.AlertView,
    });
  }

  async runVigia(): Promise<AlertView[]> {
    const res = await this.client.json<{ alerts: AlertView[] }>("POST", "/v1/console/vigia/run", {
      validate: listOf("alerts", S.AlertView),
    });
    return res.alerts;
  }

  createExpediente(networkId: string): Promise<ExpedienteView> {
    return this.client.json<ExpedienteView>("POST", `/v1/console/networks/${encodeURIComponent(networkId)}/expediente`, {
      validate: S.ExpedienteView,
    });
  }

  getExpediente(id: string): Promise<ExpedienteView> {
    return this.client.json<ExpedienteView>("GET", `/v1/console/expedientes/${encodeURIComponent(id)}`, {
      validate: S.ExpedienteView,
    });
  }

  downloadExpediente(id: string): Promise<Blob> {
    return this.client.blob(`/v1/console/expedientes/${encodeURIComponent(id)}/pdf`);
  }

  async listAudit(opts: { before_seq?: number; limit?: number } = {}): Promise<AuditEntry[]> {
    const res = await this.client.json<{ entries: AuditEntry[] }>("GET", "/v1/console/audit", {
      query: { before_seq: opts.before_seq, limit: opts.limit },
      validate: listOf("entries", S.AuditEntry),
    });
    return res.entries;
  }

  verifyAudit(): Promise<AuditVerifyResponse> {
    return this.client.json<AuditVerifyResponse>("GET", "/v1/console/audit/verify", {
      validate: S.AuditVerifyResponse,
    });
  }

  costs(): Promise<CostsResponse> {
    return this.client.json<CostsResponse>("GET", "/v1/console/costs", { validate: S.CostsResponse });
  }

  async listOrgs(): Promise<OrgView[]> {
    const res = await this.client.json<{ orgs: OrgView[] }>("GET", "/v1/console/orgs");
    return res.orgs;
  }

  createOrg(req: CreateOrgRequest): Promise<OrgView> {
    return this.client.json<OrgView>("POST", "/v1/console/orgs", { body: req });
  }

  async createInvites(req: InvitesRequest): Promise<string[]> {
    const res = await this.client.json<{ codes: string[] }>("POST", "/v1/console/invites", { body: req });
    return res.codes;
  }

  async listUsers(): Promise<UserView[]> {
    const res = await this.client.json<{ users: UserView[] }>("GET", "/v1/console/users");
    return res.users;
  }

  createUser(req: CreateUserRequest): Promise<UserView> {
    return this.client.json<UserView>("POST", "/v1/console/users", { body: req });
  }
}
