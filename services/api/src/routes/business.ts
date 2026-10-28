import { Hono } from "hono";
import { z } from "zod";
import { BusinessMe, BusinessRecommendationView, RiskOverview, VictimAlert, type AlertaBorrador } from "@blindaje/shared";
import { businessMeView, getBusinessById, type BusinessAccountRow } from "../business/accounts";
import { approvedRecommendations } from "../business/recommendations";
import { analyzeRisk, toRiskOverview } from "../business/risk";
import { sanitizeDeep } from "../business/safety";
import { parseJsonColumn } from "../lib/db";
import { ApiError } from "../lib/errors";
import { findForbiddenKeys, parseQuery } from "../lib/http";
import { log } from "../lib/log";
import { getAuth, requireAuth, requireRole } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import type { AppContext, AppEnv } from "../types";

/**
 * Portal de negocios (rol `business`). Solo información AGREGADA de la zona y el rubro: no hay
 * buscador de números, cuentas ni placas (un extorsionador infiltrado lo usaría para saber si su
 * número está marcado). Toda respuesta pasa por `businessJson`: esquema del contrato, textos sin
 * números de 6 dígitos o más ni "ID-…", y las mismas claves prohibidas que para una víctima.
 */
export const businessRoutes = new Hono<AppEnv>();

businessRoutes.use("*", requireAuth, requireRole("business"), rateLimit("business"));

function businessJson<S extends z.ZodType>(c: AppContext, schema: S, data: unknown) {
  const parsed = sanitizeDeep(schema.parse(data));
  const bad = findForbiddenKeys(parsed);
  if (bad.length) {
    log("error", "business_response_blocked", { route: c.req.routePath, paths: bad });
    throw new ApiError("internal", "Respuesta bloqueada por la política de privacidad");
  }
  c.header("cache-control", "no-store");
  return c.json(parsed as object);
}

async function currentAccount(c: AppContext): Promise<BusinessAccountRow> {
  const auth = getAuth(c);
  const b = await getBusinessById(c.env, auth.sub);
  if (!b || b.disabled) throw new ApiError("unauthorized", "Sesión vencida. Vuelve a ingresar.");
  return b;
}

businessRoutes.get("/me", async (c) => {
  return businessJson(c, BusinessMe, businessMeView(await currentAccount(c)));
});

const RiskQuery = z.object({
  zona: z.string().trim().min(2).max(80).optional(),
  sector: z.string().trim().min(2).max(80).optional(),
});

businessRoutes.get("/risk", async (c) => {
  const b = await currentAccount(c);
  const q = parseQuery(c, RiskQuery);
  const analysis = await analyzeRisk(c.env, {
    zona: q.zona ?? b.zona,
    // Con otra zona y sin rubro, el panorama es de todos los rubros de esa zona.
    sector: q.sector ?? (q.zona ? null : b.sector),
    orgId: b.org_id,
    isDemo: b.is_demo === 1,
  });
  return businessJson(c, RiskOverview, toRiskOverview(analysis));
});

businessRoutes.get("/recommendations", async (c) => {
  const b = await currentAccount(c);
  const recommendations = await approvedRecommendations(c.env, b.org_id, { zona: b.zona, sector: b.sector });
  return businessJson(c, z.object({ recommendations: z.array(BusinessRecommendationView) }), { recommendations });
});

businessRoutes.get("/alerts", async (c) => {
  const b = await currentAccount(c);
  const { results } = await c.env.DB.prepare(
    "SELECT id, draft_json, approved_at FROM alerts WHERE org_id = ? AND status = 'aprobada' ORDER BY approved_at DESC LIMIT 50",
  )
    .bind(b.org_id)
    .all<{ id: string; draft_json: string; approved_at: string | null }>();
  const alerts = results.flatMap((r) => {
    const d = parseJsonColumn<AlertaBorrador>(r.draft_json);
    if (!d) return [];
    return [{ id: r.id, titulo: d.titulo, cuerpo: d.cuerpo, zona: d.zona, que_hacer: d.que_hacer, approved_at: r.approved_at ?? "" }];
  });
  return businessJson(c, z.object({ alerts: z.array(VictimAlert) }), { alerts });
});
