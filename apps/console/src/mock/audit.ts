import type { AuditEntry, AuditVerifyResponse } from "../api/types";
import { sha256Hex } from "./media";

/**
 * Registro encadenado del modo simulado: cada entrada guarda el hash de la anterior y su propio
 * hash = SHA-256(prev_hash | campos canónicos). Cambiar cualquier campo rompe la cadena desde ahí.
 * (La API real define su propia forma canónica; la consola solo muestra lo que devuelve /verify.)
 */

export const GENESIS_HASH = "0".repeat(64);

export type AuditDraft = Omit<AuditEntry, "seq" | "prev_hash" | "hash">;

function canonical(e: Omit<AuditEntry, "hash" | "prev_hash">): string {
  return JSON.stringify([e.seq, e.ts, e.actor_type, e.actor_id, e.action, e.target_type, e.target_id, e.details]);
}

export async function entryHash(prevHash: string, e: Omit<AuditEntry, "hash" | "prev_hash">): Promise<string> {
  return sha256Hex(`${prevHash}|${canonical(e)}`);
}

export async function appendEntry(chain: AuditEntry[], draft: AuditDraft): Promise<AuditEntry> {
  const last = chain[chain.length - 1];
  const seq = (last?.seq ?? 0) + 1;
  const prev_hash = last?.hash ?? GENESIS_HASH;
  const base = { ...draft, seq };
  const entry: AuditEntry = { ...base, prev_hash, hash: await entryHash(prev_hash, base) };
  chain.push(entry);
  return entry;
}

/** Recalcula toda la cadena (en orden ascendente de seq). */
export async function verifyChain(chain: AuditEntry[]): Promise<AuditVerifyResponse> {
  const sorted = [...chain].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (const e of sorted) {
    const { hash, prev_hash, ...rest } = e;
    if (prev_hash !== prev || (await entryHash(prev_hash, rest)) !== hash) {
      return { ok: false, checked: e.seq, head_hash: sorted[sorted.length - 1]?.hash ?? null, broken_at_seq: e.seq };
    }
    prev = hash;
  }
  return { ok: true, checked: sorted.length, head_hash: sorted[sorted.length - 1]?.hash ?? null, broken_at_seq: null };
}

/**
 * Comprobación local de enlaces entre filas cargadas (sin recalcular hashes, que dependen de la
 * forma canónica del servidor): cada `prev_hash` debe ser el `hash` de la fila anterior.
 * Devuelve los seq donde el enlace no cuadra.
 */
export function brokenLinks(entries: AuditEntry[]): number[] {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const out: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.seq === prev.seq + 1 && cur.prev_hash !== prev.hash) out.push(cur.seq);
  }
  return out;
}
