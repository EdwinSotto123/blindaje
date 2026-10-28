import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { bytesToB64Url, utf8 } from "../src/lib/encoding";
import { sha256Hex } from "../src/lib/crypto";
import { hashPassword } from "../src/lib/password";
import { newId, nowIso } from "../src/lib/ids";

export const BASE = "https://api.blindaje.test";

let ipCounter = 1;
/** IP distinta por llamada para no tocar los límites por IP (salvo que el test fije una). */
export function freshIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export interface ApiInit {
  method?: string;
  token?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  ip?: string;
}

export async function api(path: string, init: ApiInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  headers.set("cf-connecting-ip", init.ip ?? freshIp());
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  return SELF.fetch(`${BASE}${path}`, { method: init.method ?? (body ? "POST" : "GET"), headers, body });
}

export async function apiJson<T = Record<string, unknown>>(path: string, init: ApiInit = {}): Promise<{ status: number; body: T }> {
  const res = await api(path, init);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

// ---------------------------------------------------------------------------
// Datos base
// ---------------------------------------------------------------------------

export async function seedOrg(opts: { name?: string; invites?: number; maxUses?: number; isDemo?: boolean } = {}) {
  const orgId = newId();
  await env.DB.prepare("INSERT INTO organizations (id, name, kind, is_demo, created_at) VALUES (?, ?, 'gremio', ?, ?)")
    .bind(orgId, opts.name ?? `Org de prueba ${orgId.slice(0, 4)} (ficticia)`, opts.isDemo ? 1 : 0, nowIso())
    .run();
  const codes: string[] = [];
  for (let i = 0; i < (opts.invites ?? 1); i++) {
    const code = `T${orgId.slice(0, 4).toUpperCase()}-${i}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await env.DB.prepare("INSERT INTO invites (code, org_id, created_at, max_uses, uses) VALUES (?, ?, ?, ?, 0)")
      .bind(code, orgId, nowIso(), opts.maxUses ?? 50)
      .run();
    codes.push(code);
  }
  return { orgId, invite: codes[0]!, codes };
}

export interface TestDevice {
  device_id: string;
  pseudonym: string;
  access_token: string;
  refresh_token: string;
  keys: CryptoKeyPair;
  org: { id: string; name: string };
  raw: Record<string, unknown>;
}

export async function newDeviceKeys(): Promise<{ keys: CryptoKeyPair; jwk: { kty: "EC"; crv: "P-256"; x: string; y: string } }> {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  return { keys, jwk: { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! } };
}

export async function registerDevice(invite: string): Promise<TestDevice> {
  const { keys, jwk } = await newDeviceKeys();
  const res = await apiJson<Record<string, unknown>>("/v1/auth/device/register", {
    json: { invite_code: invite, public_key: jwk, platform: "android" },
  });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  const b = res.body as unknown as Omit<TestDevice, "keys" | "raw">;
  return { ...b, keys, raw: res.body };
}

export async function signRefresh(privateKey: CryptoKey, deviceId: string, timestamp: number): Promise<string> {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, utf8(`refresh:${deviceId}:${timestamp}`));
  return bytesToB64Url(new Uint8Array(sig));
}

export async function createUser(role: "reviewer" | "analyst" | "admin", orgId: string, opts: { disabled?: boolean } = {}) {
  const id = newId();
  const email = `${role}-${id.slice(0, 8)}@prueba.blindaje.test`;
  const password = `Clave-de-prueba-${id.slice(0, 6)}`;
  await env.DB.prepare(
    "INSERT INTO users (id, org_id, email, display_name, password_hash, role, disabled, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
  )
    .bind(id, orgId, email, `Persona ${role} (ficticia)`, await hashPassword(password), role, opts.disabled ? 1 : 0, nowIso())
    .run();
  return { id, email, password };
}

export async function loginAs(role: "reviewer" | "analyst" | "admin", orgId: string) {
  const u = await createUser(role, orgId);
  const res = await apiJson<{ access_token: string; refresh_token: string }>("/v1/auth/console/login", {
    json: { email: u.email, password: u.password },
  });
  if (res.status !== 200) throw new Error(`login failed ${res.status}`);
  return { ...u, token: res.body.access_token, refresh: res.body.refresh_token };
}

export async function createCase(token: string, consent: "solo_denuncia" | "comunitario" = "solo_denuncia") {
  const res = await apiJson<{ id: string; code: string }>("/v1/cases", { token, json: { sector: "bodega", zona: "Lima Este", consent_mode: consent } });
  if (res.status !== 201) throw new Error(`create case failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function upload(
  token: string,
  caseId: string,
  bytes: Uint8Array | ArrayBuffer,
  opts: { tipo?: string; mime?: string; sha?: string; capturedAt?: string } = {},
) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  const sha = opts.sha ?? (await sha256Hex(copy));
  return api(`/v1/cases/${caseId}/evidence`, {
    token,
    body: copy,
    headers: {
      "content-type": opts.mime ?? "audio/ogg",
      "x-evidence-type": opts.tipo ?? "audio",
      "x-content-sha256": sha,
      ...(opts.capturedAt ? { "x-captured-at": opts.capturedAt } : {}),
    },
  });
}

/** Inserta directamente un vínculo (lo que hará el motor de vinculación). */
export async function insertLink(caseX: string, caseY: string, status = "probable", score = 0.93) {
  const [a, b] = caseX < caseY ? [caseX, caseY] : [caseY, caseX];
  const id = newId();
  const num = (await env.DB.prepare("UPDATE counters SET value = value + 1 WHERE name = 'link' RETURNING value").first<{ value: number }>())!.value;
  await env.DB.prepare(
    `INSERT INTO links (id, num, case_a, case_b, score, score_raw, signals_json, calibration_version, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'v0', ?, ?, ?)`,
  )
    .bind(
      id,
      num,
      a,
      b,
      score,
      score,
      JSON.stringify({ identificador: { p: 0.95, compartidos: [{ ref: "ID-abc123", tipo: "cuenta_yape", ultimos_3: "488", evidencia: [] }] } }),
      status,
      nowIso(),
      nowIso(),
    )
    .run();
  return { id, num };
}

export async function markIndexed(caseId: string) {
  await env.DB.prepare("UPDATE cases SET indexed = 1, consent_mode = 'comunitario' WHERE id = ?").bind(caseId).run();
}
