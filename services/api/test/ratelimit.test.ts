import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { apiJson, newDeviceKeys } from "./helpers";

const realFetch = globalThis.fetch;

function mockTurnstile(success: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("challenges.cloudflare.com/turnstile")) return Response.json({ success });
    return realFetch(input, init);
  });
}

afterEach(() => vi.restoreAllMocks());

const pilot = {
  org_name: "Asociación ficticia de prueba",
  contact_name: "Contacto ficticio",
  contact: "contacto@prueba.blindaje.test",
  sector: "bodega",
  district: "Lima Este",
  members: 40,
  lang: "es",
  turnstile_token: "XXXX.DUMMY.TOKEN.XXXX",
};

describe("rate limiting con Durable Object", () => {
  it("el limitador cuenta por clave y devuelve retry_after", async () => {
    const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName("test:ip:1.2.3.4"));
    for (let i = 0; i < 3; i++) expect((await stub.hit(3, 60)).allowed).toBe(true);
    const denied = await stub.hit(3, 60);
    expect(denied.allowed).toBe(false);
    expect(denied.retry_after).toBeGreaterThan(0);
    const other = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName("test:ip:5.6.7.8"));
    expect((await other.hit(3, 60)).allowed).toBe(true);
  });

  it("la solicitud de piloto se limita por IP (5 por hora) con 429 y retry-after", async () => {
    mockTurnstile(true);
    const ip = "203.0.113.77";
    for (let i = 0; i < 5; i++) {
      const res = await apiJson<{ id: string }>("/v1/public/pilot-requests", { json: pilot, ip });
      expect(res.status, `intento ${i + 1}`).toBe(201);
    }
    const limited = await apiJson<{ error: { code: string } }>("/v1/public/pilot-requests", { json: pilot, ip });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    // Otra IP no se ve afectada.
    expect((await apiJson("/v1/public/pilot-requests", { json: pilot, ip: "203.0.113.78" })).status).toBe(201);
    const row = await env.DB.prepare("SELECT ip_hash FROM pilot_requests LIMIT 1").first<{ ip_hash: string }>();
    expect(row!.ip_hash).not.toContain("203.0.113");
  });

  it("rechaza la solicitud de piloto si Turnstile no aprueba", async () => {
    mockTurnstile(false);
    const res = await apiJson<{ error: { code: string } }>("/v1/public/pilot-requests", { json: pilot });
    expect(res.status).toBe(403);
    const invalid = await apiJson("/v1/public/pilot-requests", { json: { ...pilot, turnstile_token: "" } });
    expect(invalid.status).toBe(400);
  });

  it("el registro de dispositivos se limita por IP", async () => {
    const ip = "198.51.100.9";
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await apiJson("/v1/auth/device/register", { json: { invite_code: "NO-EXISTE", public_key: {}, platform: "android" }, ip });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
  it("sin código de invitación el registro sigue limitado por IP", async () => {
    const ip = "198.51.100.10";
    const { jwk } = await newDeviceKeys();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await apiJson("/v1/auth/device/register", { json: { public_key: jwk, platform: "android" }, ip })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("CORS y salud", () => {
  it("health responde y CORS solo permite orígenes conocidos", async () => {
    const h = await apiJson<{ ok: boolean; env: string; version: string }>("/v1/health");
    expect(h.body).toMatchObject({ ok: true, env: "test" });
    const ok = await fetchWithOrigin("http://localhost:5173");
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const deployed = await fetchWithOrigin("https://blindaje-console.equipo.workers.dev");
    expect(deployed.headers.get("access-control-allow-origin")).toBe("https://blindaje-console.equipo.workers.dev");
    const evil = await fetchWithOrigin("https://evil.example.com");
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});

async function fetchWithOrigin(origin: string) {
  const { SELF } = await import("cloudflare:test");
  return SELF.fetch("https://api.blindaje.test/v1/health", {
    method: "OPTIONS",
    headers: { origin, "access-control-request-method": "GET", "cf-connecting-ip": "192.0.2.1" },
  });
}
