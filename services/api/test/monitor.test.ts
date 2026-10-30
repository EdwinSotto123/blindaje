import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ConsoleMonitor } from "@blindaje/shared";
import { setMetaFetchForTests } from "../src/agents/common";
import { audit } from "../src/audit";
import { metaNoSimulada } from "./fakes";
import { api, apiJson, loginAs, seedOrg } from "./helpers";

afterEach(() => setMetaFetchForTests(metaNoSimulada));

describe("monitoreo de la administración", () => {
  it("solo administración; mide los servicios y cuenta las colas sin datos de casos", async () => {
    const { orgId } = await seedOrg();
    const admin = await loginAs("admin", orgId);
    const reviewer = await loginAs("reviewer", orgId);
    const analyst = await loginAs("analyst", orgId);
    const metaCalls: string[] = [];
    setMetaFetchForTests(async (url) => {
      metaCalls.push(url);
      return Response.json({ data: [] });
    });
    await audit(env, { actor_type: "admin", actor_id: "u-prueba", action: "monitor.prueba", target_type: null, target_id: null, details: { nota: "no sale" } });

    expect((await api("/v1/console/monitoreo", { token: reviewer.token })).status).toBe(403);
    expect((await api("/v1/console/monitoreo", { token: analyst.token })).status).toBe(403);

    const res = await apiJson<ConsoleMonitor>("/v1/console/monitoreo", { token: admin.token });
    expect(res.status).toBe(200);
    expect(ConsoleMonitor.safeParse(res.body).success).toBe(true);
    const byName = new Map(res.body.servicios.map((s) => [s.servicio, s]));
    expect(byName.get("d1")?.estado).toMatch(/ok|lento/);
    // En las pruebas no hay Chroma ni contenedor ML: se dicen apagados, no caídos.
    expect(byName.get("chroma")?.estado).toBe("apagado");
    expect(byName.get("ml")?.estado).toBe("apagado");
    expect(byName.get("meta")?.estado).toMatch(/ok|lento/);
    expect(metaCalls).toEqual(["https://api.meta.ai/v1/models"]);
    // La medición de Meta se reutiliza 30 s: la segunda lectura no vuelve a llamar.
    expect((await api("/v1/console/monitoreo", { token: admin.token })).status).toBe(200);
    expect(metaCalls).toHaveLength(1);
    expect(byName.get("auditoria")?.detalle).toMatch(/hasta la entrada \d+/);
    // La actividad lleva la acción, nunca sus detalles.
    const entry = res.body.actividad.find((a) => a.accion === "monitor.prueba");
    expect(entry).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain("no sale");
    expect(res.body.presupuesto.presupuesto_usd).toBeGreaterThan(0);
  });

  it("si Meta no responde, el panel igual sale y la marca caída", async () => {
    const { orgId } = await seedOrg();
    const admin = await loginAs("admin", orgId);
    setMetaFetchForTests(async () => new Response("no", { status: 503 }));
    await env.CONFIG.delete("monitor:meta");
    const res = await apiJson<ConsoleMonitor>("/v1/console/monitoreo", { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.body.servicios.find((s) => s.servicio === "meta")?.estado).toBe("caido");
  });

  it("cada respuesta trae sus tiempos por recurso (Server-Timing)", async () => {
    const { orgId } = await seedOrg();
    const admin = await loginAs("admin", orgId);
    const res = await api("/v1/console/networks", { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toMatch(/app;dur=\d+.*db;dur=\d+;desc="\d+ consultas a D1"/);
  });
});
