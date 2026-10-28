import type { AuditEntry } from "@blindaje/shared";
import { canonicalJson } from "../lib/canonical";
import { sha256Hex } from "../lib/crypto";
import type { ActorType } from "../types";

/**
 * Auditoría encadenada (sección 7.1 y 12.2).
 *
 *   hash = SHA-256( prev_hash || JSON_canónico(entrada) )   (concatenación de texto, hash en hex)
 *
 * donde entrada = { ts, actor_type, actor_id, action, target_type, target_id, details }.
 * La primera fila (génesis) usa prev_hash = 64 ceros. `seq` no entra en el hash: lo asigna D1.
 */

export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  actor_type: ActorType;
  actor_id: string;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  /** Nunca datos sensibles: ids, etiquetas, hashes, conteos. */
  details?: Record<string, unknown> | null;
}

export interface AuditHashable {
  ts: string;
  actor_type: string;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
}

export function toHashable(input: AuditInput, ts: string): AuditHashable {
  return {
    ts,
    actor_type: input.actor_type,
    actor_id: input.actor_id,
    action: input.action,
    target_type: input.target_type ?? null,
    target_id: input.target_id ?? null,
    details: input.details ?? null,
  };
}

export function computeAuditHash(prevHash: string, entry: AuditHashable): Promise<string> {
  return sha256Hex(prevHash + canonicalJson(entry));
}

export interface AuditRow {
  seq: number;
  ts: string;
  actor_type: string;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  prev_hash: string;
  hash: string;
}

export function rowToEntry(r: AuditRow): AuditEntry {
  let details: Record<string, unknown> | null = null;
  if (r.details_json) {
    try {
      details = JSON.parse(r.details_json) as Record<string, unknown>;
    } catch {
      details = { _invalid_json: true };
    }
  }
  return {
    seq: r.seq,
    ts: r.ts,
    actor_type: r.actor_type as AuditEntry["actor_type"],
    actor_id: r.actor_id,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    details,
    prev_hash: r.prev_hash,
    hash: r.hash,
  };
}

/** Recalcula el hash de una fila guardada. */
export async function rowHash(r: AuditRow): Promise<string> {
  let details: Record<string, unknown> | null = null;
  if (r.details_json) details = JSON.parse(r.details_json) as Record<string, unknown>;
  return computeAuditHash(r.prev_hash, {
    ts: r.ts,
    actor_type: r.actor_type,
    actor_id: r.actor_id,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    details,
  });
}
