import { Hono } from "hono";
import { z } from "zod";
import {
  PilotRequest,
  PublicAlerts,
  PublicRecommendations,
  PublicRiskOverview,
  PublicZoneMap,
  Sector,
  districtById,
  districtOfZone,
  type VictimAlert,
} from "@blindaje/shared";
import { approvedRecommendations } from "../business/recommendations";
import { SESGO_TEXTO, analyzeRisk, approvedAlerts, toPublicRiskOverview, type ZoneAlert } from "../business/risk";
import { sanitizeDeep } from "../business/safety";
import { ApiError } from "../lib/errors";
import { hmacHex } from "../lib/crypto";
import { clientIp, findForbiddenKeys, parseQuery, readJson } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { rateLimit } from "../middleware/rate-limit";
import { publicZoneMap } from "../zones";
import type { AppContext, AppEnv } from "../types";

export const API_VERSION = "0.1.0";

export const publicRoutes = new Hono<AppEnv>();

const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Verifica un token de Turnstile. En local se usa la clave secreta de prueba que siempre aprueba. */
export async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  let res: Response;
  try {
    res = await fetch(TURNSTILE_URL, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    log("error", "turnstile_unreachable", errorFields(err));
    throw new ApiError("upstream_error", "No se pudo verificar el formulario. Intenta de nuevo.");
  }
  if (!res.ok) throw new ApiError("upstream_error", "No se pudo verificar el formulario. Intenta de nuevo.");
  const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
  if (!data.success) log("warn", "turnstile_rejected", { codes: data["error-codes"] ?? [] });
  return data.success === true;
}

publicRoutes.post("/pilot-requests", rateLimit("pilot"), async (c) => {
  const body = await readJson(c, PilotRequest);
  const ip = clientIp(c);
  const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET, body.turnstile_token, ip);
  if (!ok) throw new ApiError("forbidden", "No pudimos verificar que seas una persona. Recarga la página e intenta de nuevo.");
  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO pilot_requests (id, org_name, contact_name, contact, sector, district, members, message, lang, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.org_name,
      body.contact_name,
      body.contact,
      body.sector ?? null,
      body.district ?? null,
      body.members ?? null,
      body.message ?? null,
      body.lang,
      (await hmacHex(c.env.JWT_SECRET, `pilot-ip:${ip}`)).slice(0, 32),
      nowIso(),
    )
    .run();
  log("info", "pilot_request_created", { lang: body.lang });
  return c.json({ id }, 201);
});

// ---------------------------------------------------------------------------
// Portal público por distrito (rediseño del 28/10): sin cuenta, solo lectura
// ---------------------------------------------------------------------------

/**
 * Salida de todo lo público: textos saneados (sin números de 6 dígitos o más, sin ID-… ni citas
 * internas), esquema estricto del contrato (descarta lo que no esté en él) y las mismas claves
 * prohibidas que para una víctima. Caché corta: las cifras se mueven poco y son agregadas.
 */
function publicJson<S extends z.ZodType>(c: AppContext, schema: S, data: unknown) {
  const parsed = schema.parse(sanitizeDeep(data));
  const bad = findForbiddenKeys(parsed);
  if (bad.length) {
    log("error", "public_response_blocked", { route: c.req.routePath, paths: bad });
    throw new ApiError("internal", "Respuesta bloqueada por la política de privacidad");
  }
  c.header("cache-control", "public, max-age=60");
  return c.json(parsed as object);
}

/**
 * Mundo de los datos públicos: por defecto, solo casos reales. `?demo=1` sirve los datos ficticios
 * del demo, y solo se respeta donde DEMO_MODE=true (en producción se ignora). La respuesta dice
 * cuál sirvió en `demo`.
 */
const DemoFlag = z.enum(["0", "1", "true", "false"]).optional();

function publicIsDemo(c: AppContext, flag: string | undefined): boolean {
  return c.env.DEMO_MODE === "true" && (flag === "1" || flag === "true");
}

/** Distrito de Lima Metropolitana o del Callao (id o nombre); devuelve el id. */
const DistrictParam = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .transform((v, ctx) => {
    const d = districtOfZone(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "No es un distrito de Lima Metropolitana o del Callao" });
      return z.NEVER;
    }
    return d.id;
  });

function alertForPublic(a: ZoneAlert): VictimAlert {
  return { id: a.id, titulo: a.titulo, cuerpo: a.cuerpo, zona: a.zona, distrito: a.distrito, que_hacer: a.que_hacer, approved_at: a.approved_at };
}

publicRoutes.get("/zones", rateLimit("public"), async (c) => {
  const q = parseQuery(c, z.object({ demo: DemoFlag }));
  const isDemo = publicIsDemo(c, q.demo);
  return publicJson(c, PublicZoneMap, await publicZoneMap(c.env, { isDemo }));
});

publicRoutes.get("/risk", rateLimit("public"), async (c) => {
  const q = parseQuery(c, z.object({ zona: DistrictParam, sector: Sector.optional(), demo: DemoFlag }));
  const isDemo = publicIsDemo(c, q.demo);
  const district = districtById(q.zona)!;
  const analysis = await analyzeRisk(c.env, { zona: district.id, sector: q.sector ?? null, isDemo });
  return publicJson(c, PublicRiskOverview, toPublicRiskOverview(analysis, { zona: district.id, demo: isDemo }));
});

/** Alertas aprobadas por el equipo central; con `zona`, solo las de ese distrito. */
publicRoutes.get("/alerts", rateLimit("public"), async (c) => {
  const q = parseQuery(c, z.object({ zona: DistrictParam.optional(), demo: DemoFlag }));
  const isDemo = publicIsDemo(c, q.demo);
  const alerts = (await approvedAlerts(c.env, { isDemo }))
    .filter((a) => (q.zona ? a.distrito === q.zona : a.distrito !== null))
    .slice(0, 50)
    .map(alertForPublic);
  return publicJson(c, PublicAlerts, { alerts, nota_sesgo: SESGO_TEXTO, demo: isDemo });
});

/** Consejos del Asesor aprobados por el equipo central; con `zona` y `sector`, los de ese distrito y rubro. */
publicRoutes.get("/recommendations", rateLimit("public"), async (c) => {
  const q = parseQuery(c, z.object({ zona: DistrictParam.optional(), sector: Sector.optional(), demo: DemoFlag }));
  const isDemo = publicIsDemo(c, q.demo);
  const recommendations = (await approvedRecommendations(c.env, { isDemo, zonas: q.zona ? [q.zona] : null, sector: q.sector ?? null })).filter(
    (r) => r.distrito,
  );
  return publicJson(c, PublicRecommendations, { recommendations, nota_sesgo: SESGO_TEXTO, demo: isDemo });
});
