import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { VICTIM_FORBIDDEN_KEYS } from "@blindaje/shared";
import { findForbiddenKeys } from "../src/lib/http";
import { recomputeNetworks } from "../src/networks";
import { newId, nowIso } from "../src/lib/ids";
import { api, createCase, insertLink, markIndexed, registerDevice, seedOrg, signRefresh, upload } from "./helpers";

/** Recorre recursivamente un JSON y devuelve las claves prohibidas para víctimas. */
function forbidden(value: unknown): string[] {
  return findForbiddenKeys(value);
}

describe("findForbiddenKeys", () => {
  it("detecta claves prohibidas en cualquier nivel", () => {
    expect(forbidden({ a: { b: [{ links: [] }] } })).toEqual(["$.a.b[0].links"]);
    expect(forbidden({ ficha: { score: 1 } })).toEqual(["$.ficha.score"]);
    expect(forbidden({ ok: true })).toEqual([]);
    for (const k of VICTIM_FORBIDDEN_KEYS) expect(forbidden({ [k]: 1 }).length).toBe(1);
  });
});

describe("aislamiento de la víctima (sección 5 y 12.3)", () => {
  it("un infiltrado registrado como víctima nunca ve vínculos, redes ni datos de otros casos", async () => {
    const { invite, orgId } = await seedOrg();
    const real = await registerDevice(invite);
    const infiltrado = await registerDevice(invite);

    const realCase = await createCase(real.access_token, "comunitario");
    const infCase = await createCase(infiltrado.access_token, "comunitario");
    expect((await upload(real.access_token, realCase.id, new TextEncoder().encode("audio real ficticio"))).status).toBe(201);

    // El motor encontró un vínculo entre el caso del infiltrado y el caso real, y alguien lo confirmó.
    await markIndexed(realCase.id);
    await markIndexed(infCase.id);
    const link = await insertLink(realCase.id, infCase.id, "confirmado", 0.97);
    await recomputeNetworks(env);
    const net = await env.DB.prepare("SELECT network_id FROM network_cases WHERE case_id = ?").bind(infCase.id).first<{ network_id: string }>();
    expect(net).toBeTruthy();
    // Y una alerta aprobada de su organización con citas internas.
    await env.DB.prepare(
      "INSERT INTO alerts (id, org_id, network_id, draft_json, status, approved_at, created_at) VALUES (?, ?, ?, ?, 'aprobada', ?, ?)",
    )
      .bind(
        newId(),
        orgId,
        net!.network_id,
        JSON.stringify({
          titulo: "Alerta para asociados (ficticia)",
          cuerpo: "Circulan audios que piden pago por Yape. No negocies solo: denuncia en la Línea 1818.",
          zona: "Lima Este",
          modalidad: "audios con plazo de 48 horas",
          que_hacer: ["Guarda la evidencia", "Denuncia en la Línea 1818"],
          evidencia: [`VIN-${link.num}`, "FICHA-A"],
        }),
        nowIso(),
        nowIso(),
      )
      .run();

    const tok = infiltrado.access_token;
    const responses: Array<{ route: string; status: number; body: unknown; text: string }> = [];
    const record = async (route: string, res: Response) => {
      const text = await res.text();
      responses.push({ route, status: res.status, body: text ? JSON.parse(text) : null, text });
    };

    responses.push({ route: "register", status: 201, body: infiltrado.raw, text: JSON.stringify(infiltrado.raw) });
    await record("GET /cases", await api("/v1/cases", { token: tok }));
    await record("POST /cases", await api("/v1/cases", { token: tok, json: { consent_mode: "comunitario" } }));
    await record("POST evidence", await upload(tok, infCase.id, new TextEncoder().encode("evidencia de prueba del infiltrado")));
    await record("GET report", await api(`/v1/cases/${infCase.id}/report`, { token: tok }));
    await record("PUT consent", await api(`/v1/cases/${infCase.id}/consent`, { method: "PUT", token: tok, json: { mode: "comunitario" } }));
    await record("GET alerts", await api("/v1/alerts", { token: tok }));
    const ts = Date.now();
    await record(
      "refresh",
      await api("/v1/auth/device/refresh", {
        json: {
          device_id: infiltrado.device_id,
          refresh_token: infiltrado.refresh_token,
          timestamp: ts,
          signature: await signRefresh(infiltrado.keys.privateKey, infiltrado.device_id, ts),
        },
      }),
    );
    await using wf = await introspectWorkflow(env.PROCESAR_CASO);
    await record("POST submit", await api(`/v1/cases/${infCase.id}/submit`, { token: tok, json: { narrative: "Me llamaron (ficticio)." } }));
    for (const inst of await wf.get()) await inst.waitForStatus("complete");
    await record("GET report (listo)", await api(`/v1/cases/${infCase.id}/report`, { token: tok }));

    for (const r of responses) {
      expect(r.status, r.route).toBeLessThan(300);
      expect(forbidden(r.body), r.route).toEqual([]);
      // Nada del otro caso, del vínculo ni de la red aparece en el texto.
      expect(r.text.includes(realCase.id), r.route).toBe(false);
      expect(r.text.includes(link.id), r.route).toBe(false);
      expect(r.text.includes(net!.network_id), r.route).toBe(false);
      expect(r.text.includes(`VIN-${link.num}`), r.route).toBe(false);
    }
    const alerts = responses.find((r) => r.route === "GET alerts")!.body as { alerts: Array<Record<string, unknown>> };
    expect(alerts.alerts).toHaveLength(1);
    expect(Object.keys(alerts.alerts[0]!).sort()).toEqual(["approved_at", "cuerpo", "id", "que_hacer", "titulo", "zona"]);

    // Y no puede entrar a la consola.
    expect((await api("/v1/console/links", { token: tok })).status).toBe(403);
    expect((await api(`/v1/console/links/${link.id}`, { token: tok })).status).toBe(403);
    expect((await api("/v1/console/networks", { token: tok })).status).toBe(403);
  });

  it("un caso ajeno responde 404 en todas las rutas de caso", async () => {
    const { invite } = await seedOrg();
    const owner = await registerDevice(invite);
    const intruder = await registerDevice(invite);
    const c = await createCase(owner.access_token);
    const tok = intruder.access_token;
    const checks: Array<[string, Response]> = [
      ["evidence", await upload(tok, c.id, new TextEncoder().encode("x"))],
      ["submit", await api(`/v1/cases/${c.id}/submit`, { token: tok, json: {} })],
      ["report", await api(`/v1/cases/${c.id}/report`, { token: tok })],
      ["report.pdf", await api(`/v1/cases/${c.id}/report.pdf`, { token: tok })],
      ["consent", await api(`/v1/cases/${c.id}/consent`, { method: "PUT", token: tok, json: { mode: "comunitario" } })],
      ["delete", await api(`/v1/cases/${c.id}`, { method: "DELETE", token: tok })],
    ];
    for (const [name, res] of checks) {
      expect(res.status, name).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code, name).toBe("not_found");
    }
    // Un id inexistente se ve igual que uno ajeno.
    const missing = await api(`/v1/cases/${newId()}/report`, { token: tok });
    expect(missing.status).toBe(404);
    // El caso sigue intacto para su dueña.
    expect((await api(`/v1/cases/${c.id}/report`, { token: owner.access_token })).status).toBe(200);
    const list = (await (await api("/v1/cases", { token: tok })).json()) as { cases: unknown[] };
    expect(list.cases).toHaveLength(0);
  });

  it("las alertas de la víctima son solo las aprobadas de su organización", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const d = await registerDevice(a.invite);
    const draft = JSON.stringify({ titulo: "t", cuerpo: "c", zona: "z", modalidad: "m", que_hacer: [], evidencia: [] });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO alerts (id, org_id, draft_json, status, approved_at, created_at) VALUES (?, ?, ?, 'aprobada', ?, ?)").bind(
        newId(),
        b.orgId,
        draft,
        nowIso(),
        nowIso(),
      ),
      env.DB.prepare("INSERT INTO alerts (id, org_id, draft_json, status, created_at) VALUES (?, ?, ?, 'borrador', ?)").bind(
        newId(),
        a.orgId,
        draft,
        nowIso(),
      ),
    ]);
    const res = (await (await api("/v1/alerts", { token: d.access_token })).json()) as { alerts: unknown[] };
    expect(res.alerts).toHaveLength(0);
  });
});
