/**
 * Contratos internos del pipeline (M2–M4). Los usa el frente que completa el pipeline.
 *
 * Mensajes de cola
 *   INGESTA      { evidence_id }                       al subir cada evidencia
 *   VINCULACION  { case_id, reason }                   tras indexar un caso con consentimiento comunitario
 *
 * Derivados (tabla `derivatives`): lo que la API lee para el reporte de la víctima y la consola.
 *   tipo "wav"            r2_key = cases/<case_id>/derived/<derivative_id>, cifrado con AAD = derivative_id.
 *                         content_json = WavContent. Lo usa /console/evidence/:id/media para recortar.
 *   tipo "transcripcion"  content_json = TranscripcionContent.
 *   tipo "lectura"        content_json = LecturaContent (texto leído de notas o placas en imágenes).
 *   tipo "redactada"      r2_key de la imagen con terceros tapados (AAD = derivative_id); content_json = RedactadaContent.
 *   tipo "segmentacion"   content_json libre (cajas de SAM 3.1); `nota` opcional para la víctima.
 *   tipo "frames"         content_json libre (muestreo de video).
 */

export interface IngestaMessage {
  evidence_id: string;
}

export interface VinculacionMessage {
  case_id: string;
  reason: "submit" | "consent" | "reindex";
}

export interface ProcesarCasoParams {
  case_id: string;
  /** Seudónimo de quien tocó "Preparar mi denuncia" (para la auditoría). */
  requested_by: string;
}

export interface ProcesarCasoOutput {
  case_id: string;
  ficha: boolean;
  indexed: boolean;
  queued_linking: boolean;
  /** Pasos que todavía son stubs (vacío cuando el pipeline está completo). */
  pending_steps: string[];
}

export type DerivativeType = "wav" | "transcripcion" | "segmentacion" | "recorte" | "lectura" | "redactada" | "frames";

export interface WavContent {
  sample_rate: number;
  channels: 1;
  bits_per_sample: 16;
  duration_ms: number;
}

export interface TranscripcionContent {
  model: string;
  turns: Array<{ speaker: string | null; start_ms: number; end_ms: number; text: string; es_victima: boolean }>;
}

export interface LecturaContent {
  texto: string;
  /** Nota corta para la víctima, por ejemplo "rostros tapados". */
  nota?: string | null;
}

export interface RedactadaContent {
  regiones: number;
  nota?: string | null;
}

/** Resultado del procesamiento de una evidencia. */
export type EvidenceProcessResult = { status: "processed" } | { status: "skipped"; reason: string };

/** Identificadores en claro del caso, cifrados en `cases.identifiers_enc` (AAD = `identifiers:<case_id>`). */
export interface CaseIdentifiersPlain {
  identificadores: Array<{ tipo: string; valor: string }>;
}
