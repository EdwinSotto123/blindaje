import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { app } from "../src/app";
import { CENTRAL_ORG_ID, type PublicZoneMap } from "@blindaje/shared";
import { newId, nowIso } from "../src/lib/ids";
import { DEMO_INVITES, DEMO_ORG, DEMO_USERS, DEMO_ZONES, demoAggregateCount } from "../src/routes/demo";
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

  it("seed crea el equipo central, el canal de invitaciones y casos por distrito; reset borra todo lo is_demo", async () => {
    const seed = await apiJson<{ org: { id: string; name: string }; central: { id: string }; invites: string[]; zonas: { sobre_umbral: string[]; bajo_umbral: string[] } }>(
      "/v1/demo/seed",
      { method: "POST", headers: secret },
    );
    expect(seed.status).toBe(201);
    expect(seed.body.org.name).toContain("datos ficticios");
    expect(seed.body.central.id).toBe(CENTRAL_ORG_ID);
    expect(seed.body.invites).toEqual(DEMO_INVITES.map((i) => i.code));
    // Idempotente (los casos agregados se reemplazan, no se duplican).
    expect((await apiJson("/v1/demo/seed", { method: "POST", headers: secret })).status).toBe(201);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE is_demo = 1").first<{ n: number }>())!.n).toBe(3);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM cases WHERE is_demo = 1").first<{ n: number }>())!.n).toBe(demoAggregateCount());

    // El equipo es de la organización central, con los mismos correos del README.
    for (const u of DEMO_USERS) {
      const login = await apiJson<{ user: { role: string; display_name: string; org: { id: string } } }>("/v1/auth/console/login", {
        json: { email: u.email, password: u.password },
      });
      expect(login.status, u.email).toBe(200);
      expect(login.body.user).toMatchObject({ role: u.role, display_name: u.display_name, org: { id: CENTRAL_ORG_ID } });
    }
    expect(DEMO_USERS[0].display_name).toBe("Revisora Demo");

    // El mapa del demo tiene distritos sobre y bajo el umbral; el mapa real no ve nada del demo.
    const demoMap = await apiJson<PublicZoneMap>("/v1/public/zones?demo=1");
    expect(demoMap.body.demo).toBe(true);
    const cell = (m: PublicZoneMap, id: string) => m.celdas.find((c) => c.distrito === id)!;
    expect(seed.body.zonas.sobre_umbral.length).toBeGreaterThanOrEqual(5);
    expect(seed.body.zonas.bajo_umbral.length).toBeGreaterThanOrEqual(3);
    for (const id of seed.body.zonas.sobre_umbral) expect(cell(demoMap.body, id).casos, id).not.toBeNull();
    for (const id of seed.body.zonas.bajo_umbral) expect(cell(demoMap.body, id), id).toMatchObject({ nivel: "sin_datos", casos: null });
    expect(cell(demoMap.body, "villa-el-salvador")).toMatchObject({ casos: "20-49", nivel: "alto", tendencia: "sube" });
    expect(cell(demoMap.body, "comas")).toMatchObject({ casos: "5-9", tendencia: "baja" });
    expect(cell(demoMap.body, "la-victoria")).toMatchObject({ casos: "5-9", nivel: "bajo", tendencia: "estable" });
    const realMap = await apiJson<PublicZoneMap>("/v1/public/zones");
    expect(realMap.body.demo).toBe(false);
    for (const z of DEMO_ZONES) expect(cell(realMap.body, z.distrito).nivel).toBe("sin_datos");
    // Panorama del demo para un distrito (rangos).
    const ves = await apiJson<{ casos_periodo: string; sectores_afectados: Array<{ sector: string; casos: string }> }>(
      "/v1/public/risk?zona=villa-el-salvador&demo=1",
    );
    expect(ves.body.casos_periodo).toBe("20-49");
    expect(ves.body.sectores_afectados.map((s) => s.sector)).toContain("bodega");

    // El script de los casos A, B y C usa la API como la app.
    const victim = await registerDevice("DEMO-CASO-A");
    expect(victim.org.id).toBe(DEMO_ORG.id);
    const created = await apiJson<{ id: string; code: string }>("/v1/cases", {
      token: victim.access_token,
      json: { sector: "bodega", zona: "san-juan-de-lurigancho", consent_mode: "comunitario" },
      headers: { "x-demo-case-code": "A" },
    });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("A");
    const ev = await upload(victim.access_token, created.body.id, new TextEncoder().encode("audio A1 ficticio"));
    expect(((await ev.json()) as { label: string }).label).toBe("EV-A1");
    const dup = await apiJson("/v1/cases", { token: victim.access_token, json: {}, headers: { "x-demo-case-code": "A" } });
    expect(dup.status).toBe(409);

    // Alertas: la del Vigía con casos del demo se borra; una real de la organización central, no.
    const demoAlert = newId();
    const realAlert = newId();
    const draft = JSON.stringify({ titulo: "t", cuerpo: "c", zona: "Ate", modalidad: "m", que_hacer: [], evidencia: [] });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO alerts (id, org_id, pattern_key, draft_json, status, created_at) VALUES (?, ?, 'demo:patron', ?, 'borrador', ?)").bind(demoAlert, CENTRAL_ORG_ID, draft, nowIso()),
      env.DB.prepare("INSERT INTO alerts (id, org_id, pattern_key, draft_json, status, created_at) VALUES (?, ?, 'patron-real', ?, 'borrador', ?)").bind(realAlert, CENTRAL_ORG_ID, draft, nowIso()),
    ]);

    const reset = await apiJson<{ ok: boolean; deleted: { cases: number; aggregate_cases: number; users: number; devices: number } }>("/v1/demo/reset", {
      method: "POST",
      headers: secret,
    });
    expect(reset.status).toBe(200);
    const aggregateDevices = DEMO_ZONES.reduce((n, z) => n + z.victimas, 0);
    expect(reset.body.deleted).toMatchObject({ cases: 1 + demoAggregateCount(), aggregate_cases: demoAggregateCount(), users: 3, devices: 1 + aggregateDevices });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM cases WHERE is_demo = 1").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE is_demo = 1").first<{ n: number }>())!.n).toBe(0);
    expect(await env.DB.prepare("SELECT 1 FROM alerts WHERE id = ?").bind(demoAlert).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM alerts WHERE id = ?").bind(realAlert).first()).not.toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM organizations WHERE id = ?").bind(CENTRAL_ORG_ID).first()).not.toBeNull();
    const afterMap = await apiJson<PublicZoneMap>("/v1/public/zones?demo=1");
    expect(afterMap.body.celdas.every((c) => c.nivel === "sin_datos")).toBe(true);
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
