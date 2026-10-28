import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { app } from "../src/app";
import { DEMO_INVITES, DEMO_ORG, DEMO_USERS } from "../src/routes/demo";
import { api, apiJson, registerDevice, upload } from "./helpers";

const secret = { "x-demo-secret": "demo-secret-de-prueba" };

describe("modo demo", () => {
  it("exige DEMO_MODE=true y el secreto", async () => {
    expect((await api("/v1/demo/seed", { method: "POST" })).status).toBe(401);
    expect((await api("/v1/demo/seed", { method: "POST", headers: { "x-demo-secret": "otro" } })).status).toBe(401);
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request("https://api.blindaje.test/v1/demo/seed", { method: "POST", headers: { ...secret, "cf-connecting-ip": "192.0.2.50" } }),
      { ...env, DEMO_MODE: "false" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("demo_disabled");
  });

  it("seed crea organización, usuarios e invitaciones; reset borra todo lo is_demo", async () => {
    const seed = await apiJson<{ org: { id: string; name: string }; invites: string[] }>("/v1/demo/seed", { method: "POST", headers: secret });
    expect(seed.status).toBe(201);
    expect(seed.body.org.name).toContain("datos ficticios");
    expect(seed.body.invites).toEqual(DEMO_INVITES.map((i) => i.code));
    // Idempotente.
    expect((await apiJson("/v1/demo/seed", { method: "POST", headers: secret })).status).toBe(201);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE is_demo = 1").first<{ n: number }>())!.n).toBe(3);

    for (const u of DEMO_USERS) {
      const login = await apiJson<{ user: { role: string } }>("/v1/auth/console/login", { json: { email: u.email, password: u.password } });
      expect(login.status, u.email).toBe(200);
      expect(login.body.user.role).toBe(u.role);
    }

    // El script de los casos A, B y C usa la API como la app.
    const victim = await registerDevice("DEMO-CASO-A");
    expect(victim.org.id).toBe(DEMO_ORG.id);
    const created = await apiJson<{ id: string; code: string }>("/v1/cases", {
      token: victim.access_token,
      json: { sector: "bodega", zona: "Lima Este", consent_mode: "comunitario" },
      headers: { "x-demo-case-code": "A" },
    });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("A");
    const ev = await upload(victim.access_token, created.body.id, new TextEncoder().encode("audio A1 ficticio"));
    expect(((await ev.json()) as { label: string }).label).toBe("EV-A1");
    const dup = await apiJson("/v1/cases", { token: victim.access_token, json: {}, headers: { "x-demo-case-code": "A" } });
    expect(dup.status).toBe(409);

    const reset = await apiJson<{ ok: boolean; deleted: { cases: number; users: number; devices: number } }>("/v1/demo/reset", {
      method: "POST",
      headers: secret,
    });
    expect(reset.status).toBe(200);
    expect(reset.body.deleted).toMatchObject({ cases: 1, users: 3, devices: 1 });
    expect(await env.DB.prepare("SELECT 1 FROM organizations WHERE id = ?").bind(DEMO_ORG.id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM cases WHERE id = ?").bind(created.body.id).first()).toBeNull();
    expect((await env.EVIDENCE.list({ prefix: `cases/${created.body.id}/` })).objects).toHaveLength(0);
    const login = await apiJson("/v1/auth/console/login", { json: { email: DEMO_USERS[0].email, password: DEMO_USERS[0].password } });
    expect(login.status).toBe(401);
    // El código de demo solo funciona con dispositivos demo.
  });

  it("x-demo-case-code se ignora para dispositivos que no son demo", async () => {
    const { seedOrg } = await import("./helpers");
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const created = await apiJson<{ code: string }>("/v1/cases", { token: d.access_token, json: {}, headers: { "x-demo-case-code": "Z" } });
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^[A-Z0-9]{4}$/);
  });
});
