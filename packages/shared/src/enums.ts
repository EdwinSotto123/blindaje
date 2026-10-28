import { z } from "zod";

/** Roles del sistema. Ver sección 5.1 del prompt y 12.2 del documento de diseño. */
export const Role = z.enum(["victim", "reviewer", "analyst", "admin", "business"]);
export type Role = z.infer<typeof Role>;

/** Roles que entran por la consola web. */
export const ConsoleRole = z.enum(["reviewer", "analyst", "admin"]);
export type ConsoleRole = z.infer<typeof ConsoleRole>;

/** Niveles de consentimiento (sección 11.2). "solo_denuncia" es el valor por defecto. */
export const ConsentMode = z.enum(["solo_denuncia", "comunitario"]);
export type ConsentMode = z.infer<typeof ConsentMode>;

export const EvidenceType = z.enum(["audio", "imagen", "video", "texto"]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const EvidenceStatus = z.enum(["recibido", "procesando", "procesado", "error"]);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

/**
 * Estados de un caso.
 * borrador: creado, recibiendo evidencia.
 * procesando: la persona tocó "Preparar mi denuncia" y corre el workflow.
 * listo: ficha, cronología y PDF disponibles.
 * error: el workflow falló de forma definitiva (se puede reintentar).
 */
export const CaseStatus = z.enum(["borrador", "procesando", "listo", "error"]);
export type CaseStatus = z.infer<typeof CaseStatus>;

export const Sector = z.enum([
  "bodega",
  "mototaxi",
  "transporte",
  "mercado",
  "restaurante",
  "construccion",
  "otro",
]);
export type Sector = z.infer<typeof Sector>;

export const IdentifierType = z.enum([
  "telefono",
  "cuenta_yape",
  "cuenta_plin",
  "cuenta_bancaria",
  "placa",
]);
export type IdentifierType = z.infer<typeof IdentifierType>;

/** Para qué se usó el identificador dentro del caso. */
export const IdentifierRole = z.enum(["contacto", "cobro", "vehiculo"]);
export type IdentifierRole = z.infer<typeof IdentifierRole>;

/** Estados de un vínculo entre dos casos (sección 9.4). */
export const LinkStatus = z.enum([
  "probable", // puntaje >= umbral alto, arriba en la cola
  "por_revisar", // entre umbral bajo y alto
  "descartado_auto", // < umbral bajo, se guarda para recalibrar, no se muestra
  "confirmado", // un revisor lo confirmó: entra al grafo
  "descartado", // un revisor lo descartó
]);
export type LinkStatus = z.infer<typeof LinkStatus>;

export const LinkDecision = z.enum(["confirmar", "descartar"]);
export type LinkDecision = z.infer<typeof LinkDecision>;

export const SignalKind = z.enum(["identificador", "voz", "imagen", "modus_operandi"]);
export type SignalKind = z.infer<typeof SignalKind>;

export const Confidence = z.enum(["baja", "media", "alta"]);
export type Confidence = z.infer<typeof Confidence>;

export const ReviewStatus = z.enum(["borrador", "aprobado", "rechazado", "invalido"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const HypothesisStatus = z.enum(["borrador", "aprobada", "descartada"]);
export type HypothesisStatus = z.infer<typeof HypothesisStatus>;

export const AlertStatus = z.enum(["borrador", "aprobada", "rechazada"]);
export type AlertStatus = z.infer<typeof AlertStatus>;

export const AgentName = z.enum(["vinculador", "cartografo", "vigia", "redactor", "ficha", "asesor", "autenticidad"]);
export type AgentName = z.infer<typeof AgentName>;

/** Modelos de Meta que usa el sistema. Contributor mode está prohibido para datos de la app. */
export const MetaModel = z.enum([
  "muse-spark-1.3",
  "muse-spark-1.2",
  "muse-wonder-1.0",
  "muse-voice-transcribe-1.0",
  "sam-3.1",
  "muse-image-1.0",
]);
export type MetaModel = z.infer<typeof MetaModel>;
