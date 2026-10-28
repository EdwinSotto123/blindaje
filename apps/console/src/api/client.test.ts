import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, HttpClient, MemoryTokenStore, errorMessage, type Session } from "./client";
import { HttpApi } from "./httpApi";

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

/**
 * fetch falso: el access token válido es `valid`; el refresh `r1` entrega `valid` y rota a `r2`.
 */
function fakeApi(opts: { refreshOk?: boolean; refreshDelay?: number } = {}) {
  const calls: Call[] = [];
  let refreshes = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body });
    const path = new URL(url).pathname;
    if (path === "/v1/auth/console/refresh") {
      refreshes++;
      if (opts.refreshDelay) await new Promise((r) => setTimeout(r, opts.refreshDelay));
      if (opts.refreshOk === false) return json(401, { error: { code: "unauthorized", message: "Refresh vencido" } });
      return json(200, { access_token: "valid", refresh_token: "r2", expires_in: 900 });
    }
    if (headers.get("authorization") !== "Bearer valid") {
      return json(401, { error: { code: "unauthorized", message: "Token vencido" } });
    }
    if (path === "/v1/console/me") return json(200, { id: "u1", email: "a@b.pe", display_name: "A", role: "analyst", org: { id: "o", name: "O" } });
    if (path === "/v1/console/links/x") return json(404, { error: { code: "not_found", message: "No existe ese vínculo." } });
    if (path.startsWith("/v1/console/evidence/")) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/wav" } });
    return json(200, { ok: true, path });
  });
  return { fetchImpl, calls, refreshes: () => refreshes };
}

const NOW = 1_800_000_000_000;
const fresh = (accessToken: string | null): Session => ({ accessToken, refreshToken: "r1", expiresAt: NOW + 600_000 });

function client(store: MemoryTokenStore, fetchImpl: typeof fetch, onSessionExpired?: () => void) {
  return new HttpClient({ baseUrl: BASE, store, fetch: fetchImpl, now: () => NOW, ...(onSessionExpired ? { onSessionExpired } : {}) });
}

describe("HttpClient", () => {
  it("adjunta el access token", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    await c.json("GET", "/v1/console/me");
    expect(api.calls[0]).toMatchObject({ url: `${BASE}/v1/console/me`, auth: "Bearer valid" });
    expect(api.refreshes()).toBe(0);
  });

  it("ante un 401 renueva la sesión una vez y reintenta con el token nuevo", async () => {
    const api = fakeApi();
    const store = new MemoryTokenStore(fresh("vencido"));
    const c = client(store, api.fetchImpl);
    const res = await c.json<{ ok: boolean }>("GET", "/v1/console/costs");
    expect(res.ok).toBe(true);
    expect(api.calls.map((x) => new URL(x.url).pathname)).toEqual(["/v1/console/costs", "/v1/auth/console/refresh", "/v1/console/costs"]);
    expect(api.calls[1]!.body).toEqual({ refresh_token: "r1" });
    expect(api.calls[2]!.auth).toBe("Bearer valid");
    expect(store.get()?.refreshToken).toBe("r2");
  });

  it("varias peticiones con 401 comparten un solo refresh", async () => {
    const api = fakeApi({ refreshDelay: 20 });
    const c = client(new MemoryTokenStore(fresh("vencido")), api.fetchImpl);
    await Promise.all([c.json("GET", "/v1/console/a"), c.json("GET", "/v1/console/b"), c.json("GET", "/v1/console/c")]);
    expect(api.refreshes()).toBe(1);
  });

  it("si el refresh falla, limpia la sesión, avisa y lanza 401", async () => {
    const api = fakeApi({ refreshOk: false });
    const store = new MemoryTokenStore(fresh("vencido"));
    const expired = vi.fn();
    const c = client(store, api.fetchImpl, expired);
    await expect(c.json("GET", "/v1/console/costs")).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(store.get()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(api.refreshes()).toBe(1);
  });

  it("después de recargar la pestaña (sin access token) renueva antes de pedir", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore(fresh(null)), api.fetchImpl);
    await c.json("GET", "/v1/console/me");
    expect(api.calls.map((x) => new URL(x.url).pathname)).toEqual(["/v1/auth/console/refresh", "/v1/console/me"]);
  });

  it("renueva por adelantado si el token está por vencer", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore({ accessToken: "valid", refreshToken: "r1", expiresAt: NOW + 2_000 }), api.fetchImpl);
    await c.json("GET", "/v1/console/me");
    expect(api.refreshes()).toBe(1);
  });

  it("no reintenta en bucle: un 401 después del refresh termina en error", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/refresh")) return json(200, { access_token: "otro", refresh_token: "r2", expires_in: 900 });
      return json(401, { error: { code: "unauthorized", message: "No" } });
    });
    const expired = vi.fn();
    const c = client(new MemoryTokenStore(fresh("vencido")), fetchImpl, expired);
    await expect(c.json("GET", "/v1/console/me")).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("convierte el sobre de error de la API", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    const err = await c.json("GET", "/v1/console/links/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: "not_found", message: "No existe ese vínculo." });
    expect(errorMessage(err)).toBe("No existe ese vínculo.");
  });

  it("nunca envía la credencial a otro origen", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    await expect(c.blob("https://evil.example/v1/console/evidence/1/media")).rejects.toMatchObject({ code: "bad_request" });
    expect(api.calls).toHaveLength(0);
  });

  it("las rutas públicas no llevan Authorization", async () => {
    const api = fakeApi();
    const c = client(new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    await c.json("GET", "/v1/health", { auth: false }).catch(() => undefined);
    expect(api.calls[0]!.auth).toBeNull();
  });
});

describe("HttpApi", () => {
  it("login guarda los tokens y las peticiones siguientes van autenticadas", async () => {
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), method: init?.method ?? "GET", auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(input).endsWith("/v1/auth/console/login")) {
        return json(200, {
          access_token: "valid",
          refresh_token: "r1",
          expires_in: 900,
          user: { id: "u1", email: "analista@demo.pe", display_name: "Analista", role: "analyst", org: { id: "o", name: "O" } },
        });
      }
      return json(200, { links: [{ status: "confirmado" }, { status: "descartado" }, { status: "probable" }] });
    });
    const store = new MemoryTokenStore();
    const api = new HttpApi(BASE, store, fetchImpl);
    const user = await api.login("analista@demo.pe", "contraseña-larga");
    expect(user.role).toBe("analyst");
    expect(calls[0]!.auth).toBeNull();
    // Cola por defecto: sin estado (la API devuelve probable y por_revisar).
    await api.listLinks(["probable", "por_revisar"]);
    expect(calls[1]!.auth).toBe("Bearer valid");
    expect(calls[1]!.url).toBe(`${BASE}/v1/console/links?limit=200`);
    // Un estado: se pasa tal cual.
    await api.listLinks(["confirmado"]);
    expect(calls[2]!.url).toBe(`${BASE}/v1/console/links?status=confirmado&limit=200`);
    // Varios estados: "todos" y se filtra en la consola.
    const reviewed = await api.listLinks(["confirmado", "descartado"]);
    expect(calls[3]!.url).toBe(`${BASE}/v1/console/links?status=todos&limit=200`);
    expect(reviewed.map((l) => l.status)).toEqual(["confirmado", "descartado"]);
  });

  it("descarga medios con Authorization y agrega el rango si falta", async () => {
    const api = fakeApi();
    const http = new HttpApi(BASE, new MemoryTokenStore(fresh("valid")), api.fetchImpl);
    // El reloj real es anterior a NOW, así que el token "fresh" sigue vigente.
    const blob = await http.fetchMedia("/v1/console/evidence/ev-a1/media", { start_ms: 3200, end_ms: 9800 });
    expect(blob.size).toBe(3);
    expect(api.calls[0]).toMatchObject({ url: `${BASE}/v1/console/evidence/ev-a1/media?start_ms=3200&end_ms=9800`, auth: "Bearer valid" });
    await http.fetchMedia(`${BASE}/v1/console/evidence/ev-a1/media?start_ms=1&end_ms=2`, { start_ms: 3200, end_ms: 9800 });
    expect(api.calls[1]!.url).toBe(`${BASE}/v1/console/evidence/ev-a1/media?start_ms=1&end_ms=2`);
  });

  it("logout revoca el refresh token y limpia la sesión aunque la API falle", async () => {
    const fetchImpl = vi.fn(async () => json(500, {}));
    const store = new MemoryTokenStore(fresh("valid"));
    const api = new HttpApi(BASE, store, fetchImpl);
    await api.logout();
    expect(store.get()).toBeNull();
  });
});
