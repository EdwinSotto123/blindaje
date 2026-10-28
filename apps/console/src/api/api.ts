import type {
  AlertDecisionRequest,
  AlertStatus,
  AlertView,
  AuditEntry,
  AuditVerifyResponse,
  CaseSide,
  CartografoModel,
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

export interface MediaRange {
  start_ms?: number;
  end_ms?: number;
}

/**
 * Medio protegido descargado. `marca` sale del header `x-blindaje-marca`: "aplicada" si la copia
 * lleva la marca invisible de quien la pidió, "no_aplicada" si no (con `motivo`), null si la API no
 * lo informó (versión anterior).
 */
export interface MediaResult {
  blob: Blob;
  marca: "aplicada" | "no_aplicada" | null;
  motivo: string | null;
}

/**
 * Todo lo que la consola le pide al backend. Lo implementan `HttpApi` (API real, docs/API.md) y
 * `MockApi` (modo simulado con los casos ficticios A, B y C).
 */
export interface BlindajeApi {
  readonly mode: "http" | "mock";

  health(): Promise<HealthResponse>;

  // Sesión
  login(email: string, password: string): Promise<ConsoleUser>;
  /** Recupera la sesión guardada en la pestaña, si existe. */
  restore(): Promise<ConsoleUser | null>;
  logout(): Promise<void>;
  onSessionExpired(cb: () => void): void;

  // Vínculos
  listLinks(status?: LinkStatus[]): Promise<LinkView[]>;
  getLink(id: string): Promise<LinkView>;
  decideLink(id: string, req: LinkDecisionRequest): Promise<LinkView>;
  /** Descarga un medio protegido (audio recortado o imagen redactada), marcado para quien lo pide. */
  fetchMedia(url: string, range?: MediaRange): Promise<MediaResult>;
  /** GET /v1/console/cases/:id (reviewer, analyst): ficha y evidencia de un caso, para resolver citas. */
  getCase(id: string): Promise<CaseSide>;

  // Redes y Cartógrafo
  listNetworks(): Promise<NetworkSummary[]>;
  getNetwork(id: string): Promise<NetworkView>;
  listProfiles(networkId: string): Promise<ProfileView[]>;
  runCartografo(networkId: string, model: CartografoModel): Promise<ProfileView>;
  decideHypothesis(id: string, decision: HypothesisDecision): Promise<HypothesisView>;

  // Alertas
  listAlerts(status?: AlertStatus): Promise<AlertView[]>;
  decideAlert(id: string, req: AlertDecisionRequest): Promise<AlertView>;
  runVigia(): Promise<AlertView[]>;

  // Expedientes
  createExpediente(networkId: string): Promise<ExpedienteView>;
  getExpediente(id: string): Promise<ExpedienteView>;
  downloadExpediente(id: string): Promise<Blob>;

  // Auditoría y costos
  listAudit(opts?: { before_seq?: number; limit?: number }): Promise<AuditEntry[]>;
  verifyAudit(): Promise<AuditVerifyResponse>;
  costs(): Promise<CostsResponse>;

  // Administración
  listOrgs(): Promise<OrgView[]>;
  createOrg(req: CreateOrgRequest): Promise<OrgView>;
  createInvites(req: InvitesRequest): Promise<string[]>;
  listUsers(): Promise<UserView[]>;
  createUser(req: CreateUserRequest): Promise<UserView>;
}
