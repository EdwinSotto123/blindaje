import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { recomputeNetworks } from "../src/networks";
import { newId, nowIso } from "../src/lib/ids";
import { api, apiJson, createCase, insertLink, loginAs, markIndexed, registerDevice, seedOrg } from "./helpers";

describe("guardas por rol", () => {
  it("cada rol entra solo a lo suyo", async () => {
    const { orgId, invite } = await seedOrg();
    const reviewer = await loginAs("reviewer", orgId);
    const analyst = await loginAs("analyst", orgId);
    const admin = await loginAs("admin", orgId);
    const victim = await registerDevice(invite);

    const matrix: Array<[string, string, string, number]> = [
      ["GET", "/v1/console/me", victim.access_token, 403],
      ["GET", "/v1/console/links", admin.token, 403],
      ["GET", "/v1/console/links", reviewer.token, 200],
      ["GET", "/v1/console/links", analyst.token, 200],
      ["GET", "/v1/console/networks", reviewer.token, 403],
      ["GET", "/v1/console/networks", analyst.token, 200],
      ["GET", "/v1/console/networks", admin.token, 200],
      ["GET", "/v1/console/audit", reviewer.token, 403],
      ["GET", "/v1/console/audit/verify", admin.token, 200],
      ["GET", "/v1/console/costs", reviewer.token, 403],
      ["GET", "/v1/console/users", analyst.token, 403],
      ["GET", "/v1/console/users", admin.token, 200],
      ["GET", "/v1/console/orgs", reviewer.token, 403],
      ["GET", "/v1/console/alerts", reviewer.token, 200],
      ["GET", "/v1/cases", reviewer.token, 403],
      ["GET", "/v1/alerts", admin.token, 403],
    ];
    for (const [method, path, token, expected] of matrix) {
      const res = await api(path, { method, token });
      expect(res.status, `${method} ${path}`).toBe(expected);
    }
    // Decisiones: analista no aprueba alertas; revisora no decide hipótesis.
    expect((await api(`/v1/console/alerts/${newId()}/decision`, { token: analyst.token, json: { decision: "aprobar" } })).status).toBe(403);
    expect((await api(`/v1/console/hypotheses/${newId()}/decision`, { token: reviewer.token, json: { decision: "aprobar" } })).status).toBe(403);
    expect((await api(`/v1/console/networks/${newId()}/cartografo`, { token: admin.token, json: {} })).status).toBe(403);
  });

  it("admin crea usuarios e invitaciones; la revisora solo de su organización", async () => {
    const { orgId } = await seedOrg();
    const other = await seedOrg();
    const admin = await loginAs("admin", orgId);
    const reviewer = await loginAs("reviewer", orgId);
    const created = await apiJson<{ email: string; role: string }>("/v1/console/users", {
      token: admin.token,
      json: { email: "Nueva.Analista@prueba.blindaje.test", display_name: "Analista nueva (ficticia)", role: "analyst", org_id: orgId, password: "una-clave-bien-larga" },
    });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe("nueva.analista@prueba.blindaje.test");
    const login = await apiJson("/v1/auth/console/login", { json: { email: "nueva.analista@prueba.blindaje.test", password: "una-clave-bien-larga" } });
    expect(login.status).toBe(200);

    const codes = await apiJson<{ codes: string[] }>("/v1/console/invites", { token: reviewer.token, json: { count: 3 } });
    expect(codes.status).toBe(201);
    expect(codes.body.codes).toHaveLength(3);
    expect(codes.body.codes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const d = await registerDevice(codes.body.codes[0]!);
    expect(d.org.id).toBe(orgId);
    const forbidden = await apiJson("/v1/console/invites", { token: reviewer.token, json: { count: 1, org_id: other.orgId } });
    expect(forbidden.status).toBe(403);
    const adminOther = await apiJson<{ codes: string[] }>("/v1/console/invites", { token: admin.token, json: { count: 1, org_id: other.orgId } });
    expect(adminOther.status).toBe(201);
  });
});

describe("cola de vínculos y casos en la consola", () => {
  it("la revisora ve vínculos de su organización; la analista ve todos", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const dA = await registerDevice(orgA.invite);
    const dB = await registerDevice(orgB.invite);
    const cA1 = await createCase(dA.access_token, "comunitario");
    const cA2 = await createCase(dA.access_token, "comunitario");
    const cB = await createCase(dB.access_token, "comunitario");
    for (const c of [cA1, cA2, cB]) await markIndexed(c.id);
    const inside = await insertLink(cA1.id, cA2.id, "probable", 0.95);
    const cross = await insertLink(cA1.id, cB.id, "por_revisar", 0.7);

    const reviewer = await loginAs("reviewer", orgA.orgId);
    const analyst = await loginAs("analyst", orgB.orgId);
    const rq = await apiJson<{ links: Array<{ id: string; label: string; case_a: { code: string }; signals: unknown }> }>("/v1/console/links", {
      token: reviewer.token,
    });
    const rIds = rq.body.links.map((l) => l.id);
    expect(rIds).toContain(inside.id);
    expect(rIds).not.toContain(cross.id);
    expect((await api(`/v1/console/links/${cross.id}`, { token: reviewer.token })).status).toBe(404);

    const aq = await apiJson<{ links: Array<{ id: string; score: number }> }>("/v1/console/links", { token: analyst.token });
    const aIds = aq.body.links.map((l) => l.id);
    expect(aIds).toEqual(expect.arrayContaining([inside.id, cross.id]));
    const scores = aq.body.links.map((l) => l.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);

    const view = await apiJson<{ label: string; case_a: { id: string; evidencia: unknown[] }; signals: { identificador: unknown } }>(
      `/v1/console/links/${inside.id}`,
      { token: reviewer.token },
    );
    expect(view.body.label).toBe(`VIN-${inside.num}`);
    expect(view.body.signals.identificador).toBeTruthy();

    const cs = await apiJson<{ code: string; transcripciones: unknown[] }>(`/v1/console/cases/${cA1.id}`, { token: reviewer.token });
    expect(cs.status).toBe(200);
    expect(cs.body.transcripciones).toEqual([]);
    expect((await api(`/v1/console/cases/${cB.id}`, { token: reviewer.token })).status).toBe(404);
  });

  it("redes, perfiles, alertas e hipótesis leídas desde D1", async () => {
    const { orgId, invite } = await seedOrg();
    const d = await registerDevice(invite);
    const a = await createCase(d.access_token, "comunitario");
    const b = await createCase(d.access_token, "comunitario");
    await markIndexed(a.id);
    await markIndexed(b.id);
    await env.DB.prepare("UPDATE cases SET ficha_json = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          caso: a.code,
          zona: "Lima Este",
          sector: "bodega",
          primer_contacto: "2026-10-03T19:40:00-05:00",
          tipo_amenaza: "dano_local",
          amenaza: "daño al local",
          monto_soles: 2000,
          periodicidad: "unico",
          plazo: "48 horas",
          plazo_horas: 48,
          canal_pago: "yape",
          identificadores: [],
          grupo_que_dice_ser: "Los X",
          frases_firma: ["habla con el jefe"],
          escalamiento: [{ fecha: "2026-10-06", tipo: "foto del local con bala", evidencia: [`EV-${a.code}-1`] }],
          resumen_mo: "Audios con plazo de 48 horas (ficticio)",
          fuentes: [],
        }),
        a.id,
      )
      .run();
    const link = await insertLink(a.id, b.id, "confirmado");
    await recomputeNetworks(env);
    const netId = (await env.DB.prepare("SELECT network_id FROM network_cases WHERE case_id = ?").bind(a.id).first<{ network_id: string }>())!.network_id;

    const analyst = await loginAs("analyst", orgId);
    const reviewer = await loginAs("reviewer", orgId);
    const nets = await apiJson<{ networks: Array<{ id: string; label: string; n_cases: number; sectores: string[] }> }>("/v1/console/networks", {
      token: analyst.token,
    });
    const mine = nets.body.networks.find((n) => n.id === netId)!;
    expect(mine.n_cases).toBe(2);
    expect(mine.label).toMatch(/^R-\d{3,}$/);
    expect(mine.sectores).toEqual(["bodega"]);

    const view = await apiJson<{ nodes: Array<{ type: string }>; edges: Array<{ type: string; label?: string }>; timeline: unknown[]; links: unknown[] }>(
      `/v1/console/networks/${netId}`,
      { token: analyst.token },
    );
    expect(view.status).toBe(200);
    expect(view.body.nodes.filter((n) => n.type === "caso")).toHaveLength(2);
    expect(view.body.nodes.some((n) => n.type === "frase")).toBe(true);
    expect(view.body.edges.some((e) => e.type === "vinculo" && e.label === `VIN-${link.num}`)).toBe(true);
    expect(view.body.timeline.length).toBeGreaterThanOrEqual(2);

    // Perfil e hipótesis (los escribirá el Cartógrafo).
    const profileId = newId();
    const hypId = newId();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO network_profiles (id, network_id, profile_json, citation_check_json, status, model, created_at) VALUES (?, ?, ?, ?, 'borrador', 'muse-spark-1.3', ?)",
      ).bind(profileId, netId, JSON.stringify({ red: "R-001", casos: 2 }), JSON.stringify({ ok: true, sin_cita: [], citas_inexistentes: [] }), nowIso()),
      env.DB.prepare(
        "INSERT INTO hypotheses (id, num, profile_id, network_id, texto, confianza, evidence_json, created_at) VALUES (?, 7001, ?, ?, ?, 'media', ?, ?)",
      ).bind(hypId, profileId, netId, "La cuenta funciona como recaudadora (ficticio)", JSON.stringify([`VIN-${link.num}`]), nowIso()),
    ]);
    const profiles = await apiJson<{ profiles: Array<{ id: string; hypotheses: Array<{ id: string }> }> }>(`/v1/console/networks/${netId}/profiles`, {
      token: analyst.token,
    });
    expect(profiles.body.profiles[0]!.hypotheses[0]!.id).toBe(hypId);
    const hyp = await apiJson<{ status: string; reviewed_by: string }>(`/v1/console/hypotheses/${hypId}/decision`, {
      token: analyst.token,
      json: { decision: "aprobar" },
    });
    expect(hyp.body.status).toBe("aprobada");
    expect(hyp.body.reviewed_by).toContain("analyst");

    // Alertas: la revisora aprueba y edita; los números completos se rechazan.
    const alertId = newId();
    await env.DB.prepare("INSERT INTO alerts (id, org_id, network_id, draft_json, status, created_at) VALUES (?, ?, ?, ?, 'borrador', ?)")
      .bind(
        alertId,
        orgId,
        netId,
        JSON.stringify({ titulo: "Alerta (ficticia)", cuerpo: "Circulan audios.", zona: "Lima Este", modalidad: "audios", que_hacer: ["Denuncia en la Línea 1818"], evidencia: [] }),
        nowIso(),
      )
      .run();
    const withNumber = await apiJson(`/v1/console/alerts/${alertId}/decision`, {
      token: reviewer.token,
      json: { decision: "aprobar", cuerpo: "Piden yapear al 987 654 321." },
    });
    expect(withNumber.status).toBe(400);
    const approved = await apiJson<{ status: string; borrador: { titulo: string }; approved_by: string }>(`/v1/console/alerts/${alertId}/decision`, {
      token: reviewer.token,
      json: { decision: "aprobar", titulo: "Alerta para asociados (ficticia)" },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("aprobada");
    expect(approved.body.borrador.titulo).toBe("Alerta para asociados (ficticia)");
    const otherReviewer = await loginAs("reviewer", (await seedOrg()).orgId);
    expect((await api(`/v1/console/alerts/${alertId}/decision`, { token: otherReviewer.token, json: { decision: "rechazar" } })).status).toBe(404);
    const victimAlerts = (await (await api("/v1/alerts", { token: d.access_token })).json()) as { alerts: Array<{ titulo: string }> };
    expect(victimAlerts.alerts.map((x) => x.titulo)).toContain("Alerta para asociados (ficticia)");

    // Agentes sin Meta simulada (la de test/setup.ts responde 401): error claro, sin perfiles a medias.
    // Los casos felices están en agents-*.test.ts.
    const vigia = await apiJson<{ alerts: unknown[] }>("/v1/console/vigia/run", { token: analyst.token, json: {} });
    expect(vigia.status).toBe(200);
    expect(vigia.body.alerts).toEqual([]);
    const carto = await apiJson<{ error: { code: string } }>(`/v1/console/networks/${netId}/cartografo`, { token: analyst.token, json: {} });
    expect(carto.status).toBe(502);
    expect(carto.body.error.code).toBe("upstream_error");
    const exp = await apiJson<{ error: { code: string } }>(`/v1/console/networks/${netId}/expediente`, { token: analyst.token, json: {} });
    expect(exp.status).toBe(502);
    expect(exp.body.error.code).toBe("upstream_error");
    expect((await api(`/v1/console/expedientes/${newId()}`, { token: analyst.token })).status).toBe(404);
  });
});
