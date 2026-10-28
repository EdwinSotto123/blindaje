import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { audit, computeAuditHash, GENESIS_HASH, verifyAuditChain } from "../src/audit";
import { canonicalJson } from "../src/lib/canonical";
import { apiJson, loginAs, seedOrg } from "./helpers";

describe("JSON canónico", () => {
  it("ordena claves y omite undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, "x"], c: null }, e: undefined })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}');
  });
});

describe("auditoría encadenada", () => {
  it("encadena con SHA-256(prev_hash || JSON canónico) desde el génesis", async () => {
    const first = await audit(env, { actor_type: "system", actor_id: "test", action: "test.uno", details: { n: 1 } });
    const second = await audit(env, { actor_type: "system", actor_id: "test", action: "test.dos", target_type: "case", target_id: "x" });
    expect(second.prev_hash).toBe(first.hash);
    const firstRow = await env.DB.prepare("SELECT MIN(seq) AS seq FROM audit_log").first<{ seq: number }>();
    const genesis = await env.DB.prepare("SELECT prev_hash FROM audit_log WHERE seq = ?").bind(firstRow!.seq).first<{ prev_hash: string }>();
    expect(genesis!.prev_hash).toBe(GENESIS_HASH);
    const expected = await computeAuditHash(first.hash, {
      ts: second.ts,
      actor_type: "system",
      actor_id: "test",
      action: "test.dos",
      target_type: "case",
      target_id: "x",
      details: null,
    });
    expect(second.hash).toBe(expected);
  });

  it("no se bifurca con escrituras concurrentes", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => audit(env, { actor_type: "system", actor_id: "test", action: "test.concurrente", details: { i } })),
    );
    const { results } = await env.DB.prepare("SELECT prev_hash FROM audit_log").all<{ prev_hash: string }>();
    expect(new Set(results.map((r) => r.prev_hash)).size).toBe(results.length);
    const v = await verifyAuditChain(env);
    expect(v.ok).toBe(true);
    expect(v.broken_at_seq).toBeNull();
  });

  it("detecta alteraciones y truncamiento, y el endpoint lo reporta", async () => {
    const { orgId } = await seedOrg();
    const admin = await loginAs("admin", orgId);
    const target = await audit(env, { actor_type: "system", actor_id: "test", action: "test.alterable", details: { monto: 2000 } });
    await audit(env, { actor_type: "system", actor_id: "test", action: "test.siguiente" });

    const ok = await apiJson<{ ok: boolean; checked: number; head_hash: string }>("/v1/console/audit/verify", { token: admin.token });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.checked).toBeGreaterThan(2);

    // Alterar el contenido de una fila.
    const original = await env.DB.prepare("SELECT details_json FROM audit_log WHERE seq = ?").bind(target.seq).first<{ details_json: string }>();
    await env.DB.prepare("UPDATE audit_log SET details_json = ? WHERE seq = ?").bind('{"monto":20}', target.seq).run();
    const broken = await apiJson<{ ok: boolean; broken_at_seq: number }>("/v1/console/audit/verify", { token: admin.token });
    expect(broken.body.ok).toBe(false);
    expect(broken.body.broken_at_seq).toBe(target.seq);

    // Alterar contenido y hash: se rompe el enlace con la fila siguiente.
    const forged = await computeAuditHash(target.prev_hash, {
      ts: target.ts,
      actor_type: "system",
      actor_id: "test",
      action: "test.alterable",
      target_type: null,
      target_id: null,
      details: { monto: 20 },
    });
    await env.DB.prepare("UPDATE audit_log SET hash = ? WHERE seq = ?").bind(forged, target.seq).run();
    const broken2 = await verifyAuditChain(env);
    expect(broken2.ok).toBe(false);
    expect(broken2.broken_at_seq).toBe(target.seq + 1);

    // Restaurar.
    await env.DB.prepare("UPDATE audit_log SET details_json = ?, hash = ? WHERE seq = ?").bind(original!.details_json, target.hash, target.seq).run();
    expect((await verifyAuditChain(env)).ok).toBe(true);

    // Borrar la última fila (truncamiento): el ancla del Durable Object lo detecta.
    const last = await audit(env, { actor_type: "system", actor_id: "test", action: "test.ultima" });
    const saved = await env.DB.prepare("SELECT * FROM audit_log WHERE seq = ?").bind(last.seq).first<Record<string, unknown>>();
    await env.DB.prepare("DELETE FROM audit_log WHERE seq = ?").bind(last.seq).run();
    const truncated = await verifyAuditChain(env);
    expect(truncated.ok).toBe(false);
    expect(truncated.broken_at_seq).toBe(last.seq);
    await env.DB.prepare(
      "INSERT INTO audit_log (seq, ts, actor_type, actor_id, action, target_type, target_id, details_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(saved!.seq, saved!.ts, saved!.actor_type, saved!.actor_id, saved!.action, saved!.target_type, saved!.target_id, saved!.details_json, saved!.prev_hash, saved!.hash)
      .run();
    expect((await verifyAuditChain(env)).ok).toBe(true);

    const entries = await apiJson<{ entries: Array<{ seq: number; hash: string }> }>("/v1/console/audit?limit=5", { token: admin.token });
    expect(entries.body.entries).toHaveLength(5);
    expect(entries.body.entries[0]!.seq).toBeGreaterThan(entries.body.entries[4]!.seq);
  });
});
