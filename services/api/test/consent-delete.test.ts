import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { connectedComponents, recomputeNetworks, UnionFind } from "../src/networks";
import { putEncrypted } from "../src/lib/crypto";
import { newId, nowIso } from "../src/lib/ids";
import { api, apiJson, createCase, insertLink, loginAs, markIndexed, registerDevice, seedOrg, upload } from "./helpers";

describe("redes por union-find", () => {
  it("calcula componentes conexos", () => {
    expect(connectedComponents([["a", "b"], ["b", "c"], ["x", "y"]])).toEqual([["a", "b", "c"], ["x", "y"]]);
    const uf = new UnionFind();
    uf.add("solo");
    expect(uf.components()).toEqual([]);
  });

  it("solo los vínculos confirmados forman redes y los ids se conservan", async () => {
    const { invite, orgId } = await seedOrg();
    const d = await registerDevice(invite);
    const [a, b, c] = [await createCase(d.access_token), await createCase(d.access_token), await createCase(d.access_token)];
    for (const x of [a, b, c]) await markIndexed(x.id);
    const ab = await insertLink(a.id, b.id, "confirmado");
    await insertLink(b.id, c.id, "probable");
    await recomputeNetworks(env);
    const net1 = await env.DB.prepare("SELECT network_id FROM network_cases WHERE case_id = ?").bind(a.id).first<{ network_id: string }>();
    expect(net1).toBeTruthy();
    expect(await env.DB.prepare("SELECT network_id FROM network_cases WHERE case_id = ?").bind(c.id).first()).toBeNull();

    // La revisora confirma B–C desde la consola: la red crece y conserva su id.
    const reviewer = await loginAs("reviewer", orgId);
    const queue = await apiJson<{ links: Array<{ id: string; status: string }> }>("/v1/console/links", { token: reviewer.token });
    const pending = queue.body.links.find((l) => l.status === "probable")!;
    const decided = await apiJson<{ status: string; reviewed_by: string }>(`/v1/console/links/${pending.id}/decision`, {
      token: reviewer.token,
      json: { decision: "confirmar", note: "Misma cuenta de cobro (ficticio)" },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe("confirmado");
    const members = await env.DB.prepare("SELECT case_id FROM network_cases WHERE network_id = ?").bind(net1!.network_id).all();
    expect(members.results).toHaveLength(3);

    // Descartar A–B parte la red: A queda fuera.
    await apiJson(`/v1/console/links/${ab.id}/decision`, { token: reviewer.token, json: { decision: "descartar" } });
    const after = await env.DB.prepare("SELECT case_id FROM network_cases WHERE network_id = ?").bind(net1!.network_id).all<{ case_id: string }>();
    expect(after.results.map((r) => r.case_id).sort()).toEqual([b.id, c.id].sort());
  });
});

describe("consentimiento", () => {
  it("pasar a 'solo mi denuncia' desindexa, borra vínculos y recalcula redes", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const a = await createCase(d.access_token, "comunitario");
    const b = await createCase(d.access_token, "comunitario");
    await markIndexed(a.id);
    await markIndexed(b.id);
    await insertLink(a.id, b.id, "confirmado");
    await recomputeNetworks(env);
    expect(await env.DB.prepare("SELECT 1 FROM network_cases WHERE case_id = ?").bind(a.id).first()).toBeTruthy();

    const res = await apiJson<{ consent_mode: string }>(`/v1/cases/${a.id}/consent`, {
      method: "PUT",
      token: d.access_token,
      json: { mode: "solo_denuncia" },
    });
    expect(res.status).toBe(200);
    expect(res.body.consent_mode).toBe("solo_denuncia");
    const row = await env.DB.prepare("SELECT indexed, consent_mode FROM cases WHERE id = ?").bind(a.id).first<{ indexed: number }>();
    expect(row!.indexed).toBe(0);
    const links = await env.DB.prepare("SELECT COUNT(*) AS n FROM links WHERE case_a = ? OR case_b = ?").bind(a.id, a.id).first<{ n: number }>();
    expect(links!.n).toBe(0);
    expect(await env.DB.prepare("SELECT 1 FROM network_cases WHERE case_id IN (?, ?)").bind(a.id, b.id).first()).toBeNull();
    const consents = await env.DB.prepare("SELECT mode, revoked_at FROM consents WHERE case_id = ? ORDER BY granted_at").bind(a.id).all<{
      mode: string;
      revoked_at: string | null;
    }>();
    expect(consents.results.map((c) => c.mode)).toEqual(["comunitario", "solo_denuncia"]);
    expect(consents.results[0]!.revoked_at).not.toBeNull();
    expect(consents.results[1]!.revoked_at).toBeNull();
    const audited = await env.DB.prepare("SELECT details_json FROM audit_log WHERE action = 'case.consent' AND target_id = ?").bind(a.id).first<{
      details_json: string;
    }>();
    expect(JSON.parse(audited!.details_json)).toMatchObject({ mode: "solo_denuncia", deindexed: true, links_removed: 1 });
  });
});

describe("borrado del caso", () => {
  it("borra R2, D1 en cascada, vínculos y redes", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const a = await createCase(d.access_token, "comunitario");
    const b = await createCase(d.access_token, "comunitario");
    const up = await upload(d.access_token, a.id, new TextEncoder().encode("audio ficticio para borrar"));
    const ev = (await up.json()) as { id: string };
    const derId = newId();
    const derKey = `cases/${a.id}/derived/${derId}`;
    await putEncrypted(env.EVIDENCE, derKey, env.EVIDENCE_ENCRYPTION_KEY, new TextEncoder().encode("wav"), derId);
    await env.DB.prepare(
      "INSERT INTO derivatives (id, evidence_id, case_id, tipo, content_json, r2_key, created_at) VALUES (?, ?, ?, 'transcripcion', ?, ?, ?)",
    )
      .bind(derId, ev.id, a.id, JSON.stringify({ model: "x", turns: [] }), derKey, nowIso())
      .run();
    await markIndexed(a.id);
    await markIndexed(b.id);
    await insertLink(a.id, b.id, "confirmado");
    await recomputeNetworks(env);

    expect((await env.EVIDENCE.list({ prefix: `cases/${a.id}/` })).objects.length).toBe(2);
    const del = await api(`/v1/cases/${a.id}`, { method: "DELETE", token: d.access_token });
    expect(del.status).toBe(204);

    expect((await env.EVIDENCE.list({ prefix: `cases/${a.id}/` })).objects).toHaveLength(0);
    for (const [table, col] of [
      ["cases", "id"],
      ["evidence", "case_id"],
      ["derivatives", "case_id"],
      ["consents", "case_id"],
      ["network_cases", "case_id"],
    ] as const) {
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).bind(a.id).first<{ n: number }>();
      expect(n!.n, table).toBe(0);
    }
    expect(await env.DB.prepare("SELECT 1 FROM network_cases WHERE case_id = ?").bind(b.id).first()).toBeNull();
    expect((await api(`/v1/cases/${a.id}/report`, { token: d.access_token })).status).toBe(404);
    const audited = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'case.delete' AND target_id = ?").bind(a.id).first<{
      n: number;
    }>();
    expect(audited!.n).toBe(1);
  });
});
