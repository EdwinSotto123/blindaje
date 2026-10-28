import { evidenceLabel, type EvidenceItem, type EvidenceType } from "@blindaje/shared";
import type { Env } from "../env";
import { audit } from "../audit";
import { ApiError } from "../lib/errors";
import { getDecrypted, putEncrypted, sha256Hex } from "../lib/crypto";
import { isUniqueViolation } from "../lib/db";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import type { Actor } from "../types";

export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;

export interface EvidenceRow {
  id: string;
  case_id: string;
  label: string;
  seq: number;
  tipo: EvidenceType;
  mime: string;
  size_bytes: number;
  sha256: string;
  sha256_client: string;
  received_utc: string;
  captured_at: string | null;
  source: string | null;
  duration_ms: number | null;
  r2_key: string;
  uploader_pseudonym: string;
  status: "recibido" | "procesando" | "procesado" | "error";
  error: string | null;
}

export function evidenceR2Key(caseId: string, evidenceId: string): string {
  return `cases/${caseId}/evidence/${evidenceId}`;
}

export function derivativeR2Key(caseId: string, derivativeId: string): string {
  return `cases/${caseId}/derived/${derivativeId}`;
}

export function caseR2Prefix(caseId: string): string {
  return `cases/${caseId}/`;
}

export function toEvidenceItem(r: EvidenceRow): EvidenceItem {
  return {
    id: r.id,
    label: r.label,
    tipo: r.tipo,
    mime: r.mime,
    size_bytes: r.size_bytes,
    sha256: r.sha256,
    received_utc: r.received_utc,
    captured_at: r.captured_at,
    duration_ms: r.duration_ms,
    status: r.status,
  };
}

export interface StoreEvidenceInput {
  caseId: string;
  caseCode: string;
  uploaderPseudonym: string;
  actor: Actor;
  bytes: ArrayBuffer;
  tipo: EvidenceType;
  mime: string;
  sha256Client: string;
  capturedAt?: string | null;
  source?: string | null;
  durationMs?: number | null;
}

/**
 * Registra una evidencia: SHA-256 en el servidor (422 si no coincide con el del dispositivo),
 * cifrado AES-256-GCM en R2, fila en D1 con etiqueta EV-…, cadena de custodia en la auditoría y
 * mensaje a la cola INGESTA. Idempotente por (caso, SHA-256): reintentar la misma subida devuelve
 * la evidencia existente (`created: false`), útil para la cola sin conexión del celular.
 */
export async function storeEvidence(env: Env, input: StoreEvidenceInput): Promise<{ item: EvidenceItem; created: boolean }> {
  if (input.bytes.byteLength === 0) throw new ApiError("bad_request", "El archivo está vacío");
  if (input.bytes.byteLength > MAX_EVIDENCE_BYTES) throw new ApiError("payload_too_large", "El archivo supera 50 MB");
  const sha256 = await sha256Hex(input.bytes);
  if (sha256 !== input.sha256Client.toLowerCase()) {
    log("warn", "evidence_integrity_mismatch", { case_id: input.caseId, size: input.bytes.byteLength });
    throw new ApiError("integrity_mismatch", "El archivo llegó distinto de como salió del celular. Vuelve a enviarlo.", {
      details: { sha256_server: sha256 },
    });
  }

  const dup = await env.DB.prepare("SELECT * FROM evidence WHERE case_id = ? AND sha256 = ?").bind(input.caseId, sha256).first<EvidenceRow>();
  if (dup) return { item: toEvidenceItem(dup), created: false };

  const id = newId();
  const r2Key = evidenceR2Key(input.caseId, id);
  await putEncrypted(env.EVIDENCE, r2Key, env.EVIDENCE_ENCRYPTION_KEY, input.bytes, id, { evidence_id: id });

  const receivedUtc = nowIso();
  let row: EvidenceRow | null = null;
  for (let attempt = 0; attempt < 4 && !row; attempt++) {
    const next = await env.DB.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM evidence WHERE case_id = ?")
      .bind(input.caseId)
      .first<{ seq: number }>();
    const seq = next?.seq ?? 1;
    const label = evidenceLabel(input.caseCode, seq);
    try {
      row = await env.DB.prepare(
        `INSERT INTO evidence (id, case_id, label, seq, tipo, mime, size_bytes, sha256, sha256_client, received_utc,
           captured_at, source, duration_ms, r2_key, uploader_pseudonym, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recibido') RETURNING *`,
      )
        .bind(
          id,
          input.caseId,
          label,
          seq,
          input.tipo,
          input.mime,
          input.bytes.byteLength,
          sha256,
          input.sha256Client.toLowerCase(),
          receivedUtc,
          input.capturedAt ?? null,
          input.source ?? null,
          input.durationMs ?? null,
          r2Key,
          input.uploaderPseudonym,
        )
        .first<EvidenceRow>();
    } catch (err) {
      if (!isUniqueViolation(err)) {
        await env.EVIDENCE.delete(r2Key);
        throw err;
      }
      // Otra subida concurrente tomó el mismo número: reintentar. Si fue el mismo archivo, devolverlo.
      const again = await env.DB.prepare("SELECT * FROM evidence WHERE case_id = ? AND sha256 = ?").bind(input.caseId, sha256).first<EvidenceRow>();
      if (again) {
        await env.EVIDENCE.delete(r2Key);
        return { item: toEvidenceItem(again), created: false };
      }
    }
  }
  if (!row) {
    await env.EVIDENCE.delete(r2Key);
    throw new ApiError("conflict", "No se pudo registrar la evidencia, intenta de nuevo");
  }

  await env.DB.prepare("UPDATE cases SET updated_at = ? WHERE id = ?").bind(receivedUtc, input.caseId).run();
  await audit(env, {
    ...input.actor,
    action: "evidence.upload",
    target_type: "evidence",
    target_id: id,
    details: {
      case_id: input.caseId,
      label: row.label,
      tipo: row.tipo,
      sha256,
      size_bytes: row.size_bytes,
      received_utc: receivedUtc,
      uploader: input.uploaderPseudonym,
    },
  });
  try {
    await env.INGESTA.send({ evidence_id: id });
  } catch (err) {
    // La evidencia ya está a salvo; el Workflow la procesa igual al preparar la denuncia.
    log("error", "ingesta_enqueue_failed", { evidence_id: id, ...errorFields(err) });
  }
  return { item: toEvidenceItem(row), created: true };
}

/** Descifra el original de una evidencia (solo en memoria). */
export async function readEvidencePlain(env: Env, row: Pick<EvidenceRow, "id" | "r2_key">): Promise<ArrayBuffer | null> {
  return getDecrypted(env.EVIDENCE, row.r2_key, env.EVIDENCE_ENCRYPTION_KEY, row.id);
}

/** Descifra un derivado binario (WAV, imagen tapada…). */
export async function readDerivativePlain(env: Env, d: { id: string; r2_key: string | null }): Promise<ArrayBuffer | null> {
  if (!d.r2_key) return null;
  return getDecrypted(env.EVIDENCE, d.r2_key, env.EVIDENCE_ENCRYPTION_KEY, d.id);
}

/** Borra todos los objetos de R2 bajo un prefijo (paginado). */
export async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) {
      await bucket.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
