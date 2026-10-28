import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { signAccessToken } from "../src/lib/jwt";
import { PBKDF2_ITERATIONS, hashPassword, verifyPassword } from "../src/lib/password";
import { api, apiJson, createUser, newDeviceKeys, registerDevice, seedOrg, signRefresh } from "./helpers";

describe("registro de dispositivo", () => {
  it("registra con invitación válida y entrega seudónimo y tokens", async () => {
    const { invite, orgId } = await seedOrg();
    const d = await registerDevice(invite);
    expect(d.pseudonym).toMatch(/^V-[A-Z0-9]{4}$/);
    expect(d.pseudonym).toMatch(/[A-Z]/);
    expect(d.org.id).toBe(orgId);
    expect(d.access_token.split(".")).toHaveLength(3);
    const list = await api("/v1/cases", { token: d.access_token });
    expect(list.status).toBe(200);
  });

  it("rechaza invitaciones inexistentes, agotadas o llaves inválidas", async () => {
    const { jwk } = await newDeviceKeys();
    const bad = await apiJson("/v1/auth/device/register", { json: { invite_code: "NO-EXISTE", public_key: jwk, platform: "android" } });
    expect(bad.status).toBe(400);

    const { invite } = await seedOrg({ maxUses: 1 });
    await registerDevice(invite);
    const exhausted = await apiJson("/v1/auth/device/register", { json: { invite_code: invite, public_key: jwk, platform: "android" } });
    expect(exhausted.status).toBe(400);
    expect((exhausted.body as { error: { code: string } }).error.code).toBe("bad_request");

    const { invite: inv2 } = await seedOrg();
    const badKey = await apiJson("/v1/auth/device/register", {
      json: { invite_code: inv2, public_key: { kty: "EC", crv: "P-256", x: "AAAA", y: "BBBB" }, platform: "android" },
    });
    expect(badKey.status).toBe(400);
  });
});

describe("tokens de acceso", () => {
  it("exige token y rechaza tokens alterados o vencidos", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    expect((await api("/v1/cases")).status).toBe(401);
    const tampered = d.access_token.slice(0, -2) + (d.access_token.endsWith("A") ? "BB" : "AA");
    expect((await api("/v1/cases", { token: tampered })).status).toBe(401);
    const past = Math.floor(Date.now() / 1000) - 3600;
    const expired = await signAccessToken(env.JWT_SECRET, { sub: d.device_id, role: "victim", org: d.org.id, pse: d.pseudonym }, past);
    expect((await api("/v1/cases", { token: expired })).status).toBe(401);
    const otherSecret = await signAccessToken("otro-secreto-que-no-es-el-del-worker-0123456789", {
      sub: d.device_id,
      role: "victim",
      org: d.org.id,
    });
    expect((await api("/v1/cases", { token: otherSecret })).status).toBe(401);
    const res = await apiJson<{ error: { code: string; message: string } }>("/v1/cases");
    expect(res.body.error.code).toBe("unauthorized");
    expect(typeof res.body.error.message).toBe("string");
  });
});

describe("refresh de dispositivo con firma ECDSA", () => {
  it("rota el refresh token con firma válida y detecta reutilización", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const ts = Date.now();
    const ok = await apiJson<{ access_token: string; refresh_token: string }>("/v1/auth/device/refresh", {
      json: { device_id: d.device_id, refresh_token: d.refresh_token, timestamp: ts, signature: await signRefresh(d.keys.privateKey, d.device_id, ts) },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.refresh_token).not.toBe(d.refresh_token);

    // Reusar el token viejo revoca toda la familia, incluido el nuevo.
    const ts2 = Date.now();
    const reuse = await apiJson("/v1/auth/device/refresh", {
      json: { device_id: d.device_id, refresh_token: d.refresh_token, timestamp: ts2, signature: await signRefresh(d.keys.privateKey, d.device_id, ts2) },
    });
    expect(reuse.status).toBe(401);
    const ts3 = Date.now();
    const afterReuse = await apiJson("/v1/auth/device/refresh", {
      json: { device_id: d.device_id, refresh_token: ok.body.refresh_token, timestamp: ts3, signature: await signRefresh(d.keys.privateKey, d.device_id, ts3) },
    });
    expect(afterReuse.status).toBe(401);
  });

  it("rechaza firma de otra llave, firma inválida y hora desfasada", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const other = await newDeviceKeys();
    const ts = Date.now();
    const wrongKey = await apiJson("/v1/auth/device/refresh", {
      json: { device_id: d.device_id, refresh_token: d.refresh_token, timestamp: ts, signature: await signRefresh(other.keys.privateKey, d.device_id, ts) },
    });
    expect(wrongKey.status).toBe(401);
    const garbage = await apiJson("/v1/auth/device/refresh", {
      json: { device_id: d.device_id, refresh_token: d.refresh_token, timestamp: ts, signature: "no-es-una-firma" },
    });
    expect(garbage.status).toBe(401);
    const old = Date.now() - 6 * 60 * 1000;
    const skew = await apiJson("/v1/auth/device/refresh", {
      json: { device_id: d.device_id, refresh_token: d.refresh_token, timestamp: old, signature: await signRefresh(d.keys.privateKey, d.device_id, old) },
    });
    expect(skew.status).toBe(401);
    // El refresh token sigue sirviendo con una firma correcta: los intentos fallidos no lo consumieron.
    const ts2 = Date.now();
    const good = await apiJson("/v1/auth/device/refresh", {
      json: { device_id: d.device_id, refresh_token: d.refresh_token, timestamp: ts2, signature: await signRefresh(d.keys.privateKey, d.device_id, ts2) },
    });
    expect(good.status).toBe(200);
  });
});

describe("consola", () => {
  it("guarda contraseñas con PBKDF2-SHA256 de 100k iteraciones", async () => {
    const h = await hashPassword("una-clave-larga-de-prueba");
    expect(h.startsWith(`pbkdf2-sha256$${PBKDF2_ITERATIONS}$`)).toBe(true);
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100_000);
    expect(await verifyPassword("una-clave-larga-de-prueba", h)).toBe(true);
    expect(await verifyPassword("otra-clave", h)).toBe(false);
  });

  it("login, refresh rotativo, /me y logout", async () => {
    const { orgId } = await seedOrg();
    const u = await createUser("reviewer", orgId);
    const bad = await apiJson("/v1/auth/console/login", { json: { email: u.email, password: "incorrecta-123" } });
    expect(bad.status).toBe(401);
    const unknown = await apiJson("/v1/auth/console/login", { json: { email: "nadie@prueba.blindaje.test", password: "incorrecta-123" } });
    expect(unknown.status).toBe(401);

    const login = await apiJson<{ access_token: string; refresh_token: string; user: { role: string; org: { id: string } } }>(
      "/v1/auth/console/login",
      { json: { email: u.email.toUpperCase(), password: u.password } },
    );
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("reviewer");
    expect(login.body.user.org.id).toBe(orgId);

    const me = await apiJson<{ email: string }>("/v1/console/me", { token: login.body.access_token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(u.email);

    const ref = await apiJson<{ refresh_token: string }>("/v1/auth/console/refresh", { json: { refresh_token: login.body.refresh_token } });
    expect(ref.status).toBe(200);
    const again = await apiJson("/v1/auth/console/refresh", { json: { refresh_token: login.body.refresh_token } });
    expect(again.status).toBe(401);

    const login2 = await apiJson<{ access_token: string; refresh_token: string }>("/v1/auth/console/login", {
      json: { email: u.email, password: u.password },
    });
    const out = await api("/v1/auth/logout", { token: login2.body.access_token, json: { refresh_token: login2.body.refresh_token } });
    expect(out.status).toBe(204);
    const afterLogout = await apiJson("/v1/auth/console/refresh", { json: { refresh_token: login2.body.refresh_token } });
    expect(afterLogout.status).toBe(401);
  });

  it("no deja entrar a usuarios deshabilitados", async () => {
    const { orgId } = await seedOrg();
    const u = await createUser("analyst", orgId, { disabled: true });
    const res = await apiJson("/v1/auth/console/login", { json: { email: u.email, password: u.password } });
    expect(res.status).toBe(401);
  });
});
