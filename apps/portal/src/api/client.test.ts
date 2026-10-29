import { describe, expect, it, vi } from "vitest";
import { publicAlerts, publicRecommendations, publicRisk, publicZones } from "../mock/fixtures";
import { ApiRequestError, errorMessage, HttpClient } from "./client";
import { HttpPortalApi } from "./httpApi";

const BASE = "https://api.blindaje.test";

interface Call {
  url: URL;
  method: string;
  auth: string | null;
  credentials: RequestCredentials | undefined;
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** fetch falso con las rutas públicas. `overrides` reemplaza la respuesta de una ruta. */
function fakeApi(overrides: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), credentials: init?.credentials });
    const override = overrides[url.pathname];
    if (override) return override();
    const zona = url.searchParams.get("zona") ?? "";
    const sector = url.searchParams.get("sector");
    if (url.pathname === "/v1/public/zones") return json(200, publicZones());
    if (url.pathname === "/v1/public/risk") return json(200, publicRisk(zona, sector));
    if (url.pathname === "/v1/public/recommendations") return json(200, { recommendations: publicRecommendations(zona, sector) });
    if (url.pathname === "/v1/public/alerts") return json(200, publicAlerts(zona));
    return json(404, { error: { code: "not_found", message: "No existe." } });
  });
  return { fetchImpl, calls };
}

describe("HttpClient del portal público", () => {
  it("nunca manda credenciales: ni Authorization ni cookies", async () => {
    const api = fakeApi();
    const c = new HttpClient({ baseUrl: BASE, fetch: api.fetchImpl });
    await c.json("GET", "/v1/public/zones");
    expect(api.calls[0]).toMatchObject({ method: "GET", auth: null, credentials: "omit" });
  });

  it("solo habla con la API configurada", async () => {
    const api = fakeApi();
    const c = new HttpClient({ baseUrl: BASE, fetch: api.fetchImpl });
    await expect(c.json("GET", "https://otro.example/v1/public/zones")).rejects.toThrow(/no pertenece a la API/);
    expect(api.calls).toHaveLength(0);
  });

  it("convierte los errores en ApiRequestError", async () => {
    const api = fakeApi({ "/v1/public/zones": () => json(429, { error: { code: "rate_limited", message: "Espera un minuto." } }) });
    const c = new HttpClient({ baseUrl: BASE, fetch: api.fetchImpl });
    const err = await c.json("GET", "/v1/public/zones").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited" });
  });
});

describe("HttpPortalApi", () => {
  it("usa las rutas públicas con el distrito y el rubro en la consulta", async () => {
    const api = fakeApi();
    const p = new HttpPortalApi(BASE, api.fetchImpl);
    await p.zones();
    await p.risk({ zona: "ate", sector: "bodega" });
    await p.risk({ zona: "ate" });
    await p.alerts({ zona: "ate" });
    await p.recommendations({ zona: "ate", sector: "bodega" });
    expect(api.calls.map((c) => `${c.url.pathname}${c.url.search}`)).toEqual([
      "/v1/public/zones",
      "/v1/public/risk?zona=ate&sector=bodega",
      "/v1/public/risk?zona=ate",
      "/v1/public/alerts?zona=ate",
      "/v1/public/recommendations?zona=ate&sector=bodega",
    ]);
    expect(api.calls.every((c) => c.auth === null)).toBe(true);
  });

  it("acepta las listas envueltas o sueltas, y solo deja los avisos y consejos del distrito pedido", async () => {
    const otro = { ...publicAlerts("ate")[0]!, id: "alert-x", zona: "santa-anita" };
    const api = fakeApi({ "/v1/public/alerts": () => json(200, { alerts: [...publicAlerts("ate"), otro] }) });
    const p = new HttpPortalApi(BASE, api.fetchImpl);
    expect((await p.alerts({ zona: "ate" })).map((a) => a.id)).toEqual(["alert-ate-2", "alert-ate-1"]);
    expect((await p.recommendations({ zona: "ate" })).map((r) => r.id)).toEqual(["rec-002", "rec-001"]);
  });

  it("si la API mandara cifras exactas o un cubo de otros, el portal solo deja rangos", async () => {
    const leaky = {
      ...publicRisk("ate"),
      casos_periodo: 16,
      tendencia: [
        { semana: "2026-10-14", casos: 3 },
        { semana: "2026-10-21", casos: 6 },
      ],
      sectores_afectados: [
        { sector: "bodega", casos: 10 },
        { sector: "Otros rubros (agregado)", casos: 6 },
        { sector: "mercado", casos: 1 },
      ],
    };
    const zones = publicZones();
    const leakyZones = {
      ...zones,
      celdas: zones.celdas.map((c) => (c.distrito === "brena" ? { ...c, casos: "5-9", modalidades: ["algo"] } : c.distrito === "ate" ? { ...c, casos: 16 } : c)),
    };
    const api = fakeApi({ "/v1/public/risk": () => json(200, leaky), "/v1/public/zones": () => json(200, leakyZones) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = new HttpPortalApi(BASE, api.fetchImpl);
    const r = await p.risk({ zona: "ate" });
    expect(r.casos_periodo).toBe("10-19");
    expect(r.tendencia.map((t) => t.casos)).toEqual([null, "5-9"]);
    expect(r.sectores_afectados).toEqual([{ sector: "bodega", casos: "10-19" }]);
    const map = await p.zones();
    // Brena es "sin_datos": aunque llegara un rango o una modalidad, no se dibuja nada.
    expect(map.celdas.find((c) => c.distrito === "brena")).toEqual({ distrito: "brena", nivel: "sin_datos", casos: null, tendencia: null, modalidades: [] });
    expect(map.celdas.find((c) => c.distrito === "ate")!.casos).toBe("10-19");
    // La respuesta no cumplía el contrato: se avisa en la consola.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("el mapa siempre trae los 50 distritos y la nota de sesgo, aunque la respuesta venga incompleta", async () => {
    const api = fakeApi({ "/v1/public/zones": () => json(200, { periodo_dias: 28, actualizado: "", celdas: [{ distrito: "Ate", nivel: "alto", casos: "10-19", tendencia: "sube", modalidades: [] }] }) });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = await new HttpPortalApi(BASE, api.fetchImpl).zones();
    expect(map.celdas).toHaveLength(50);
    expect(map.celdas.find((c) => c.distrito === "ate")!.nivel).toBe("alto");
    expect(map.nota_sesgo).toMatch(/se denuncia más/);
    // Sin la marca `demo`, se asume demostración: la marca "Datos ficticios" no se apaga por omisión.
    expect(map.demo).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("errorMessage", () => {
  it("no muestra el detalle técnico de un error del servidor", async () => {
    const api = fakeApi({ "/v1/public/risk": () => json(500, { error: { code: "internal", message: "D1_ERROR: no such table cases" } }) });
    const p = new HttpPortalApi(BASE, api.fetchImpl);
    const err = await p.risk({ zona: "ate" }).catch((e: unknown) => e);
    expect(errorMessage(err)).toBe("Algo falló de nuestro lado. Intenta otra vez en un momento.");
    expect(errorMessage(err)).not.toMatch(/D1_ERROR/);
  });

  it("sin conexión lo dice en palabras", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/Revisa tu internet/);
  });
});
