import * as S from "@blindaje/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { HttpClient, MemoryTokenStore } from "../api/client";
import { parseServerTiming, requestLog, routeOf } from "../api/requestLog";
import { NAV } from "../components/Layout";
import { can } from "../lib/permissions";
import { DEMO_PASSWORD, demoUser } from "../mock/fixtures";
import { MockApi } from "../mock/mockApi";
import { MockMonitorApi } from "../mock/monitorMock";
import { actionLabel, measuredAgo, median, MonitorBody, STATE_CHIP } from "./MonitorView";

const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

async function mockMonitor() {
  const api = new MockApi({ latency: 0, persist: false });
  await api.login(demoUser("admin").email, DEMO_PASSWORD);
  return new MockMonitorApi(api).monitor();
}

afterEach(() => requestLog.clear());

describe("panel de monitoreo", () => {
  it("solo la administración lo ve, y es lo primero de su menú", () => {
    expect(can("admin", "monitor.view")).toBe(true);
    expect(can("analyst", "monitor.view")).toBe(false);
    expect(can("reviewer", "monitor.view")).toBe(false);
    expect(NAV.filter((n) => can("admin", n.cap))[0]?.to).toBe("/monitoreo");
    // La administración ve todo el menú.
    expect(NAV.every((n) => can("admin", n.cap))).toBe(true);
  });

  it("el modo simulado cumple el contrato y sus colas salen del MockApi", async () => {
    const m = await mockMonitor();
    expect(S.ConsoleMonitor.safeParse(m).success).toBe(true);
    expect(m.vinculos.probable + m.vinculos.por_revisar).toBeGreaterThan(0);
  });

  it("cada estado lleva texto e ícono, no solo color; las colas llevan a su vista", async () => {
    const m = await mockMonitor();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MonitorBody m={m} />
      </MemoryRouter>,
    );
    const t = text(html);
    expect(t).toContain("Base de datos (D1)");
    expect(t).toContain("Contenedor ML Contenedor no desplegado");
    expect(t).toContain(STATE_CHIP.apagado.label);
    expect(t).toContain(STATE_CHIP.ok.label);
    expect(html).toContain('href="/vinculos"');
    expect(t).toContain("En modo simulado la consola no habla con la API");
    expect(t).not.toMatch(/undefined|NaN/);
  });

  it("muestra la velocidad de las peticiones de esta pestaña con el desglose del servidor", async () => {
    const fetchImpl = async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json", "server-timing": 'app;dur=72, db;dur=21;desc="3 consultas a D1"' } });
    const client = new HttpClient({ baseUrl: "https://api.blindaje.test", store: new MemoryTokenStore(), fetch: fetchImpl });
    await client.json("GET", "/v1/console/links/01JBX7ZK3Q9V2M8T4R6N5P0W1Y", { auth: false });
    const [rec] = requestLog.entries();
    expect(rec).toMatchObject({ method: "GET", ruta: "/v1/console/links/:id", status: 200, servidor_ms: 72, db_ms: 21, db_n: 3 });

    const m = { ...(await mockMonitor()), api: { version: "0.1.0", entorno: "x", colo: "EZE", ubicacion: "gcp:us-east1", ms: 80 } };
    const t = text(
      renderToStaticMarkup(
        <MemoryRouter>
          <MonitorBody m={m} />
        </MemoryRouter>,
      ),
    );
    expect(t).toContain("GET /console/links/:id");
    expect(t).toContain("3 · 21 ms");
    expect(t).toContain("corre en gcp:us-east1, junto a la base");
  });

  it("lee Server-Timing, quita ids de las rutas y resume con la mediana", () => {
    expect(parseServerTiming('app;dur=103, db;dur=45;desc="1 consultas a D1", do;dur=58;desc="2 llamadas a Durable Objects"')).toEqual({
      app: 103,
      db: 45,
      dbN: 1,
    });
    expect(parseServerTiming(null)).toEqual({ app: null, db: null, dbN: null });
    expect(routeOf("https://x.test/v1/console/expedientes/abc12345678/pdf?x=1")).toBe("/v1/console/expedientes/:id/pdf");
    expect(routeOf("https://x.test/v1/console/monitoreo")).toBe("/v1/console/monitoreo");
    expect(median([300, 100, 200])).toBe(200);
    expect(median([100, 200])).toBe(150);
    expect(median([])).toBeNull();
    expect(actionLabel("vectors.query")).toBe("Consultó el motor vectorial");
    expect(actionLabel("algo.nuevo")).toBe("algo.nuevo");
    expect(measuredAgo("2026-10-29T20:00:00Z", "2026-10-29T20:00:02Z")).toBeNull();
    expect(measuredAgo("2026-10-29T20:00:00Z", "2026-10-29T20:00:41Z")).toBe("medido hace 41 s");
    expect(measuredAgo("2026-10-29T20:00:00Z", "2026-10-29T20:05:00Z")).toBe("medido hace 5 min");
  });
});
