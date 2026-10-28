import type { FichaStored } from "@blindaje/shared";
import type { Env } from "../env";
import type { EvidenceProcessResult } from "./types";

/**
 * Pasos del pipeline por evidencia y por caso. STUBS: el frente de pipeline (M2) los reemplaza.
 * Reglas para implementarlos:
 * - Idempotentes: el Workflow y la cola pueden reintentar cualquier paso.
 * - Antes de llamar a Meta: `createMetaHooks(env).beforeCall(...)` (presupuesto) y después
 *   `onUsage(...)` (costos). Cachear por hash con `withCostCache`.
 * - Evidencia en claro solo en memoria: `readEvidencePlain(env, row)`; derivados binarios con
 *   `putEncrypted(..., aad = derivative_id)`.
 * - Nada de datos de la víctima en la ficha. Identificadores: HMAC con HMAC_ALLIANCE_KEY
 *   (`importAllianceKey`, `hmacIdentifier` de @blindaje/shared) y en claro solo cifrados en
 *   `cases.identifiers_enc` (ver CaseIdentifiersPlain).
 */

/**
 * Procesa una evidencia al llegar (cola INGESTA): normalizar audio, transcribir, huellas de voz,
 * SAM 3.1 e imágenes, lectura de texto. Devuelve "processed" cuando terminó.
 */
export async function processEvidence(_env: Env, _evidenceId: string): Promise<EvidenceProcessResult> {
  return { status: "skipped", reason: "pipeline_pendiente" };
}

/** Consolida la ficha del caso con Muse Spark (sección 7.3). Devuelve null si todavía no hay pipeline. */
export async function buildFicha(_env: Env, _caseId: string): Promise<FichaStored | null> {
  return null;
}

/** Normaliza, aplica HMAC y guarda los identificadores del caso (sección 7.5). */
export async function storeIdentifiers(_env: Env, _caseId: string): Promise<{ count: number; stub: boolean }> {
  return { count: 0, stub: true };
}
