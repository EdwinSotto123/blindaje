import type { AuditEntry } from "@blindaje/shared";
import type { Env } from "../env";
import type { AuditHead } from "../do/audit-chain";
import { GENESIS_HASH, rowHash, rowToEntry, type AuditInput, type AuditRow } from "./chain";

export type { AuditInput } from "./chain";
export { GENESIS_HASH, computeAuditHash } from "./chain";

function chain(env: Env) {
  return env.AUDIT_CHAIN.get(env.AUDIT_CHAIN.idFromName("global"));
}

/** Agrega una entrada a la auditoría encadenada (serializada por el Durable Object AuditChain). */
export async function audit(env: Env, input: AuditInput): Promise<AuditEntry> {
  return chain(env).append(input);
}

export async function auditHead(env: Env): Promise<AuditHead | null> {
  return chain(env).head();
}

export async function listAudit(env: Env, opts: { before_seq?: number; limit: number }): Promise<AuditEntry[]> {
  const stmt = opts.before_seq
    ? env.DB.prepare("SELECT * FROM audit_log WHERE seq < ? ORDER BY seq DESC LIMIT ?").bind(opts.before_seq, opts.limit)
    : env.DB.prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?").bind(opts.limit);
  const { results } = await stmt.all<AuditRow>();
  return results.map(rowToEntry);
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  head_hash: string | null;
  broken_at_seq: number | null;
}

/**
 * Recorre toda la cadena en orden: cada fila debe apuntar al hash de la anterior y su hash debe
 * coincidir con el recalculado. Al final compara con el ancla del Durable Object (detecta que
 * alguien borró filas del final).
 */
export async function verifyAuditChain(env: Env, pageSize = 500): Promise<AuditVerifyResult> {
  let prev = GENESIS_HASH;
  let lastSeq = 0;
  let checked = 0;
  const hashesBySeq = new Map<number, string>();
  const anchor = await auditHead(env);
  for (;;) {
    const { results } = await env.DB.prepare("SELECT * FROM audit_log WHERE seq > ? ORDER BY seq ASC LIMIT ?")
      .bind(lastSeq, pageSize)
      .all<AuditRow>();
    if (!results.length) break;
    for (const r of results) {
      checked++;
      if (r.prev_hash !== prev) return { ok: false, checked, head_hash: prev, broken_at_seq: r.seq };
      let recomputed: string;
      try {
        recomputed = await rowHash(r);
      } catch {
        return { ok: false, checked, head_hash: prev, broken_at_seq: r.seq };
      }
      if (recomputed !== r.hash) return { ok: false, checked, head_hash: prev, broken_at_seq: r.seq };
      prev = r.hash;
      lastSeq = r.seq;
      if (anchor && r.seq === anchor.seq) hashesBySeq.set(r.seq, r.hash);
    }
  }
  if (anchor) {
    const atAnchor = hashesBySeq.get(anchor.seq);
    if (atAnchor !== anchor.hash) {
      return { ok: false, checked, head_hash: checked ? prev : null, broken_at_seq: anchor.seq };
    }
  }
  return { ok: true, checked, head_hash: checked ? prev : null, broken_at_seq: null };
}
