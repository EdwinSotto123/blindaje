import { DurableObject } from "cloudflare:workers";
import type { AuditEntry } from "@blindaje/shared";
import type { Env } from "../env";
import { canonicalJson } from "../lib/canonical";
import { GENESIS_HASH, computeAuditHash, toHashable, type AuditInput } from "../audit/chain";

export interface AuditHead {
  seq: number;
  hash: string;
}

/**
 * Singleton (`idFromName("global")`) que serializa la escritura de la auditoría encadenada.
 *
 * Las esperas a D1 abren la compuerta de entrada del Durable Object, así que dos peticiones
 * podrían intercalarse y leer la misma cabeza: el mutex (cadena de promesas) lo impide y la
 * cadena nunca se bifurca. Además guarda la última cabeza en su almacenamiento SQLite como ancla:
 * la verificación la compara con D1 para detectar que alguien borró las últimas filas.
 */
export class AuditChain extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();

  append(input: AuditInput): Promise<AuditEntry> {
    const run = this.tail.then(() => this.doAppend(input));
    // La cola sigue aunque una escritura falle.
    this.tail = run.catch(() => undefined);
    return run;
  }

  head(): AuditHead | null {
    return this.ctx.storage.kv.get<AuditHead>("head") ?? null;
  }

  /** Solo para pruebas y para el reinicio completo de la base de un entorno de desarrollo. */
  resetAnchor(): void {
    this.ctx.storage.kv.delete("head");
  }

  private async doAppend(input: AuditInput): Promise<AuditEntry> {
    const last = await this.env.DB.prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1").first<{
      seq: number;
      hash: string;
    }>();
    const prevHash = last?.hash ?? GENESIS_HASH;
    const ts = new Date().toISOString();
    const hashable = toHashable(input, ts);
    const hash = await computeAuditHash(prevHash, hashable);
    const detailsJson = hashable.details ? canonicalJson(hashable.details) : null;
    const row = await this.env.DB.prepare(
      `INSERT INTO audit_log (ts, actor_type, actor_id, action, target_type, target_id, details_json, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
    )
      .bind(ts, hashable.actor_type, hashable.actor_id, hashable.action, hashable.target_type, hashable.target_id, detailsJson, prevHash, hash)
      .first<{ seq: number }>();
    if (!row) throw new Error("audit_insert_failed");
    this.ctx.storage.kv.put("head", { seq: row.seq, hash } satisfies AuditHead);
    return {
      seq: row.seq,
      ts,
      actor_type: hashable.actor_type as AuditEntry["actor_type"],
      actor_id: hashable.actor_id,
      action: hashable.action,
      target_type: hashable.target_type,
      target_id: hashable.target_id,
      details: hashable.details,
      prev_hash: prevHash,
      hash,
    };
  }
}
