// ARCHIVO GENERADO, NO EDITAR.
// Copia de packages/shared/src hecha por apps/mobile/scripts/sync-shared.mjs.
// Para cambiar un contrato, edita packages/shared y corre `npm run sync-shared`.
/* eslint-disable */

import { z } from "zod";
import {
  AlertStatus,
  CaseStatus,
  ConsentMode,
  ConsoleRole,
  EvidenceStatus,
  EvidenceType,
  HypothesisStatus,
  LinkDecision,
  LinkStatus,
  ReviewStatus,
  Role,
  Sector,
} from "./enums";
import { FichaStored } from "./ficha";
import { AlertaBorrador, PerfilRed, VinculadorOutput } from "./agents";
import { Signals } from "./linking";

/**
 * Contrato de la API (services/api). Detalle de rutas en docs/API.md.
 * Base: /v1. Errores: { error: { code, message, details? } }.
 */

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const ErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "payload_too_large",
  "integrity_mismatch",
  "budget_exceeded",
  "upstream_error",
  "internal",
  "demo_disabled",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

/** Llave pública P-256 del dispositivo en formato JWK. */
export const DevicePublicKey = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string(),
  y: z.string(),
});

export const DeviceRegisterRequest = z.object({
  invite_code: z.string().min(4).max(32),
  public_key: DevicePublicKey,
  platform: z.enum(["android", "ios", "web"]),
});
export type DeviceRegisterRequest = z.infer<typeof DeviceRegisterRequest>;

export const TokenPair = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().describe("Segundos de vida del access token"),
});
export type TokenPair = z.infer<typeof TokenPair>;

export const DeviceRegisterResponse = TokenPair.extend({
  device_id: z.string(),
  pseudonym: z.string().describe("Seudónimo de la víctima, por ejemplo V-7F3K"),
  org: z.object({ id: z.string(), name: z.string() }),
});
export type DeviceRegisterResponse = z.infer<typeof DeviceRegisterResponse>;

/**
 * Refresh de dispositivo: además del refresh token, el dispositivo firma
 * `refresh:${device_id}:${timestamp}` con su llave privada (ECDSA P-256 / SHA-256,
 * firma en formato IEEE P1363 en base64url). Un refresh token robado no basta.
 */
export const DeviceRefreshRequest = z.object({
  device_id: z.string(),
  refresh_token: z.string(),
  timestamp: z.number().describe("Unix ms; se acepta ±5 minutos"),
  signature: z.string(),
});
export type DeviceRefreshRequest = z.infer<typeof DeviceRefreshRequest>;

export const ConsoleLoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type ConsoleLoginRequest = z.infer<typeof ConsoleLoginRequest>;

export const ConsoleUser = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  role: ConsoleRole,
  org: z.object({ id: z.string(), name: z.string() }),
});
export type ConsoleUser = z.infer<typeof ConsoleUser>;

export const ConsoleLoginResponse = TokenPair.extend({ user: ConsoleUser });
export type ConsoleLoginResponse = z.infer<typeof ConsoleLoginResponse>;

export const ConsoleRefreshRequest = z.object({ refresh_token: z.string() });

/** Claims del JWT de acceso. */
export const JwtClaims = z.object({
  sub: z.string().describe("device_id o user_id"),
  role: Role,
  org: z.string(),
  pse: z.string().optional().describe("Seudónimo, solo víctimas"),
  iat: z.number(),
  exp: z.number(),
});
export type JwtClaims = z.infer<typeof JwtClaims>;

// ---------------------------------------------------------------------------
// Víctima
// ---------------------------------------------------------------------------

export const CreateCaseRequest = z.object({
  sector: Sector.optional(),
  /** Distrito o cuadrícula. Nunca una dirección. */
  zona: z.string().max(80).optional(),
  consent_mode: ConsentMode.default("solo_denuncia"),
});
export type CreateCaseRequest = z.infer<typeof CreateCaseRequest>;

export const CaseSummary = z.object({
  id: z.string(),
  code: z.string(),
  status: CaseStatus,
  consent_mode: ConsentMode,
  created_at: z.string(),
  updated_at: z.string(),
  evidence_count: z.number(),
});
export type CaseSummary = z.infer<typeof CaseSummary>;

/**
 * Subida de evidencia: POST /v1/cases/:id/evidence con el archivo como cuerpo crudo.
 * Headers obligatorios:
 *   content-type        tipo MIME del archivo
 *   x-evidence-type     audio | imagen | video | texto
 *   x-content-sha256    SHA-256 hex calculado en el dispositivo
 * Opcionales:
 *   x-captured-at       ISO 8601: cuándo se recibió o grabó en el celular
 *   x-source            grabacion | compartido | camara | galeria | pegado
 *   x-duration-ms       duración de audio o video
 * El servidor recalcula el SHA-256 y responde 422 integrity_mismatch si no coincide.
 */
export const EvidenceUploadHeaders = z.object({
  "x-evidence-type": EvidenceType,
  "x-content-sha256": z.string().regex(/^[0-9a-f]{64}$/),
  "x-captured-at": z.string().optional(),
  "x-source": z.enum(["grabacion", "compartido", "camara", "galeria", "pegado", "relato"]).optional(),
  "x-duration-ms": z.coerce.number().optional(),
});

export const EvidenceItem = z.object({
  id: z.string(),
  label: z.string().describe("EV-A1"),
  tipo: EvidenceType,
  mime: z.string(),
  size_bytes: z.number(),
  sha256: z.string(),
  received_utc: z.string(),
  captured_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  status: EvidenceStatus,
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const SubmitCaseRequest = z.object({
  /** "Cuéntanos qué pasó" (paso 2 del recorrido). El servidor lo guarda como evidencia de tipo texto con source "relato", cifrada y con su SHA-256. */
  narrative: z.string().max(8000).optional(),
});
export type SubmitCaseRequest = z.infer<typeof SubmitCaseRequest>;

export const SubmitCaseResponse = z.object({
  case_id: z.string(),
  status: CaseStatus,
});

export const TimelineEvent = z.object({
  fecha: z.string(),
  texto: z.string(),
  evidencia: z.array(z.string()),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const TranscriptTurn = z.object({
  speaker: z.string().nullable(),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
  es_victima: z.boolean(),
});

/**
 * Reporte propio de la víctima. NUNCA incluye vínculos, redes, coincidencias,
 * puntajes ni datos de otros casos. Los tests de services/api lo garantizan.
 */
export const VictimReport = z
  .object({
    case_id: z.string(),
    code: z.string(),
    status: CaseStatus,
    consent_mode: ConsentMode,
    hallazgos: z.array(z.string()),
    ficha: z
      .object({
        sector: z.string().nullable(),
        zona: z.string().nullable(),
        primer_contacto: z.string().nullable(),
        amenaza: z.string().nullable(),
        monto_soles: z.number().nullable(),
        plazo: z.string().nullable(),
        canal_pago: z.string().nullable(),
        grupo_que_dice_ser: z.string().nullable(),
        frases_firma: z.array(z.string()),
        /** Los números y cuentas que contactaron a esta persona, en claro: son de su propio caso. */
        identificadores: z.array(z.object({ tipo: z.string(), valor: z.string() })),
        resumen: z.string().nullable(),
      })
      .nullable(),
    cronologia: z.array(TimelineEvent),
    evidencia: z.array(
      EvidenceItem.extend({
        transcripcion: z.array(TranscriptTurn).nullable(),
        nota: z.string().nullable().describe("Por ejemplo: rostros tapados"),
      }),
    ),
    updated_at: z.string(),
  })
  .strict();
export type VictimReport = z.infer<typeof VictimReport>;

export const ConsentRequest = z.object({ mode: ConsentMode });

export const VictimAlert = z.object({
  id: z.string(),
  titulo: z.string(),
  cuerpo: z.string(),
  zona: z.string(),
  que_hacer: z.array(z.string()),
  approved_at: z.string(),
});
export type VictimAlert = z.infer<typeof VictimAlert>;

// ---------------------------------------------------------------------------
// Consola
// ---------------------------------------------------------------------------

export const CaseSide = z.object({
  id: z.string(),
  code: z.string(),
  sector: z.string().nullable(),
  zona: z.string().nullable(),
  primer_contacto: z.string().nullable(),
  ficha: FichaStored.nullable(),
  evidencia: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      tipo: EvidenceType,
      sha256: z.string(),
      received_utc: z.string(),
      duration_ms: z.number().nullable(),
    }),
  ),
});
export type CaseSide = z.infer<typeof CaseSide>;

/** Fragmento de audio relevante para el revisor. media_url requiere token de consola. */
export const AudioFragment = z.object({
  evidence_label: z.string(),
  evidence_id: z.string(),
  voice_label: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string().nullable(),
  media_url: z.string(),
});

export const LinkView = z.object({
  id: z.string(),
  label: z.string().describe("VIN-12"),
  status: LinkStatus,
  score: z.number(),
  score_raw: z.number().describe("Antes del ajuste del Vinculador"),
  signals: Signals,
  vinculador: VinculadorOutput.nullable(),
  vinculador_valid: z.boolean().nullable(),
  case_a: CaseSide,
  case_b: CaseSide,
  fragments: z.array(AudioFragment),
  created_at: z.string(),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  review_note: z.string().nullable(),
});
export type LinkView = z.infer<typeof LinkView>;

export const LinkDecisionRequest = z.object({
  decision: LinkDecision,
  note: z.string().max(1000).optional(),
});

export const GraphNodeType = z.enum(["caso", "voz", "identificador", "frase", "imagen"]);
export type GraphNodeType = z.infer<typeof GraphNodeType>;

export const GraphNode = z.object({
  id: z.string(),
  type: GraphNodeType,
  label: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export const GraphEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(["vinculo", "senal"]),
  label: z.string().optional(),
  weight: z.number().optional(),
});

export const NetworkSummary = z.object({
  id: z.string(),
  label: z.string().describe("R-001"),
  n_cases: z.number(),
  sectores: z.array(z.string()),
  periodo: z.string().nullable(),
  updated_at: z.string(),
  profile_status: ReviewStatus.nullable(),
});
export type NetworkSummary = z.infer<typeof NetworkSummary>;

export const NetworkView = NetworkSummary.extend({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  timeline: z.array(TimelineEvent.extend({ caso: z.string() })),
  links: z.array(z.object({ id: z.string(), label: z.string(), case_a: z.string(), case_b: z.string(), score: z.number() })),
});
export type NetworkView = z.infer<typeof NetworkView>;

export const HypothesisView = z.object({
  id: z.string(),
  texto: z.string(),
  confianza: z.enum(["baja", "media", "alta"]),
  evidencia: z.array(z.string()),
  status: HypothesisStatus,
  reviewed_by: z.string().nullable(),
});

export const ProfileView = z.object({
  id: z.string(),
  network_id: z.string(),
  status: ReviewStatus,
  model: z.string(),
  perfil: PerfilRed,
  hypotheses: z.array(HypothesisView),
  citation_check: z.object({ ok: z.boolean(), sin_cita: z.array(z.string()), citas_inexistentes: z.array(z.string()) }),
  created_at: z.string(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const HypothesisDecisionRequest = z.object({ decision: z.enum(["aprobar", "descartar"]) });

export const AlertView = z.object({
  id: z.string(),
  org_id: z.string(),
  /** Nombre de la organización (aditivo: puede faltar en respuestas antiguas). */
  org_name: z.string().nullable().optional(),
  status: AlertStatus,
  borrador: AlertaBorrador,
  network_id: z.string().nullable(),
  created_at: z.string(),
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
  image_url: z.string().nullable(),
});
export type AlertView = z.infer<typeof AlertView>;

export const AlertDecisionRequest = z.object({
  decision: z.enum(["aprobar", "rechazar"]),
  /** El gremio puede editar el texto antes de aprobar. */
  titulo: z.string().optional(),
  cuerpo: z.string().optional(),
});

export const ExpedienteView = z.object({
  id: z.string(),
  network_id: z.string(),
  status: z.enum(["generando", "listo", "error"]),
  sha256: z.string().nullable(),
  created_at: z.string(),
  download_url: z.string().nullable(),
});

export const AuditEntry = z.object({
  seq: z.number(),
  ts: z.string(),
  actor_type: z.enum(["victim", "reviewer", "analyst", "admin", "system"]),
  actor_id: z.string(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  prev_hash: z.string(),
  hash: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditVerifyResponse = z.object({
  ok: z.boolean(),
  checked: z.number(),
  head_hash: z.string().nullable(),
  broken_at_seq: z.number().nullable(),
});

export const CostsResponse = z.object({
  total_usd: z.number(),
  budget_usd: z.number(),
  pct: z.number(),
  nonessential_blocked: z.boolean(),
  by_model: z.array(z.object({ model: z.string(), calls: z.number(), cost_usd: z.number(), units: z.record(z.string(), z.number()) })),
  by_day: z.array(z.object({ day: z.string(), cost_usd: z.number() })),
  recent: z.array(
    z.object({ ts: z.string(), model: z.string(), operation: z.string(), cost_usd: z.number(), status: z.string() }),
  ),
});
export type CostsResponse = z.infer<typeof CostsResponse>;

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

export const PilotRequest = z.object({
  org_name: z.string().min(2).max(160),
  contact_name: z.string().min(2).max(120),
  contact: z.string().min(5).max(160).describe("Correo o teléfono"),
  sector: z.string().max(80).optional(),
  district: z.string().max(80).optional(),
  members: z.coerce.number().int().min(0).max(1_000_000).optional(),
  message: z.string().max(2000).optional(),
  lang: z.enum(["es", "en"]).default("es"),
  turnstile_token: z.string().min(1),
});
export type PilotRequest = z.infer<typeof PilotRequest>;
