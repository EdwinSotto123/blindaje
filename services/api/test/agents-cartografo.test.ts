import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { PerfilRed, ProfileView } from "@blindaje/shared";
import { recordCost } from "../src/costs";
import { api, apiJson, loginAs } from "./helpers";
import { call, fakeMeta, final, restoreMeta, seedNetwork, toolOutputs, type SeededNetwork } from "./agents-helpers";

afterEach(() => restoreMeta());

function perfil(net: SeededNetwork, over: Partial<PerfilRed> = {}): PerfilRed {
  const [a, b] = net.cases;
  return {
    red: "R-999",
    casos: 99,
    periodo: null,
    sectores: [],
    territorio: [{ zona: "Lima Este - E12", casos: 3 }],
    modus_operandi: `Audios de voz masculina y cobro por Yape con plazo de 48 horas (FICHA-${a!.code}).`,
    hechos: [
      { texto: `La cuenta ${net.identifier} aparece en 2 casos de la red`, evidencia: [net.identifier, `VIN-${net.links[0]!.num}`] },
      { texto: `El caso ${a!.code} recibió una foto del local con una bala`, evidencia: [a!.evidence[1]!.label] },
    ],
    hipotesis: [{ texto: `${net.identifier} funciona como cuenta recaudadora`, confianza: "media", evidencia: [net.identifier] }],
    escalamiento: `En el caso ${a!.code} hubo intimidación física unos 4 días después del plazo vencido (FICHA-${a!.code}).`,
    brechas: [`Faltan los audios originales del caso ${b!.code}`],
    recomendaciones_autoridad: ["Solicitar por la vía fiscal la información de la cuenta compartida"],
    ...over,
  };
}

/** Guion de un Cartógrafo que trabaja bien: usa sus herramientas, registra hipótesis y responde. */
function goodScript(net: SeededNetwork) {
  const [a, b] = net.cases;
  return [
    () => [
      call("obtener_red", { red_id: net.label }),
      call("centralidad_identificadores", { red_id: net.label }),
      call("linea_de_tiempo", { red_id: net.label }),
      call("estadisticas_territoriales", { red_id: net.label, nivel: "cuadricula" }),
      call("obtener_ficha", { caso_id: a!.code }),
    ],
    () => [
      call("comparar_guiones", { caso_a: a!.code, caso_b: b!.code }),
      call("registrar_hipotesis", {
        red_id: net.label,
        texto: `La voz de V-${net.voices[0]} y V-${net.voices[1]} corresponde a quien hace las llamadas`,
        evidencia_ids: [`V-${net.voices[0]}`, `VIN-${net.links[0]!.num}`],
        confianza: "alta",
      }),
      call("registrar_hipotesis", { red_id: net.label, texto: "Hay una tercera cuenta que nadie reportó", evidencia_ids: ["EV-ZZ9"], confianza: "baja" }),
    ],
    () => [final(perfil(net))],
  ];
}

describe("Cartógrafo", () => {
  it("usa sus herramientas, registra hipótesis en borrador, separa hechos e hipótesis y pasa el validador", async () => {
    const net = await seedNetwork({ n: 3 });
    const meta = fakeMeta(goodScript(net));
    const analyst = await loginAs("analyst", net.orgId);
    const res = await apiJson<ProfileView>(`/v1/console/networks/${net.networkId}/cartografo`, { token: analyst.token, json: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = res.body;
    expect(p.status).toBe("borrador");
    expect(p.model).toBe("muse-spark-1.3");
    expect(p.citation_check).toEqual({ ok: true, sin_cita: [], citas_inexistentes: [] });
    // Hechos verificables y datos de la base, no del modelo.
    expect(p.perfil.red).toBe(net.label);
    expect(p.perfil.casos).toBe(3);
    expect(p.perfil.sectores).toEqual([
      { sector: "bodega", casos: 2 },
      { sector: "mototaxi", casos: 1 },
    ]);
    expect(p.perfil.hechos).toHaveLength(2);
    // Hipótesis: la registrada con la herramienta y la de la salida final, todas en borrador.
    expect(p.hypotheses.map((h) => h.status)).toEqual(["borrador", "borrador"]);
    expect(p.hypotheses.map((h) => h.confianza).sort()).toEqual(["alta", "media"]);
    expect(p.perfil.hipotesis).toHaveLength(2);
    // Menos de 5 casos: territorio vacío aunque el modelo lo haya llenado.
    expect(p.perfil.territorio).toEqual([]);

    // Lo que vio el modelo: sin datos de las víctimas.
    expect(meta.responses()).toHaveLength(3);
    const outputs = meta.responses().flatMap(toolOutputs);
    expect(outputs).toHaveLength(8);
    const all = outputs.join("\n");
    for (const d of net.devices) {
      expect(all).not.toContain(d.id);
      expect(all).not.toContain(d.pseudonym);
    }
    expect(all).not.toContain(net.orgId);
    expect(all).toContain(net.identifier);
    expect(all).toContain("…488");
    const stats = JSON.parse(outputs[3]!) as { zonas: unknown[] };
    expect(stats.zonas).toEqual([]);
    // La hipótesis con una cita inventada se rechaza en la herramienta.
    expect(outputs[7]).toContain("no aparecen en lo que devolvieron tus herramientas: EV-ZZ9");
    // Las herramientas viajan en la petición y sin búsqueda web.
    const first = meta.responses()[0]!.body as { tools: Array<{ name: string }>; text: { format: { name: string } } };
    expect(first.tools.map((t) => t.name).sort()).toEqual(
      ["centralidad_identificadores", "comparar_guiones", "estadisticas_territoriales", "linea_de_tiempo", "obtener_ficha", "obtener_red", "registrar_hipotesis"].sort(),
    );
    expect(first.text.format.name).toBe("perfil_red");

    const run = await env.DB.prepare("SELECT status, attempts, tool_calls FROM agent_runs WHERE agent = 'cartografo' AND target_id = ?").bind(net.networkId).first();
    expect(run).toMatchObject({ status: "ok", attempts: 1, tool_calls: 8 });
    const costs = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_costs WHERE operation = 'cartografo' AND status = 'ok'").first<{ n: number }>();
    expect(costs!.n).toBeGreaterThanOrEqual(3);
    const auditRow = await env.DB.prepare("SELECT details_json FROM audit_log WHERE action = 'agent.cartografo.result' AND target_id = ?").bind(net.networkId).first<{ details_json: string }>();
    expect(JSON.parse(auditRow!.details_json)).toMatchObject({ status: "borrador", citas_ok: true, hipotesis: 2 });

    // Revisión humana: aprobar una hipótesis y el perfil.
    const hyp = p.hypotheses.find((h) => h.confianza === "alta")!;
    const reviewer = await loginAs("reviewer", net.orgId);
    expect((await api(`/v1/console/profiles/${p.id}/decision`, { token: reviewer.token, json: { decision: "aprobar" } })).status).toBe(403);
    const hd = await apiJson<{ status: string }>(`/v1/console/hypotheses/${hyp.id}/decision`, { token: analyst.token, json: { decision: "aprobar" } });
    expect(hd.body.status).toBe("aprobada");
    const pd = await apiJson<ProfileView>(`/v1/console/profiles/${p.id}/decision`, { token: analyst.token, json: { decision: "aprobar" } });
    expect(pd.status).toBe(200);
    expect(pd.body.status).toBe("aprobado");
    const list = await apiJson<{ profiles: ProfileView[] }>(`/v1/console/networks/${net.networkId}/profiles`, { token: analyst.token });
    expect(list.body.profiles[0]!.hypotheses.find((h) => h.id === hyp.id)!.status).toBe("aprobada");
  });

  it("una salida con una cita inventada se reintenta una vez y queda inválida", async () => {
    const net = await seedNetwork({ n: 3 });
    const bad = perfil(net, {
      hechos: [{ texto: "La cuenta aparece en 9 casos", evidencia: ["EV-ZZ9"] }],
      hipotesis: [{ texto: "Hay una cuenta recaudadora", confianza: "baja", evidencia: ["ID-ffffff"] }],
    });
    const meta = fakeMeta([() => [final(bad)], () => [final(bad)]]);
    const analyst = await loginAs("analyst", net.orgId);
    const res = await apiJson<ProfileView>(`/v1/console/networks/${net.networkId}/cartografo`, { token: analyst.token, json: { model: "muse-spark-1.3" } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("invalido");
    expect(res.body.citation_check.ok).toBe(false);
    expect(res.body.citation_check.citas_inexistentes).toEqual(expect.arrayContaining(["EV-ZZ9", "ID-ffffff"]));
    expect(meta.responses()).toHaveLength(2);
    expect(String(meta.responses()[1]!.body.input)).toContain("no pasó el validador de citas");
    expect(String(meta.responses()[1]!.body.input)).toContain("EV-ZZ9");
    const run = await env.DB.prepare("SELECT status, attempts FROM agent_runs WHERE agent = 'cartografo' AND target_id = ?").bind(net.networkId).first();
    expect(run).toMatchObject({ status: "invalido", attempts: 2 });
    // Nada de un perfil inválido se puede aprobar.
    const hyp = res.body.hypotheses[0]!;
    expect((await api(`/v1/console/hypotheses/${hyp.id}/decision`, { token: analyst.token, json: { decision: "aprobar" } })).status).toBe(409);
    expect((await api(`/v1/console/profiles/${res.body.id}/decision`, { token: analyst.token, json: { decision: "aprobar" } })).status).toBe(409);
  });

  it("con 5 casos y 3 víctimas el territorio sale agregado del servidor, nunca del modelo", async () => {
    const net = await seedNetwork({ n: 5, victims: 3 });
    const meta = fakeMeta([
      () => [call("estadisticas_territoriales", { red_id: net.label, nivel: "cuadricula" }), call("obtener_red", { red_id: net.label })],
      () => [final(perfil(net, { territorio: [{ zona: "Jr. Inventado 123", casos: 5 }] }))],
    ]);
    const analyst = await loginAs("analyst", net.orgId);
    const res = await apiJson<ProfileView>(`/v1/console/networks/${net.networkId}/cartografo`, { token: analyst.token, json: {} });
    expect(res.status).toBe(200);
    expect(res.body.perfil.territorio).toEqual([{ zona: "Lima Este - E12", casos: 5 }]);
    const stats = JSON.parse(toolOutputs(meta.responses()[1]!)[0]!) as { zonas: unknown[] };
    expect(stats.zonas).toEqual([{ zona: "Lima Este - E12", casos: 5 }]);
  });

  it("con 5 casos de solo 2 víctimas no hay territorio aunque el modelo lo devuelva", async () => {
    const net = await seedNetwork({ n: 5, victims: 2 });
    // Sin herramientas sus citas no valen (se reintenta y queda inválido), pero el territorio igual se vacía.
    const out = () => [final(perfil(net, { territorio: [{ zona: "Lima Este - E12", casos: 5 }] }))];
    fakeMeta([], out);
    const analyst = await loginAs("analyst", net.orgId);
    const res = await apiJson<ProfileView>(`/v1/console/networks/${net.networkId}/cartografo`, { token: analyst.token, json: {} });
    expect(res.status).toBe(200);
    expect(res.body.perfil.territorio).toEqual([]);
  });

  it("las herramientas solo responden por la red analizada", async () => {
    const net = await seedNetwork({ n: 2 });
    const other = await seedNetwork({ n: 2 });
    const finalOut = () => [final(perfil(net, { hechos: [{ texto: "La red tiene 2 casos", evidencia: [net.label] }], hipotesis: [] }))];
    const meta = fakeMeta([() => [call("obtener_red", { red_id: other.label }), call("obtener_ficha", { caso_id: other.cases[0]!.code })]], finalOut);
    const analyst = await loginAs("analyst", net.orgId);
    const res = await apiJson<ProfileView>(`/v1/console/networks/${net.networkId}/cartografo`, { token: analyst.token, json: {} });
    expect(res.status).toBe(200);
    const outs = toolOutputs(meta.responses()[1]!);
    expect(outs[0]).toContain(`Solo puedes consultar la red ${net.label}`);
    expect(outs[1]).toContain("no pertenece a la red");
    // No vio la red: no puede citarla.
    expect(res.body.status).toBe("invalido");
  });

  it("Muse Wonder (no esencial) se bloquea con el presupuesto al 80 %", async () => {
    const net = await seedNetwork({ n: 2 });
    const meta = fakeMeta([]);
    const analyst = await loginAs("analyst", net.orgId);
    await recordCost(env, { model: "muse-spark-1.3", operation: "prueba", cost_usd: 121, essential: true, status: "ok" });
    try {
      const res = await apiJson<{ error: { code: string } }>(`/v1/console/networks/${net.networkId}/cartografo`, {
        token: analyst.token,
        json: { model: "muse-wonder-1.0" },
      });
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe("budget_exceeded");
      expect(meta.requests).toHaveLength(0);
      const blocked = await env.DB.prepare("SELECT model, essential FROM api_costs WHERE status = 'blocked' AND operation = 'cartografo'").first();
      expect(blocked).toEqual({ model: "muse-wonder-1.0", essential: 0 });
    } finally {
      await env.DB.prepare("DELETE FROM api_costs WHERE operation = 'prueba'").run();
    }
  });
});
