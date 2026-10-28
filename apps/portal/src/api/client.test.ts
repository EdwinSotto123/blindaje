import { describe, expect, it, vi } from "vitest";
import { recommendationsBodegas, riskBodegasLimaEste } from "../mock/fixtures";
import { ApiRequestError, errorMessage, HttpClient, MemoryTokenStore, type Session } from "./client";
import { HttpPortalApi } from "./httpApi";

const BASE = "https://api.blindaje.test";

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ME = {
  id: "biz-1",
  email: "bodega@demo.blindaje.pe",
  business_name: "Bodega (ficticia)",
  sector: "bodegas",
  zona: "Lima Este",
  org: { id: "org-bodegas", name: "Gremio (ficticio)" },
};

/** fetch falso: el access token válido es `valid`; el refresh `r1` entrega `valid` y rota a `r2`. */
function fakeApi(opts: { refreshOk?: boolean; refreshDelay?: number; status500?: boolean } = {}) {
  const calls: Call[] = [];
  let refreshes = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body });
    const path = new URL(url).pathname;
    if (path === "/v1/auth/business/login") {
      if (body?.password !== "correcta-123") return json(401, { error: { code: "unauthorized", message: "Credenciales inválidas" } });
      return json(200, { access_token: "valid", refresh_token: "r1", expires_in: 900, business: ME });
    }
    if (path === "/v1/auth/business/refresh") {
      refreshes++;
      if (opts.refreshDelay) await new Promise((r) => setTimeout(r, opts.refreshDelay));
      if (opts.refreshOk === false) return json(401, { error: { code: "unauthorized", message: "Refresh vencido" } });
      return json(200, { access_token: "valid", refresh_token: "r2", expires_in: 900 });
    }
    if (path === "/v1/auth/logout") return new Response(null, { status: 204 });
    if (headers.get("authorization") !== "Bearer valid") {
      return json(401, { error: { code: "unauthorized", message: "Token vencido" } });
    }
    if (opts.status500) return json(500, { error: { code: "internal", message: "D1_ERROR: no such table business_accounts" } });
    if (path === "/v1/business/me") return json(200, ME);
    if (path === "/v1/business/risk") return json(200, riskBodegasLimaEste());
    if (path === "/v1/business/recommendations") return json(200, { recommendations: recommendationsBodegas() });
    if (path === "/v1/business/alerts") return json(200, { alerts: [] });
    return json(404, { error: { code: "not_found", message: "No existe." } });
  });
  return { fetchImpl, calls, refreshes: () => refreshes };
}

const NOW = 1_800_000_000_000;
const fresh = (accessToken: string | null): Session => ({ accessToken, refreshToken: "r1", expiresAt: NOW + 600_000 });

function client(store: MemoryTokenStore, fetchImpl: typeof fetch, onSessionExpired?: () => void) {
  return new HttpClient({
    baseUrl: BASE,
    store,
    fetch: fetchImpl,
    now: () => NOW,
    refreshPath: "/v1/auth/business/refresh",
    ...(onSessionExpired ? { onSessionExpired } : {}),
  });
}

describe("HttpClient del portal", () => {
  it("adjunta el access token", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    await c.json("GET", "/v1/business/me");
    expect(api.calls[0]).toMatchObject({ url: `${BASE}/v1/business/me`, auth: "Bearer valid" });
    expect(api.refreshes()).toBe(0);
  });

  it("ante un 401 renueva la sesión con el refresh de negocios y reintenta", async () => {
    const api = fakeApi();
    const store = new MemoryTokenStore(fresh("vencido"));
    const c = client(store, api.fetchImpl);
    await c.json("GET", "/v1/business/risk");
    expect(api.calls.map((x) => new URL(x.url).pathname)).toEqual(["/v1/business/risk", "/v1/auth/business/refresh", "/v1/business/risk"]);
    expect(api.calls[1]!.body).toEqual({ refresh_token: "r1" });
    expect(api.calls[2]!.auth).toBe("Bearer valid");
    expect(store.get()?.refreshToken).toBe("r2");
  });

  it("varias peticiones con 401 comparten un solo refresh", async () => {
    const api = fakeApi({ refreshDelay: 20 });
    const c = client(new MemoryTokenStore(fresh("vencido")), api.fetchImpl);
    await Promise.all([c.json("GET", "/v1/business/risk"), c.json("GET", "/v1/business/alerts"), c.json("GET", "/v1/business/recommendations")]);
    expect(api.refreshes()).toBe(1);
  });

  it("sin access token (pestaña recargada) renueva antes de pedir", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore(fresh(null)), api.fetchImpl);
    await c.json("GET", "/v1/business/me");
    expect(api.calls.map((x) => new URL(x.url).pathname)).toEqual(["/v1/auth/business/refresh", "/v1/business/me"]);
  });

  it("si el refresh falla, borra la sesión y avisa", async () => {
    const api = fakeApi({ refreshOk: false });
    const store = new MemoryTokenStore(fresh("vencido"));
    const expired = vi.fn();
    const c = client(store, api.fetchImpl, expired);
    await expect(c.json("GET", "/v1/business/me")).rejects.toBeInstanceOf(ApiRequestError);
    expect(store.get()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });

  it("nunca manda la credencial a otro origen", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    await expect(c.json("GET", "https://otro.example/v1/business/me")).rejects.toThrow(/no pertenece a la API/);
    expect(api.calls).toHaveLength(0);
  });
});

describe("HttpPortalApi", () => {
  it("entra con /v1/auth/business/login y guarda la sesión", async () => {
    const api = fakeApi();
    const store = new MemoryTokenStore();
    const p = new HttpPortalApi(BASE, store, api.fetchImpl);
    const me = await p.login("bodega@demo.blindaje.pe", "correcta-123");
    expect(me.business_name).toBe("Bodega (ficticia)");
    expect(store.get()?.refreshToken).toBe("r1");
    expect(api.calls[0]!.auth).toBeNull();
  });

  it("una contraseña equivocada no guarda nada", async () => {
    const api = fakeApi();
    const store = new MemoryTokenStore();
    const p = new HttpPortalApi(BASE, store, api.fetchImpl);
    await expect(p.login("bodega@demo.blindaje.pe", "otra-clave")).rejects.toMatchObject({ status: 401 });
    expect(store.get()).toBeNull();
  });

  it("pide el panorama de su zona y desempaqueta recomendaciones y alertas", async () => {
    const api = fakeApi();
    const p = new HttpPortalApi(BASE, new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    const risk = await p.risk();
    expect(risk.zona).toBe("Lima Este");
    expect(new URL(api.calls[0]!.url).search).toBe("");
    await p.risk({ zona: "Lima Este", sector: "bodegas" });
    expect(new URL(api.calls[1]!.url).searchParams.get("sector")).toBe("bodegas");
    expect((await p.recommendations())[0]!.id).toBe("rec-002");
    expect(await p.alerts()).toEqual([]);
  });

  it("cerrar sesión revoca el refresh y borra la sesión aunque la API falle", async () => {
    const api = fakeApi();
    const store = new MemoryTokenStore(fresh("valid"));
    const p = new HttpPortalApi(BASE, store, api.fetchImpl);
    await p.logout();
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", body: { refresh_token: "r1" } });
    expect(store.get()).toBeNull();
  });

  it("Salir rápido borra la sesión sin esperar a la red", () => {
    const api = fakeApi();
    const store = new MemoryTokenStore(fresh("valid"));
    new HttpPortalApi(BASE, store, api.fetchImpl).forget();
    expect(store.get()).toBeNull();
    expect(api.calls).toHaveLength(0);
  });
});

describe("errorMessage", () => {
  it("no muestra el detalle técnico de un error del servidor", async () => {
    const api = fakeApi({ status500: true });
    const p = new HttpPortalApi(BASE, new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    const err = await p.risk().catch((e: unknown) => e);
    expect(errorMessage(err)).toBe("Algo falló de nuestro lado. Intenta otra vez en un momento.");
    expect(errorMessage(err)).not.toMatch(/D1_ERROR/);
  });

  it("sin conexión lo dice en palabras", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/Revisa tu internet/);
  });
});
