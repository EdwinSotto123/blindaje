import type * as S from "@blindaje/shared";

/**
 * Tipos de la consola. Todo lo que existe en `@blindaje/shared` se toma de ahí; algunos esquemas
 * de shared no exportan su tipo, así que se infieren del `parse` del esquema (sin importar zod).
 */
type Out<T extends { parse: (value: unknown) => unknown }> = ReturnType<T["parse"]>;

export type {
  AlertStatus,
  AlertView,
  AuditEntry,
  CaseSide,
  Confidence,
  ConsoleLoginResponse,
  ConsoleRole,
  ConsoleUser,
  CostsResponse,
  FichaStored,
  GraphNodeType,
  IdentificadorRef,
  LinkStatus,
  LinkView,
  NetworkSummary,
  NetworkView,
  NivelAutenticidad,
  PerfilRed,
  ProfileView,
  ResultadoAutenticidad,
  ReviewStatus,
  Signals,
  TimelineEvent,
  TokenPair,
  VinculadorOutput,
} from "@blindaje/shared";

export type HypothesisView = Out<typeof S.HypothesisView>;
export type AudioFragment = Out<typeof S.AudioFragment>;
export type GraphNode = Out<typeof S.GraphNode>;
export type GraphEdge = Out<typeof S.GraphEdge>;
export type ExpedienteView = Out<typeof S.ExpedienteView>;
export type AuditVerifyResponse = Out<typeof S.AuditVerifyResponse>;
export type LinkDecisionRequest = Out<typeof S.LinkDecisionRequest>;
export type AlertDecisionRequest = Out<typeof S.AlertDecisionRequest>;
export type HypothesisDecision = Out<typeof S.HypothesisDecisionRequest>["decision"];
export type Afirmacion = Out<typeof S.Afirmacion>;
export type Hipotesis = Out<typeof S.Hipotesis>;

/** Modelos que puede usar el Cartógrafo. */
export type CartografoModel = "muse-spark-1.3" | "muse-wonder-1.0";

// ---------------------------------------------------------------------------
// Rutas sin esquema en shared (propuestas en docs/devlog/console.md)
// ---------------------------------------------------------------------------

/** GET /v1/health → `{ ok, env, version }` (docs/API.md). */
export interface HealthResponse {
  ok: boolean;
  env: string;
  version: string;
}

export type OrgKind = "gremio" | "asociacion_mercado" | "junta_vecinal" | "alianza";

/** GET /v1/console/orgs → `{ orgs: OrgView[] }`. Columnas de `organizations` en D1. */
export interface OrgView {
  id: string;
  name: string;
  kind: OrgKind;
  district: string | null;
  created_at: string;
  is_demo?: boolean;
  /** Celulares registrados (víctimas) y usuarios de consola de la organización. */
  devices?: number;
  users?: number;
}

export interface CreateOrgRequest {
  name: string;
  kind: OrgKind;
  district?: string;
}

/** GET /v1/console/users → `{ users: UserView[] }`. Nunca incluye el hash de la contraseña. */
export interface UserView {
  id: string;
  email: string;
  display_name: string;
  role: "reviewer" | "analyst" | "admin";
  org: { id: string; name: string };
  /** La API no los manda al crear el usuario. */
  disabled?: boolean;
  created_at?: string;
}

export interface CreateUserRequest {
  email: string;
  display_name: string;
  role: "reviewer" | "analyst" | "admin";
  org_id: string;
  password: string;
}

export interface InvitesRequest {
  org_id?: string;
  count: number;
  /** Por defecto 1 uso por código y 30 días de vigencia. */
  max_uses?: number;
  expires_days?: number;
}

/** Mínimo de la API para contraseñas de consola. */
export const MIN_PASSWORD = 12;
