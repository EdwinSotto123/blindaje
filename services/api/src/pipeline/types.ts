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
 *   tipo "segmentacion"   content_json = SegmentacionContent (cajas de SAM 3.1); `nota` opcional para la víctima.
 *   tipo "frames"         content_json = FramesContent (muestreo de video y mejor cuadro de la placa).
 *   tipo "texto"          r2_key con el texto plano normalizado (AAD = derivative_id); content_json = TextoContent.
 *   tipo "autenticidad"   content_json = ResultadoAutenticidad (packages/shared/src/authenticity.ts). Lo escribe el
 *                         paso `autenticidad` (pipeline/authenticity.ts); los procesadores no lo borran al reprocesar.
 *   tipo "prompt_guard"   content_json = PromptGuardResult (packages/shared/src/injection.ts): Llama Prompt Guard 2 sobre el
 *                         texto que llega a los modelos. Lo escribe el paso `prompt_guard` (pipeline/promptguard.ts).
 *   tipo "recorte"        no se usa como derivado: los recortes van en `image_crops` (r2_key con AAD = crop id).
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

export type DerivativeType =
  | "wav"
  | "transcripcion"
  | "segmentacion"
  | "recorte"
  | "lectura"
  | "redactada"
  | "frames"
  | "texto"
  | "autenticidad"
  | "prompt_guard";

export interface WavContent {
  sample_rate: number;
  channels: 1;
  bits_per_sample: 16;
  duration_ms: number;
}

export interface TranscripcionContent {
  model: string;
  turns: Array<{ speaker: string | null; start_ms: number; end_ms: number; text: string; es_victima: boolean }>;
  /** Huella de voz (V-n) de cada hablante que no es la víctima. */
  huellas?: Record<string, string>;
  /** Nota corta para la víctima, por ejemplo "Separamos tu voz de la de quien te habla". */
  nota?: string | null;
}

export interface LecturaContent {
  texto: string;
  /** Placas leídas (pasan a ser identificadores en la ficha). */
  placas?: string[];
  /** Nota corta para la víctima, por ejemplo "rostros tapados". */
  nota?: string | null;
}

export interface TextoContent {
  source: string | null;
  chars: number;
}

export interface SegmentacionContent {
  /** Idioma de los conceptos enviados a SAM 3.1 (ver docs/devlog/pipeline.md). */
  lang: "en" | "es";
  width: number | null;
  height: number | null;
  objetos: Array<{ concepto: string; box: { x1: number; y1: number; x2: number; y2: number }; score: number | null }>;
  nota?: string | null;
}

export interface FramesContent {
  fps: number;
  frames: number;
  width: number;
  height: number;
  frames_facturados: number;
  placa: { frame: number; box: { x1: number; y1: number; x2: number; y2: number }; score: number | null } | null;
  rostros_en_frames: number;
  nota?: string | null;
}

export interface RedactadaContent {
  regiones: number;
  nota?: string | null;
}

/**
 * Resultado del procesamiento de una evidencia. `skipped` con `reason: "en_proceso"` significa que
 * otro consumidor (la cola o el Workflow) la está procesando en este momento.
 */
export type EvidenceProcessResult = { status: "processed" } | { status: "skipped"; reason: string };

/** Identificadores en claro del caso, cifrados en `cases.identifiers_enc` (AAD = `identifiers:<case_id>`). */
export interface CaseIdentifiersPlain {
  identificadores: Array<{
    tipo: string;
    valor: string;
    normalizado?: string;
    rol?: string;
    evidencia?: string[];
  }>;
}
