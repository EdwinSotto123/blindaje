import { JwtClaims } from "@blindaje/shared";
import { ApiError } from "./errors";
import { b64UrlToBytes, bytesToB64Url, fromUtf8, utf8 } from "./encoding";

/** JWT HS256 de acceso (15 minutos). Implementación mínima con WebCrypto. */

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    if (!secret || secret.length < 32) throw new Error("JWT_SECRET ausente o demasiado corto");
    k = crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, k);
  }
  return k;
}

const HEADER = bytesToB64Url(utf8(JSON.stringify({ alg: "HS256", typ: "JWT" })));

export async function signAccessToken(
  secret: string,
  claims: Omit<JwtClaims, "iat" | "exp">,
  nowSec = Math.floor(Date.now() / 1000),
  ttlSec = ACCESS_TOKEN_TTL_SEC,
): Promise<string> {
  const full: JwtClaims = { ...claims, iat: nowSec, exp: nowSec + ttlSec };
  const payload = bytesToB64Url(utf8(JSON.stringify(full)));
  const signingInput = `${HEADER}.${payload}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(signingInput));
  return `${signingInput}.${bytesToB64Url(new Uint8Array(sig))}`;
}

export async function verifyAccessToken(
  secret: string,
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<JwtClaims> {
  const invalid = () => new ApiError("unauthorized", "Token inválido o vencido");
  const parts = token.split(".");
  if (parts.length !== 3) throw invalid();
  const [h, p, s] = parts as [string, string, string];
  let header: unknown;
  let payload: unknown;
  let sig: Uint8Array<ArrayBuffer>;
  try {
    header = JSON.parse(fromUtf8(b64UrlToBytes(h)));
    payload = JSON.parse(fromUtf8(b64UrlToBytes(p)));
    sig = b64UrlToBytes(s);
  } catch {
    throw invalid();
  }
  if (!header || typeof header !== "object" || (header as { alg?: unknown }).alg !== "HS256") throw invalid();
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, utf8(`${h}.${p}`));
  if (!ok) throw invalid();
  const parsed = JwtClaims.safeParse(payload);
  if (!parsed.success) throw invalid();
  if (parsed.data.exp <= nowSec) throw invalid();
  if (parsed.data.iat > nowSec + 60) throw invalid();
  return parsed.data;
}
