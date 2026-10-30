import { Hono } from "hono";
import { z } from "zod";
import {
  AlertDecisionRequest,
  AsesorRunRequest,
  CENTRAL_ORG_ID,
  ConsoleMonitor,
  ConsoleRole,
  ConsoleZones,
  CreateBusinessAccountRequest,
  RecommendationDecisionRequest,
  RecommendationStatus,
  HypothesisDecisionRequest,
  LinkDecisionRequest,
  LeakTraceResult,
  LinkStatus,
  VectorOverview,
  VectorSyncResult,
  VectorTrace,
  type AlertaBorrador,
} from "@blindaje/shared";
import { audit, listAudit, verifyAuditChain } from "../audit";
import { runCartografo, runRedactor, runVigia } from "../agents";
import { asesorTargets, runAsesorFor } from "../agents/asesor";
import { businessMeView, getBusinessById } from "../business/accounts";
import { RECOMMENDATION_SELECT, recommendationConsoleView, type RecommendationRow } from "../business/recommendations";
import { hasLongDigits, isUnsafeAdvice } from "../business/safety";
import { consoleUserView, getUserById, type UserRow } from "../auth/tokens";
import {
  ALERT_SELECT,
  alertView,
  buildCaseSide,
  buildLinkView,
  buildNetworkView,
  caseTranscripts,
  expedienteView,
  getConsoleCase,
  getLinkRow,
  hypothesisView,
  listNetworkSummaries,
  listProfiles,
  type AlertRow,
  type ExpedienteRow,
  type HypothesisRow,
  type LinkRow,
} from "../console/views";
import { budgetGuard, costsSummary } from "../costs";
import { MAX_EVIDENCE_BYTES, readDerivativePlain, readEvidencePlain, type EvidenceRow } from "../evidence";
import { detectLeakKind, markCopy, traceLeak } from "../leaks";
import { readBodyLimited } from "../lib/body";
import { getDecrypted, sha256Hex } from "../lib/crypto";
import { ApiError, notFound } from "../lib/errors";
import { parseQuery, readJson } from "../lib/http";
import { addSeconds, inviteCode, newId, nowIso } from "../lib/ids";
import { hashPassword } from "../lib/password";
import { trimWav } from "../lib/wav";
import { getAuth, requireAuth, requireRole } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { recomputeNetworks } from "../networks";
import { vectorOverview, vectorSync, vectorTrace } from "../vectors/console";
import { consoleMonitor } from "../console/monitor";
import { consoleZones } from "../zones";
import { actorOf, type AppContext, type AppEnv } from "../types";

export const consoleRoutes = new Hono<AppEnv>();

consoleRoutes.use("*", requireAuth, requireRole("reviewer", "analyst", "admin"), rateLimit("console"));

// La administración ve y hace todo lo de la consola (decisión del 29/10: es el panel de monitoreo de
// quien dirige Blindaje). Revisión y análisis conservan solo lo suyo.
/** El equipo central completo: revisa vínculos y aprueba alertas y consejos de cualquier zona. */
const centralTeam = requireRole("reviewer", "analyst", "admin");
const analystOrAdmin = requireRole("analyst", "admin");
const adminOnly = requireRole("admin");

/**
 * Mundo de los datos de la consola: las cuentas del demo (users.is_demo) trabajan sobre los casos
 * del demo y las demás sobre los reales. Con DEMO_MODE=true, `?demo=1|0` lo cambia.
 */
async function consoleIsDemo(c: AppContext, override?: string): Promise<boolean> {
  if (c.env.DEMO_MODE === "true" && override !== undefined) return override === "1" || override === "true";
  const auth = getAuth(c);
  const u = await c.env.DB.prepare("SELECT is_demo FROM users WHERE id = ?").bind(auth.sub).first<{ is_demo: number }>();
  return u?.is_demo === 1;
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

consoleRoutes.get("/me", async (c) => {
  const auth = getAuth(c);
  const user = await getUserById(c.env, auth.sub);
  if (!user || user.disabled) throw new ApiError("unauthorized", "Sesión vencida. Vuelve a ingresar.");
  return c.json(consoleUserView(user));
});

// ---------------------------------------------------------------------------
// Vínculos
// ---------------------------------------------------------------------------

const LinksQuery = z.object({
  status: z.union([LinkStatus, z.literal("todos")]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

consoleRoutes.get("/links", centralTeam, async (c) => {
  const q = parseQuery(c, LinksQuery);
  const statuses = !q.status
    ? ["probable", "por_revisar"]
    : q.status === "todos"
      ? ["probable", "por_revisar", "confirmado", "descartado"]
      : [q.status];
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, u.display_name AS reviewer_name FROM links l LEFT JOIN users u ON u.id = l.reviewer_id
     WHERE l.status IN (${statuses.map(() => "?").join(",")})
     ORDER BY l.score DESC, l.created_at ASC LIMIT ?`,
  )
    .bind(...statuses, q.limit)
    .all<LinkRow>();
  const links = await Promise.all(results.map((r) => buildLinkView(c.env, r)));
  return c.json({ links });
});

consoleRoutes.get("/links/:id", centralTeam, async (c) => {
  const auth = getAuth(c);
  const row = await getLinkRow(c.env, c.req.param("id"));
  const view = await buildLinkView(c.env, row);
  await audit(c.env, { ...actorOf(auth), action: "link.view", target_type: "link", target_id: row.id, details: { label: view.label } });
  return c.json(view);
});

consoleRoutes.post("/links/:id/decision", centralTeam, async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, LinkDecisionRequest);
  const row = await getLinkRow(c.env, c.req.param("id"));
  const status = body.decision === "confirmar" ? "confirmado" : "descartado";
  if (status === "confirmado") {
    const ok = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM cases WHERE id IN (?, ?) AND indexed = 1 AND consent_mode = 'comunitario'")
      .bind(row.case_a, row.case_b)
      .first<{ n: number }>();
    if ((ok?.n ?? 0) < 2) throw new ApiError("conflict", "Uno de los casos ya no tiene consentimiento comunitario");
  }
  const now = nowIso();
  await c.env.DB.prepare("UPDATE links SET status = ?, reviewer_id = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?")
    .bind(status, auth.sub, now, body.note ?? null, now, row.id)
    .run();
  if (status === "confirmado" || row.status === "confirmado") await recomputeNetworks(c.env);
  await audit(c.env, {
    ...actorOf(auth),
    action: "link.decision",
    target_type: "link",
    target_id: row.id,
    details: { decision: body.decision, previous: row.status, score: row.score, num: row.num },
  });
  return c.json(await buildLinkView(c.env, await getLinkRow(c.env, row.id)));
});

// ---------------------------------------------------------------------------
// Evidencia y casos
// ---------------------------------------------------------------------------

const MediaQuery = z
  .object({
    start_ms: z.coerce.number().int().min(0).optional(),
    end_ms: z.coerce.number().int().min(0).optional(),
  })
  .refine((q) => (q.start_ms === undefined) === (q.end_ms === undefined), { message: "start_ms y end_ms van juntos" })
  .refine((q) => q.start_ms === undefined || q.end_ms! > q.start_ms, { message: "end_ms debe ser mayor que start_ms" });

consoleRoutes.get("/evidence/:id/media", centralTeam, async (c) => {
  const auth = getAuth(c);
  const q = parseQuery(c, MediaQuery);
  const ev = await c.env.DB.prepare("SELECT * FROM evidence WHERE id = ?").bind(c.req.param("id")).first<EvidenceRow>();
  if (!ev) throw notFound("Evidencia");
  await getConsoleCase(c.env, ev.case_id);

  let body: ArrayBuffer | null = null;
  let contentType = ev.mime;
  let variant = "original";
  const hasRange = q.start_ms !== undefined && q.end_ms !== undefined;

  if (ev.tipo === "audio" && hasRange) {
    const wavDer = await c.env.DB.prepare("SELECT id, r2_key FROM derivatives WHERE evidence_id = ? AND tipo = 'wav' LIMIT 1")
      .bind(ev.id)
      .first<{ id: string; r2_key: string | null }>();
    const wav = wavDer ? await readDerivativePlain(c.env, wavDer) : ev.mime.includes("wav") ? await readEvidencePlain(c.env, ev) : null;
    const trimmed = wav ? trimWav(wav, q.start_ms!, q.end_ms!) : null;
    if (trimmed) {
      body = trimmed;
      contentType = "audio/wav";
      variant = wavDer ? "wav_recortado" : "original_recortado";
    }
  }
  if (!body && ev.tipo === "imagen") {
    const red = await c.env.DB.prepare("SELECT id, r2_key FROM derivatives WHERE evidence_id = ? AND tipo = 'redactada' LIMIT 1")
      .bind(ev.id)
      .first<{ id: string; r2_key: string | null }>();
    if (red) {
      body = await readDerivativePlain(c.env, red);
      if (body) {
        contentType = "image/jpeg";
        variant = "redactada";
      }
    }
  }
  if (!body) body = await readEvidencePlain(c.env, ev);
  if (!body) throw notFound("Evidencia");

  // Rastreo de filtraciones: la copia lleva una marca invisible de quien la pide (falla abierta).
  const rango = variant.endsWith("_recortado") ? `${q.start_ms}-${q.end_ms}` : "completo";
  const marked = await markCopy(c.env, { ev, userId: auth.sub, variant: `${variant}:${rango}`, body, contentType });
  const m = marked.outcome;

  await audit(c.env, {
    ...actorOf(auth),
    action: "evidence.media",
    target_type: "evidence",
    target_id: ev.id,
    details: {
      case_id: ev.case_id,
      label: ev.label,
      variant,
      start_ms: q.start_ms ?? null,
      end_ms: q.end_ms ?? null,
      marca: m.marca,
      marca_motivo: m.motivo,
      marca_tipo: m.kind,
      marca_entrega: m.issue_id,
      marca_cache: m.cache,
      marca_modelo: m.model,
      marca_error: m.error,
      marca_ms: m.ms,
    },
  });
  const headers: Record<string, string> = {
    "content-type": marked.contentType,
    "content-disposition": `inline; filename="${ev.label}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-blindaje-variant": variant,
    "x-blindaje-marca": m.marca,
  };
  if (m.motivo) headers["x-blindaje-marca-motivo"] = m.motivo;
  return new Response(marked.body, { headers });
});

/**
 * Rastreo de una copia filtrada (solo admin). Por qué no la analista: es quien más evidencia
 * escucha, así que sería su propia sospechosa, y el rastreo le serviría de oráculo para probar si
 * una edición borra su marca. Desde el 29/10 la administración también recibe copias (marcadas a su
 * nombre como las de cualquiera): sus rastreos y sus copias quedan en la auditoría encadenada.
 */
consoleRoutes.post("/leaks/trace", adminOnly, rateLimit("upload"), async (c) => {
  const auth = getAuth(c);
  const bytes = await readBodyLimited(c, MAX_EVIDENCE_BYTES);
  if (!bytes.byteLength) throw new ApiError("bad_request", "Falta el archivo");
  const kind = detectLeakKind(c.req.query("kind"), c.req.header("content-type"), bytes);
  const sha256 = await sha256Hex(bytes);
  const { result, audit: details } = await traceLeak(c.env, bytes, kind);
  // El archivo nunca se guarda: solo su huella y el resultado.
  await audit(c.env, {
    ...actorOf(auth),
    action: "leak.trace",
    target_type: null,
    target_id: null,
    details: { ...details, sha256, size_bytes: bytes.byteLength },
  });
  return c.json(LeakTraceResult.parse(result));
});

consoleRoutes.get("/cases/:id", centralTeam, async (c) => {
  const auth = getAuth(c);
  const cs = await getConsoleCase(c.env, c.req.param("id"));
  const [side, transcripciones] = await Promise.all([buildCaseSide(c.env, cs.id, cs), caseTranscripts(c.env, cs.id)]);
  await audit(c.env, { ...actorOf(auth), action: "case.view", target_type: "case", target_id: cs.id, details: { code: cs.code } });
  return c.json({ ...side, transcripciones });
});

// ---------------------------------------------------------------------------
// Redes, perfiles e hipótesis
// ---------------------------------------------------------------------------

consoleRoutes.get("/networks", analystOrAdmin, async (c) => {
  return c.json({ networks: await listNetworkSummaries(c.env) });
});

consoleRoutes.get("/networks/:id", analystOrAdmin, async (c) => {
  const auth = getAuth(c);
  const view = await buildNetworkView(c.env, c.req.param("id"));
  await audit(c.env, { ...actorOf(auth), action: "network.view", target_type: "network", target_id: view.id, details: { label: view.label } });
  return c.json(view);
});

consoleRoutes.post("/networks/:id/cartografo", analystOrAdmin, rateLimit("agents"), async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, z.object({ model: z.enum(["muse-spark-1.3", "muse-wonder-1.0"]).default("muse-spark-1.3") }));
  const net = await c.env.DB.prepare("SELECT id FROM networks WHERE id = ?").bind(c.req.param("id")).first<{ id: string }>();
  if (!net) throw notFound("Red");
  if (body.model === "muse-wonder-1.0") {
    await budgetGuard(c.env, { essential: false, model: body.model, operation: "cartografo" });
  }
  await audit(c.env, { ...actorOf(auth), action: "agent.cartografo.run", target_type: "network", target_id: net.id, details: { model: body.model } });
  const profile = await runCartografo(c.env, net.id, { model: body.model, actor: actorOf(auth) });
  return c.json(profile);
});

consoleRoutes.get("/networks/:id/profiles", analystOrAdmin, async (c) => {
  const net = await c.env.DB.prepare("SELECT id FROM networks WHERE id = ?").bind(c.req.param("id")).first<{ id: string }>();
  if (!net) throw notFound("Red");
  return c.json({ profiles: await listProfiles(c.env, net.id) });
});

consoleRoutes.post("/hypotheses/:id/decision", analystOrAdmin, async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, HypothesisDecisionRequest);
  const h = await c.env.DB.prepare(
    "SELECT h.*, p.status AS profile_status FROM hypotheses h LEFT JOIN network_profiles p ON p.id = h.profile_id WHERE h.id = ?",
  )
    .bind(c.req.param("id"))
    .first<HypothesisRow & { profile_status: string | null }>();
  if (!h) throw notFound("Hipótesis");
  if (body.decision === "aprobar" && h.profile_status === "invalido") {
    throw new ApiError("conflict", "No se puede aprobar una hipótesis de un perfil que no pasó el validador de citas");
  }
  const status = body.decision === "aprobar" ? "aprobada" : "descartada";
  await c.env.DB.prepare("UPDATE hypotheses SET status = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?")
    .bind(status, auth.sub, nowIso(), h.id)
    .run();
  await audit(c.env, {
    ...actorOf(auth),
    action: "hypothesis.decision",
    target_type: "hypothesis",
    target_id: h.id,
    details: { decision: body.decision, previous: h.status, network_id: h.network_id },
  });
  const updated = await c.env.DB.prepare(
    "SELECT h.*, u.display_name AS reviewer_name FROM hypotheses h LEFT JOIN users u ON u.id = h.reviewer_id WHERE h.id = ?",
  )
    .bind(h.id)
    .first<HypothesisRow>();
  return c.json(hypothesisView(updated!));
});

const ProfileDecisionRequest = z.object({ decision: z.enum(["aprobar", "rechazar"]) });

/** Aprobación del perfil de red por la persona analista (las hipótesis se deciden una por una). */
consoleRoutes.post("/profiles/:id/decision", analystOrAdmin, async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, ProfileDecisionRequest);
  const p = await c.env.DB.prepare("SELECT id, network_id, status FROM network_profiles WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: string; network_id: string; status: string }>();
  if (!p) throw notFound("Perfil");
  if (p.status === "invalido") throw new ApiError("conflict", "El perfil no pasó el validador de citas: vuelve a correr el Cartógrafo");
  const status = body.decision === "aprobar" ? "aprobado" : "rechazado";
  await c.env.DB.prepare("UPDATE network_profiles SET status = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?")
    .bind(status, auth.sub, nowIso(), p.id)
    .run();
  await audit(c.env, {
    ...actorOf(auth),
    action: "profile.decision",
    target_type: "network_profile",
    target_id: p.id,
    details: { decision: body.decision, previous: p.status, network_id: p.network_id },
  });
  const view = (await listProfiles(c.env, p.network_id)).find((x) => x.id === p.id);
  if (!view) throw notFound("Perfil");
  return c.json(view);
});

// ---------------------------------------------------------------------------
// Alertas (Vigía)
// ---------------------------------------------------------------------------

const VigiaRunBody = z.object({
  lookback_days: z.coerce.number().int().min(1).max(365).optional(),
  image: z.boolean().optional(),
});

consoleRoutes.post("/vigia/run", analystOrAdmin, rateLimit("agents"), async (c) => {
  const auth = getAuth(c);
  // Cuerpo opcional: la consola llama sin cuerpo.
  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiError("bad_request", "El cuerpo debe ser JSON");
    }
  }
  const body = VigiaRunBody.parse(raw);
  await audit(c.env, { ...actorOf(auth), action: "agent.vigia.run", target_type: null, target_id: null, details: { trigger: "manual", ...body } });
  const alerts = await runVigia(c.env, { trigger: "manual", actor: actorOf(auth), lookbackDays: body.lookback_days, image: body.image });
  return c.json({ alerts });
});

const AlertsQuery = z.object({ status: z.enum(["borrador", "aprobada", "rechazada"]).optional() });

/** Alertas de todas las zonas: el equipo central las revisa sin filtro por organización. */
consoleRoutes.get("/alerts", async (c) => {
  const q = parseQuery(c, AlertsQuery);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status) {
    where.push("a.status = ?");
    binds.push(q.status);
  }
  const { results } = await c.env.DB.prepare(
    `${ALERT_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY a.created_at DESC LIMIT 100`,
  )
    .bind(...binds)
    .all<AlertRow>();
  return c.json({ alerts: results.map(alertView) });
});

async function getAlert(c: AppContext, id: string): Promise<AlertRow> {
  const a = await c.env.DB.prepare(`${ALERT_SELECT} WHERE a.id = ?`).bind(id).first<AlertRow>();
  if (!a) throw notFound("Alerta");
  return a;
}

/** Una alerta nunca lleva números o cuentas completos (sección 10.4). */
function assertNoFullNumbers(text: string): void {
  if (/\d[\d\s-]{6,}\d/.test(text)) {
    throw new ApiError("bad_request", "La alerta no puede incluir números de teléfono o cuentas completos");
  }
}

consoleRoutes.post("/alerts/:id/decision", centralTeam, async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, AlertDecisionRequest);
  const a = await getAlert(c, c.req.param("id"));
  const draft = JSON.parse(a.draft_json) as AlertaBorrador;
  const edited: AlertaBorrador = { ...draft, ...(body.titulo ? { titulo: body.titulo } : {}), ...(body.cuerpo ? { cuerpo: body.cuerpo } : {}) };
  const now = nowIso();
  if (body.decision === "aprobar") {
    assertNoFullNumbers(`${edited.titulo} ${edited.cuerpo}`);
    await c.env.DB.prepare("UPDATE alerts SET status = 'aprobada', draft_json = ?, approved_by = ?, approved_at = ? WHERE id = ?")
      .bind(JSON.stringify(edited), auth.sub, now, a.id)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE alerts SET status = 'rechazada', draft_json = ? WHERE id = ?").bind(JSON.stringify(edited), a.id).run();
  }
  await audit(c.env, {
    ...actorOf(auth),
    action: "alert.decision",
    target_type: "alert",
    target_id: a.id,
    details: { decision: body.decision, edited: Boolean(body.titulo || body.cuerpo), org_id: a.org_id },
  });
  return c.json(alertView(await getAlert(c, a.id)));
});

consoleRoutes.get("/alerts/:id/image", centralTeam, async (c) => {
  const a = await getAlert(c, c.req.param("id"));
  if (!a.image_r2_key) throw notFound("Imagen");
  const obj = await c.env.EVIDENCE.get(a.image_r2_key);
  if (!obj) throw notFound("Imagen");
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/png", "cache-control": "no-store" } });
});

// ---------------------------------------------------------------------------
// Negocios: Asesor, recomendaciones y cuentas del portal
// ---------------------------------------------------------------------------

/**
 * Asesor por distrito y rubro (`zona`, `sector`); sin zona, los distritos que pasan el umbral. Las
 * recomendaciones quedan en borrador en la organización central. `org_id` se ignora.
 */
consoleRoutes.post("/asesor/run", analystOrAdmin, rateLimit("agents"), async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, AsesorRunRequest);
  const isDemo = await consoleIsDemo(c);
  const targets = await asesorTargets(c.env, body, { isDemo });
  await audit(c.env, {
    ...actorOf(auth),
    action: "agent.asesor.run",
    target_type: "organization",
    target_id: CENTRAL_ORG_ID,
    details: { demo: isDemo, targets: targets.map((t) => ({ zona: t.zona, sector: t.sector })) },
  });
  const recommendations = [];
  for (const t of targets) {
    recommendations.push(await runAsesorFor(c.env, t, { isDemo, actor: actorOf(auth) }));
  }
  return c.json({ recommendations });
});

const RecommendationsQuery = z.object({ status: RecommendationStatus.optional() });

consoleRoutes.get("/recommendations", async (c) => {
  const q = parseQuery(c, RecommendationsQuery);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status) {
    where.push("r.status = ?");
    binds.push(q.status);
  }
  const { results } = await c.env.DB.prepare(
    `${RECOMMENDATION_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY r.created_at DESC LIMIT 100`,
  )
    .bind(...binds)
    .all<RecommendationRow>();
  return c.json({ recommendations: results.map(recommendationConsoleView) });
});

async function getRecommendation(c: AppContext, id: string): Promise<RecommendationRow> {
  const r = await c.env.DB.prepare(`${RECOMMENDATION_SELECT} WHERE r.id = ?`).bind(id).first<RecommendationRow>();
  if (!r) throw notFound("Recomendación");
  return r;
}

consoleRoutes.post("/recommendations/:id/decision", centralTeam, async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, RecommendationDecisionRequest);
  const r = await getRecommendation(c, c.req.param("id"));
  const view = recommendationConsoleView(r);
  const now = nowIso();
  if (body.decision === "aprobar") {
    if (!view.citation_check.ok) {
      throw new ApiError("conflict", "La recomendación no pasó el validador de citas: vuelve a correr el Asesor");
    }
    // Última barrera antes de que llegue al portal público, a los negocios y a las víctimas.
    const c_ = view.contenido;
    const textos = [c_.resumen, ...c_.recomendaciones.flatMap((x) => [x.titulo, x.detalle]), ...c_.que_hacer_si_te_pasa, ...c_.advertencias];
    if (textos.some((t) => hasLongDigits(t) || /ID-/.test(t))) {
      throw new ApiError("bad_request", "La recomendación no puede incluir números de teléfono, cuentas ni identificadores");
    }
    if (textos.some((t) => isUnsafeAdvice(t))) {
      throw new ApiError("bad_request", "La recomendación no puede aconsejar pagar, negociar ni actuar contra personas");
    }
    await c.env.DB.prepare("UPDATE business_recommendations SET status = 'aprobada', approved_by = ?, approved_at = ? WHERE id = ?")
      .bind(auth.sub, now, r.id)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE business_recommendations SET status = 'rechazada', approved_by = NULL, approved_at = NULL WHERE id = ?").bind(r.id).run();
  }
  await audit(c.env, {
    ...actorOf(auth),
    action: "recommendation.decision",
    target_type: "business_recommendation",
    target_id: r.id,
    details: { decision: body.decision, previous: r.status, org_id: r.org_id, zona: r.zona, sector: r.sector },
  });
  return c.json(recommendationConsoleView(await getRecommendation(c, r.id)));
});

consoleRoutes.post("/business-accounts", requireRole("admin", "reviewer"), async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, CreateBusinessAccountRequest);
  const orgId = body.org_id ?? auth.org;
  const org = await c.env.DB.prepare("SELECT id, is_demo FROM organizations WHERE id = ?").bind(orgId).first<{ id: string; is_demo: number }>();
  if (!org) throw notFound("Organización");
  const id = newId();
  try {
    await c.env.DB.prepare(
      `INSERT INTO business_accounts (id, org_id, email, password_hash, business_name, sector, zona, disabled, is_demo, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
      .bind(
        id,
        org.id,
        body.email.trim().toLowerCase(),
        await hashPassword(body.password),
        body.business_name.trim(),
        body.sector.trim(),
        body.zona.trim(),
        org.is_demo,
        auth.sub,
        nowIso(),
      )
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new ApiError("conflict", "Ya existe una cuenta de negocio con ese correo");
    throw err;
  }
  await audit(c.env, { ...actorOf(auth), action: "business_account.create", target_type: "business_account", target_id: id, details: { org_id: org.id } });
  return c.json(businessMeView((await getBusinessById(c.env, id))!), 201);
});

// ---------------------------------------------------------------------------
// Zonas (rediseño del 28/10)
// ---------------------------------------------------------------------------

const ZonesQuery = z.object({
  dias: z.coerce.number().int().min(7).max(365).default(28),
  demo: z.enum(["0", "1", "true", "false"]).optional(),
});

/**
 * Vista de zonas: cifras exactas por distrito para el equipo, con el periodo anterior, víctimas
 * distintas, redes y modalidades. Bajo el umbral, solo las cifras (sin redes ni modalidades).
 */
consoleRoutes.get("/zones", centralTeam, async (c) => {
  const q = parseQuery(c, ZonesQuery);
  const isDemo = await consoleIsDemo(c, q.demo);
  return c.json(ConsoleZones.parse(await consoleZones(c.env, { dias: q.dias, isDemo })));
});

// ---------------------------------------------------------------------------
// Expedientes (Redactor)
// ---------------------------------------------------------------------------

consoleRoutes.post("/networks/:id/expediente", analystOrAdmin, rateLimit("agents"), async (c) => {
  const auth = getAuth(c);
  const net = await c.env.DB.prepare("SELECT id FROM networks WHERE id = ?").bind(c.req.param("id")).first<{ id: string }>();
  if (!net) throw notFound("Red");
  await audit(c.env, { ...actorOf(auth), action: "agent.redactor.run", target_type: "network", target_id: net.id });
  const { expediente_id } = await runRedactor(c.env, net.id, { actor: actorOf(auth) });
  const e = await c.env.DB.prepare("SELECT * FROM expedientes WHERE id = ?").bind(expediente_id).first<ExpedienteRow>();
  if (!e) throw notFound("Expediente");
  return c.json(expedienteView(e));
});

consoleRoutes.get("/networks/:id/expedientes", analystOrAdmin, async (c) => {
  const net = await c.env.DB.prepare("SELECT id FROM networks WHERE id = ?").bind(c.req.param("id")).first<{ id: string }>();
  if (!net) throw notFound("Red");
  const { results } = await c.env.DB.prepare("SELECT * FROM expedientes WHERE network_id = ? ORDER BY created_at DESC LIMIT 50")
    .bind(net.id)
    .all<ExpedienteRow>();
  return c.json({ expedientes: results.map(expedienteView) });
});

consoleRoutes.get("/expedientes/:id", analystOrAdmin, async (c) => {
  const e = await c.env.DB.prepare("SELECT * FROM expedientes WHERE id = ?").bind(c.req.param("id")).first<ExpedienteRow>();
  if (!e) throw notFound("Expediente");
  return c.json(expedienteView(e));
});

consoleRoutes.get("/expedientes/:id/pdf", analystOrAdmin, async (c) => {
  const auth = getAuth(c);
  const e = await c.env.DB.prepare("SELECT * FROM expedientes WHERE id = ?").bind(c.req.param("id")).first<ExpedienteRow>();
  if (!e || e.status !== "listo" || !e.r2_key) throw notFound("Expediente");
  const pdf = await getDecrypted(c.env.EVIDENCE, e.r2_key, c.env.EVIDENCE_ENCRYPTION_KEY, e.id);
  if (!pdf) throw notFound("Expediente");
  await audit(c.env, {
    ...actorOf(auth),
    action: "expediente.download",
    target_type: "expediente",
    target_id: e.id,
    details: { network_id: e.network_id, sha256: e.sha256 ?? (await sha256Hex(pdf)) },
  });
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="expediente-${e.id.slice(0, 8)}.pdf"`,
      "cache-control": "no-store",
    },
  });
});

// ---------------------------------------------------------------------------
// Motor vectorial (solo administración)
// ---------------------------------------------------------------------------

/** Estado de la base vectorial, colecciones, casos indexados y el mapa de cada índice. */
// ---------------------------------------------------------------------------
// Monitoreo (solo administración): servicios medidos en vivo, colas del equipo y presupuesto
// ---------------------------------------------------------------------------

consoleRoutes.get("/monitoreo", adminOnly, async (c) => {
  const started = Date.now();
  const cf = (c.req.raw as Request & { cf?: { colo?: string } }).cf;
  const data = await consoleMonitor(c.env, {
    demo: await consoleIsDemo(c, c.req.query("demo")),
    colo: cf?.colo ?? null,
    // Cloudflare puede agregar cf-placement ("remote-ATL"); si no, la región fijada en wrangler.jsonc.
    placement: c.req.header("cf-placement") ?? c.env.WORKER_REGION ?? null,
    started,
    waitUntil: (p) => {
      try {
        c.executionCtx.waitUntil(p);
      } catch {
        void p;
      }
    },
  });
  return c.json(ConsoleMonitor.parse(data));
});

consoleRoutes.get("/vectores", adminOnly, async (c) => {
  return c.json(VectorOverview.parse(await vectorOverview(c.env)));
});

const VectorTraceRequest = z.object({ case_id: z.string().min(1).max(64) });

/** Corre en vivo la búsqueda de candidatos de un caso (sin crear vínculos) y la devuelve paso a paso. */
consoleRoutes.post("/vectores/consulta", adminOnly, rateLimit("vectores"), async (c) => {
  const auth = getAuth(c);
  const { case_id } = await readJson(c, VectorTraceRequest);
  const trace = await vectorTrace(c.env, case_id);
  await audit(c.env, {
    ...actorOf(auth),
    action: "vectors.query",
    target_type: "case",
    target_id: case_id,
    details: { code: trace.caso, provider: trace.proveedor, queries: trace.consultas.length, candidates: trace.candidatos.length },
  });
  return c.json(VectorTrace.parse(trace));
});

/** Sincronización completa D1 → base vectorial (Chroma, o FAISS si no hay Chroma). */
consoleRoutes.post("/vectores/sincronizar", adminOnly, rateLimit("vectores"), async (c) => {
  const auth = getAuth(c);
  const result = await vectorSync(c.env);
  await audit(c.env, {
    ...actorOf(auth),
    action: "vectors.sync",
    target_type: null,
    target_id: null,
    details: { provider: result.proveedor, written: result.sincronizados, deleted: result.borrados },
  });
  return c.json(VectorSyncResult.parse(result));
});

// ---------------------------------------------------------------------------
// Auditoría y costos
// ---------------------------------------------------------------------------

const AuditQuery = z.object({
  before_seq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

consoleRoutes.get("/audit", analystOrAdmin, async (c) => {
  const q = parseQuery(c, AuditQuery);
  return c.json({ entries: await listAudit(c.env, q) });
});

consoleRoutes.get("/audit/verify", analystOrAdmin, async (c) => {
  return c.json(await verifyAuditChain(c.env));
});

consoleRoutes.get("/costs", analystOrAdmin, async (c) => {
  return c.json(await costsSummary(c.env));
});

// ---------------------------------------------------------------------------
// Administración: organizaciones, invitaciones y usuarios
// ---------------------------------------------------------------------------

consoleRoutes.get("/orgs", adminOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.kind, o.district, o.is_demo, o.created_at,
       (SELECT COUNT(*) FROM devices d WHERE d.org_id = o.id) AS devices,
       (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS users
     FROM organizations o ORDER BY o.created_at ASC`,
  ).all<{ id: string; name: string; kind: string; district: string | null; is_demo: number; created_at: string; devices: number; users: number }>();
  return c.json({ orgs: results.map((o) => ({ ...o, is_demo: o.is_demo === 1 })) });
});

const CreateOrg = z.object({
  name: z.string().min(2).max(160),
  kind: z.enum(["gremio", "asociacion_mercado", "junta_vecinal", "alianza"]).default("gremio"),
  district: z.string().max(80).optional(),
});

consoleRoutes.post("/orgs", adminOnly, async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, CreateOrg);
  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare("INSERT INTO organizations (id, name, kind, district, is_demo, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .bind(id, body.name, body.kind, body.district ?? null, now)
    .run();
  await audit(c.env, { ...actorOf(auth), action: "org.create", target_type: "organization", target_id: id, details: { kind: body.kind } });
  return c.json({ id, name: body.name, kind: body.kind, district: body.district ?? null, is_demo: false, created_at: now }, 201);
});

const CreateInvites = z.object({
  org_id: z.string().optional(),
  count: z.coerce.number().int().min(1).max(50),
  max_uses: z.coerce.number().int().min(1).max(100).default(1),
  expires_days: z.coerce.number().int().min(1).max(365).default(30),
});

consoleRoutes.post("/invites", requireRole("admin", "reviewer"), async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, CreateInvites);
  // Las invitaciones son de un canal de difusión (cualquier organización); por defecto, la de quien las pide.
  const orgId = body.org_id ?? auth.org;
  const org = await c.env.DB.prepare("SELECT id FROM organizations WHERE id = ?").bind(orgId).first();
  if (!org) throw notFound("Organización");
  const now = nowIso();
  const expires = addSeconds(now, body.expires_days * 86400);
  const codes: string[] = [];
  while (codes.length < body.count) {
    const code = inviteCode();
    const res = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO invites (code, org_id, created_by, created_at, expires_at, max_uses, uses) VALUES (?, ?, ?, ?, ?, ?, 0)",
    )
      .bind(code, orgId, auth.sub, now, expires, body.max_uses)
      .run();
    if (res.meta.changes) codes.push(code);
  }
  await audit(c.env, {
    ...actorOf(auth),
    action: "invites.create",
    target_type: "organization",
    target_id: orgId,
    details: { count: codes.length, max_uses: body.max_uses, expires_at: expires },
  });
  return c.json({ codes }, 201);
});

consoleRoutes.get("/users", adminOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT u.*, o.name AS org_name FROM users u JOIN organizations o ON o.id = u.org_id ORDER BY u.created_at ASC",
  ).all<UserRow>();
  return c.json({ users: results.map((u) => ({ ...consoleUserView(u), disabled: u.disabled === 1 })) });
});

const CreateUser = z.object({
  email: z.string().email().max(160),
  display_name: z.string().min(2).max(120),
  role: ConsoleRole,
  /** Por defecto, la organización central: el equipo de Blindaje. */
  org_id: z.string().default(CENTRAL_ORG_ID),
  password: z.string().min(12).max(200),
});

consoleRoutes.post("/users", adminOnly, async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, CreateUser);
  const org = await c.env.DB.prepare("SELECT id FROM organizations WHERE id = ?").bind(body.org_id).first();
  if (!org) throw notFound("Organización");
  const id = newId();
  try {
    await c.env.DB.prepare(
      "INSERT INTO users (id, org_id, email, display_name, password_hash, role, disabled, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)",
    )
      .bind(id, body.org_id, body.email.trim().toLowerCase(), body.display_name, await hashPassword(body.password), body.role, nowIso())
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new ApiError("conflict", "Ya existe un usuario con ese correo");
    throw err;
  }
  await audit(c.env, { ...actorOf(auth), action: "user.create", target_type: "user", target_id: id, details: { role: body.role, org_id: body.org_id } });
  const user = await getUserById(c.env, id);
  return c.json(consoleUserView(user!), 201);
});
