import { createHash, webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CACHE_DIR } from "./env";

/**
 * Cliente mínimo de la API de Blindaje (docs/API.md) que se comporta como la app: registra
 * dispositivos con código de invitación y llave P-256, renueva tokens firmando
 * `refresh:${device_id}:${timestamp}` (ECDSA P-256 / SHA-256, P1363, base64url) y sube evidencia
 * como cuerpo crudo con su SHA-256. Las sesiones de los dispositivos del demo se guardan en
 * eval/data/cache/demo-devices.json (en .gitignore) para que los scripts sean idempotentes sin
 * gastar registros (límite: 10 por hora por IP).
 */

const subtle = webcrypto.subtle;

export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(`${status} ${code}: ${message}`);
  }
}

export interface RequestOptions {
  method?: string;
  token?: string;
  json?: unknown;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
  /** Devuelve la respuesta cruda (para PDFs y medios). */
  raw?: boolean;
}

export class Api {
  constructor(readonly base: string) {}

  async request<T = unknown>(path: string, o: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    let body: BodyInit | undefined;
    if (o.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(o.json);
    } else if (o.body !== undefined) {
      body = typeof o.body === "string" ? o.body : new Uint8Array(o.body);
    }
    for (let intento = 0; ; intento++) {
      const res = await fetch(`${this.base}${path}`, { method: o.method ?? (body ? "POST" : "GET"), headers, body });
      if (res.status === 429 && intento < 3) {
        const wait = Math.min(Number(res.headers.get("retry-after") ?? "5"), 60);
        console.log(`  límite de la API, espero ${wait} s…`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (o.raw) {
        if (!res.ok) throw new ApiHttpError(res.status, "http_error", await res.text(), null);
        return res as unknown as T;
      }
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!res.ok) {
        const err = (data as { error?: { code?: string; message?: string } })?.error;
        throw new ApiHttpError(res.status, err?.code ?? "http_error", err?.message ?? String(text).slice(0, 200), data);
      }
      return data as T;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Dispositivos (víctimas)
// ---------------------------------------------------------------------------------------------

export interface DeviceSession {
  device_id: string;
  pseudonym: string;
  org: { id: string; name: string };
  access_token: string;
  refresh_token: string;
  public_jwk: JsonWebKey;
  private_jwk: JsonWebKey;
}

const DEVICES_FILE = resolve(CACHE_DIR, "demo-devices.json");

function loadDevices(): Record<string, DeviceSession> {
  return existsSync(DEVICES_FILE) ? (JSON.parse(readFileSync(DEVICES_FILE, "utf8")) as Record<string, DeviceSession>) : {};
}

function saveDevice(name: string, s: DeviceSession | null) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const all = loadDevices();
  if (s) all[name] = s;
  else delete all[name];
  writeFileSync(DEVICES_FILE, JSON.stringify(all, null, 2));
}

export function forgetDevices() {
  if (existsSync(DEVICES_FILE)) writeFileSync(DEVICES_FILE, "{}");
}

async function signRefresh(privateJwk: JsonWebKey, deviceId: string, ts: number): Promise<string> {
  const key = await subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`refresh:${deviceId}:${ts}`));
  return Buffer.from(sig).toString("base64url");
}

/** Registra un dispositivo nuevo con una llave P-256 recién generada. */
export async function registerDevice(api: Api, name: string, inviteCode: string): Promise<DeviceSession> {
  const kp = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = await subtle.exportKey("jwk", kp.publicKey);
  const priv = await subtle.exportKey("jwk", kp.privateKey);
  const r = await api.request<{
    access_token: string;
    refresh_token: string;
    device_id: string;
    pseudonym: string;
    org: { id: string; name: string };
  }>("/v1/auth/device/register", {
    json: { invite_code: inviteCode, public_key: { kty: "EC", crv: "P-256", x: pub.x, y: pub.y }, platform: "android" },
  });
  const s: DeviceSession = {
    device_id: r.device_id,
    pseudonym: r.pseudonym,
    org: r.org,
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    public_jwk: pub,
    private_jwk: priv,
  };
  saveDevice(name, s);
  return s;
}

/** Sesión del dispositivo `name`: renueva la guardada (firma del refresh) o registra uno nuevo. */
export async function deviceSession(api: Api, name: string, inviteCode: string): Promise<{ s: DeviceSession; nuevo: boolean }> {
  const prev = loadDevices()[name];
  if (prev) {
    try {
      const ts = Date.now();
      const r = await api.request<{ access_token: string; refresh_token: string }>("/v1/auth/device/refresh", {
        json: {
          device_id: prev.device_id,
          refresh_token: prev.refresh_token,
          timestamp: ts,
          signature: await signRefresh(prev.private_jwk, prev.device_id, ts),
        },
      });
      const s = { ...prev, access_token: r.access_token, refresh_token: r.refresh_token };
      saveDevice(name, s);
      return { s, nuevo: false };
    } catch (e) {
      if (!(e instanceof ApiHttpError) || e.status >= 500) throw e;
      saveDevice(name, null); // el reset borró el dispositivo o el token ya no sirve
    }
  }
  return { s: await registerDevice(api, name, inviteCode), nuevo: true };
}

// ---------------------------------------------------------------------------------------------
// Consola
// ---------------------------------------------------------------------------------------------

export const DEMO_CONSOLE = {
  reviewer: { email: "revisora@demo.blindaje.test", password: process.env.DEMO_REVIEWER_PASSWORD ?? "Revisora-Demo-2026" },
  analyst: { email: "analista@demo.blindaje.test", password: process.env.DEMO_ANALYST_PASSWORD ?? "Analista-Demo-2026" },
  admin: { email: "admin@demo.blindaje.test", password: process.env.DEMO_ADMIN_PASSWORD ?? "Admin-Demo-2026" },
} as const;

export async function consoleLogin(api: Api, role: keyof typeof DEMO_CONSOLE): Promise<string> {
  const r = await api.request<{ access_token: string }>("/v1/auth/console/login", { json: DEMO_CONSOLE[role] });
  return r.access_token;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function mimeFor(file: string): string {
  if (file.endsWith(".ogg") || file.endsWith(".opus")) return "audio/ogg";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}
