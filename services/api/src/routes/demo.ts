import { Hono } from "hono";
import { audit } from "../audit";
import { deleteCaseFully, type CaseRow } from "../cases";
import { timingSafeEqualStr } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { nowIso } from "../lib/ids";
import { hashPassword } from "../lib/password";
import { recomputeNetworks } from "../networks";
import type { Actor, AppEnv } from "../types";

/**
 * Modo demo (solo con DEMO_MODE=true y header x-demo-secret = DEMO_SECRET).
 * Todo lo que crea está marcado is_demo y dice "ficticio" (también la cuenta del portal de negocios,
 * "Bodega Don Lucho (ficticia)"). Las contraseñas están en README.md.
 * Los casos A, B y C los crea el script de eval/ usando la API como la app, con los códigos de
 * invitación DEMO-CASO-* y el header `x-demo-case-code`.
 */
export const demoRoutes = new Hono<AppEnv>();

export const DEMO_ORG = {
  id: "org-demo-bodegueros-lima-este",
  name: "Asociación de Bodegueros de Lima Este (datos ficticios)",
  kind: "gremio",
  district: "Lima Este",
};

export const DEMO_USERS = [
  {
    id: "usr-demo-revisora",
    email: "revisora@demo.blindaje.test",
    display_name: "Revisora del gremio (ficticia)",
    role: "reviewer",
    password: "Revisora-Demo-2026",
  },
  {
    id: "usr-demo-analista",
    email: "analista@demo.blindaje.test",
    display_name: "Analista de la alianza (ficticio)",
    role: "analyst",
    password: "Analista-Demo-2026",
  },
  {
    id: "usr-demo-admin",
    email: "admin@demo.blindaje.test",
    display_name: "Administración (ficticia)",
    role: "admin",
    password: "Admin-Demo-2026",
  },
] as const;

/** Cuenta del portal de negocios (rol business). Contraseña documentada en README.md. */
export const DEMO_BUSINESS = {
  id: "biz-demo-bodega-don-lucho",
  email: "negocio@demo.blindaje.test",
  business_name: "Bodega Don Lucho (ficticia)",
  sector: "bodega",
  zona: "Lima Este",
  password: "Negocio-Demo-2026",
} as const;

export const DEMO_INVITES = [
  { code: "DEMO-CASO-A", max_uses: 5 },
  { code: "DEMO-CASO-B", max_uses: 5 },
  { code: "DEMO-CASO-C", max_uses: 5 },
  { code: "DEMO-LIMA-ESTE", max_uses: 100 },
] as const;

const DEMO_ACTOR: Actor = { actor_type: "system", actor_id: "demo" };

demoRoutes.use("*", async (c, next) => {
  if (c.env.DEMO_MODE !== "true") throw new ApiError("demo_disabled", "El modo demo no está habilitado en este entorno");
  const secret = c.req.header("x-demo-secret") ?? "";
  if (!c.env.DEMO_SECRET || !timingSafeEqualStr(secret, c.env.DEMO_SECRET)) {
    throw new ApiError("unauthorized", "Secreto de demo inválido");
  }
  await next();
});

demoRoutes.post("/seed", async (c) => {
  const env = c.env;
  const now = nowIso();
  await env.DB.prepare("INSERT OR IGNORE INTO organizations (id, name, kind, district, is_demo, created_at) VALUES (?, ?, ?, ?, 1, ?)")
    .bind(DEMO_ORG.id, DEMO_ORG.name, DEMO_ORG.kind, DEMO_ORG.district, now)
    .run();
  const createdUsers: string[] = [];
  for (const u of DEMO_USERS) {
    const exists = await env.DB.prepare("SELECT id FROM users WHERE id = ? OR email = ?").bind(u.id, u.email).first();
    if (exists) continue;
    await env.DB.prepare(
      "INSERT INTO users (id, org_id, email, display_name, password_hash, role, disabled, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)",
    )
      .bind(u.id, DEMO_ORG.id, u.email, u.display_name, await hashPassword(u.password), u.role, now)
      .run();
    createdUsers.push(u.id);
  }
  const bizExists = await env.DB.prepare("SELECT id FROM business_accounts WHERE id = ? OR email = ?").bind(DEMO_BUSINESS.id, DEMO_BUSINESS.email).first();
  if (!bizExists) {
    await env.DB.prepare(
      `INSERT INTO business_accounts (id, org_id, email, password_hash, business_name, sector, zona, disabled, is_demo, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 'demo', ?)`,
    )
      .bind(DEMO_BUSINESS.id, DEMO_ORG.id, DEMO_BUSINESS.email, await hashPassword(DEMO_BUSINESS.password), DEMO_BUSINESS.business_name, DEMO_BUSINESS.sector, DEMO_BUSINESS.zona, now)
      .run();
  }
  for (const inv of DEMO_INVITES) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO invites (code, org_id, created_by, created_at, expires_at, max_uses, uses) VALUES (?, ?, ?, ?, NULL, ?, 0)",
    )
      .bind(inv.code, DEMO_ORG.id, "demo", now, inv.max_uses)
      .run();
  }
  await audit(env, {
    ...DEMO_ACTOR,
    action: "demo.seed",
    target_type: "organization",
    target_id: DEMO_ORG.id,
    details: { users_created: createdUsers.length, business_created: bizExists ? 0 : 1 },
  });
  return c.json(
    {
      org: { id: DEMO_ORG.id, name: DEMO_ORG.name },
      users: DEMO_USERS.map((u) => ({ id: u.id, email: u.email, display_name: u.display_name, role: u.role })),
      invites: DEMO_INVITES.map((i) => i.code),
      business_accounts: [
        { id: DEMO_BUSINESS.id, email: DEMO_BUSINESS.email, business_name: DEMO_BUSINESS.business_name, sector: DEMO_BUSINESS.sector, zona: DEMO_BUSINESS.zona },
      ],
      passwords: "Ver services/api/README.md (sección Demo)",
      ficticio: true,
    },
    201,
  );
});

demoRoutes.post("/reset", async (c) => {
  const env = c.env;
  const demoOrgs = "SELECT id FROM organizations WHERE is_demo = 1";
  const { results: cases } = await env.DB.prepare(`SELECT * FROM cases WHERE is_demo = 1 OR org_id IN (${demoOrgs})`).all<CaseRow>();
  for (const cs of cases) await deleteCaseFully(env, cs, DEMO_ACTOR, { recompute: false });
  await recomputeNetworks(env);

  const { results: alertImages } = await env.DB.prepare(
    `SELECT image_r2_key FROM alerts WHERE image_r2_key IS NOT NULL AND org_id IN (${demoOrgs})`,
  ).all<{ image_r2_key: string }>();
  if (alertImages.length) await env.EVIDENCE.delete(alertImages.map((a) => a.image_r2_key));

  const demoUsers = "SELECT id FROM users WHERE is_demo = 1 OR org_id IN (SELECT id FROM organizations WHERE is_demo = 1)";
  const demoDevices = "SELECT id FROM devices WHERE is_demo = 1 OR org_id IN (SELECT id FROM organizations WHERE is_demo = 1)";
  const demoBusiness = "SELECT id FROM business_accounts WHERE is_demo = 1 OR org_id IN (SELECT id FROM organizations WHERE is_demo = 1)";
  const counts = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM (${demoDevices})`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM (${demoUsers})`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM (${demoBusiness})`),
  ]);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM alerts WHERE org_id IN (${demoOrgs})`),
    env.DB.prepare(`UPDATE links SET reviewer_id = NULL WHERE reviewer_id IN (${demoUsers})`),
    env.DB.prepare(`UPDATE network_profiles SET reviewer_id = NULL WHERE reviewer_id IN (${demoUsers})`),
    env.DB.prepare(`UPDATE hypotheses SET reviewer_id = NULL WHERE reviewer_id IN (${demoUsers})`),
    env.DB.prepare(`UPDATE alerts SET approved_by = NULL WHERE approved_by IN (${demoUsers})`),
    env.DB.prepare(`UPDATE expedientes SET created_by = NULL WHERE created_by IN (${demoUsers})`),
    // Negocios: recomendaciones del Asesor, sesiones y cuentas del portal.
    env.DB.prepare(`DELETE FROM business_recommendations WHERE is_demo = 1 OR org_id IN (${demoOrgs})`),
    env.DB.prepare(`UPDATE business_recommendations SET approved_by = NULL WHERE approved_by IN (${demoUsers})`),
    env.DB.prepare(`DELETE FROM business_refresh_tokens WHERE subject_id IN (${demoBusiness})`),
    env.DB.prepare(`DELETE FROM business_accounts WHERE id IN (${demoBusiness})`),
    env.DB.prepare(`DELETE FROM refresh_tokens WHERE subject_type = 'user' AND subject_id IN (${demoUsers})`),
    env.DB.prepare(`DELETE FROM refresh_tokens WHERE subject_type = 'device' AND subject_id IN (${demoDevices})`),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${demoUsers})`),
    env.DB.prepare(`DELETE FROM devices WHERE id IN (${demoDevices})`),
    env.DB.prepare(`DELETE FROM invites WHERE org_id IN (${demoOrgs})`),
    env.DB.prepare(`DELETE FROM organizations WHERE is_demo = 1`),
    env.DB.prepare("DELETE FROM agent_runs WHERE target_type = 'case' AND target_id NOT IN (SELECT id FROM cases)"),
    env.DB.prepare("DELETE FROM agent_runs WHERE target_type = 'network' AND target_id NOT IN (SELECT id FROM networks)"),
    env.DB.prepare("DELETE FROM agent_runs WHERE target_type = 'organization' AND target_id NOT IN (SELECT id FROM organizations)"),
    // Las etiquetas vuelven a empezar después de lo que quede (VIN-1, R-001… si no queda nada).
    env.DB.prepare("UPDATE counters SET value = COALESCE((SELECT MAX(num) FROM links), 0) WHERE name = 'link'"),
    env.DB.prepare("UPDATE counters SET value = COALESCE((SELECT MAX(num) FROM voice_prints), 0) WHERE name = 'voice'"),
    env.DB.prepare("UPDATE counters SET value = COALESCE((SELECT MAX(num) FROM image_crops), 0) WHERE name = 'image'"),
    env.DB.prepare("UPDATE counters SET value = COALESCE((SELECT MAX(num) FROM networks), 0) WHERE name = 'network'"),
    env.DB.prepare("UPDATE counters SET value = COALESCE((SELECT MAX(num) FROM hypotheses), 0) WHERE name = 'hypothesis'"),
  ]);
  const summary = {
    cases: cases.length,
    devices: (counts[0]!.results[0] as { n: number }).n,
    users: (counts[1]!.results[0] as { n: number }).n,
    business_accounts: (counts[2]!.results[0] as { n: number }).n,
  };
  await audit(env, { ...DEMO_ACTOR, action: "demo.reset", target_type: null, target_id: null, details: summary });
  return c.json({ ok: true, deleted: summary });
});
