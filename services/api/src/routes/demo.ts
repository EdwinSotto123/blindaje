import { Hono } from "hono";
import { CENTRAL_ORG_ID, districtById, type FichaStored, type Sector, type TipoAmenaza } from "@blindaje/shared";
import { audit } from "../audit";
import { DEMO_PATTERN_PREFIX } from "../business/risk";
import { deleteCaseFully, type CaseRow } from "../cases";
import { timingSafeEqualStr } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { hashPassword } from "../lib/password";
import { recomputeNetworks } from "../networks";
import type { Actor, AppEnv } from "../types";

/**
 * Modo demo (solo con DEMO_MODE=true y header x-demo-secret = DEMO_SECRET).
 * Todo lo que crea está marcado is_demo y dice "ficticio" (también la cuenta del portal de negocios,
 * "Bodega Don Lucho (ficticia)"). Las contraseñas están en README.md.
 * Los casos A, B y C los crea el script de eval/ usando la API como la app, con los códigos de
 * invitación DEMO-CASO-* y el header `x-demo-case-code`.
 * Desde el rediseño del 28/10: el equipo (revisión, análisis, administración) es de la organización
 * central, la organización demo queda como canal de difusión de las invitaciones, y el seed agrega
 * casos ficticios por distrito (fichas sin evidencia) para que el mapa tenga distritos sobre y bajo
 * el umbral.
 */
export const demoRoutes = new Hono<AppEnv>();

/** Canal de difusión del demo: emite las invitaciones que usa el script de eval/. */
export const DEMO_ORG = {
  id: "org-demo-bodegueros-lima-este",
  name: "Asociación de Bodegueros de Lima Este (datos ficticios)",
  kind: "gremio",
  district: "Lima Este",
};

export const CENTRAL_ORG = { id: CENTRAL_ORG_ID, name: "Equipo Blindaje", kind: "alianza" } as const;

/**
 * El equipo central del demo. Revisora y analista tienen las contraseñas de services/api/README.md. La
 * de administración nunca está en el código (admin crea usuarios y ve todo): sale del secreto
 * DEMO_ADMIN_PASSWORD y, si no existe, el seed no crea esa cuenta.
 */
export const DEMO_USERS = [
  {
    id: "usr-demo-revisora",
    email: "revisora@demo.blindaje.test",
    display_name: "Revisora Demo",
    role: "reviewer",
    password: "Revisora-Demo-2026",
  },
  {
    id: "usr-demo-analista",
    email: "analista@demo.blindaje.test",
    display_name: "Analista Demo",
    role: "analyst",
    password: "Analista-Demo-2026",
  },
  {
    id: "usr-demo-admin",
    email: "admin@demo.blindaje.test",
    display_name: "Administración Demo",
    role: "admin",
    password: null,
  },
] as const;

/** Cuenta del portal de negocios anterior (rol business). Contraseña documentada en README.md. */
export const DEMO_BUSINESS = {
  id: "biz-demo-bodega-don-lucho",
  email: "negocio@demo.blindaje.test",
  business_name: "Bodega Don Lucho (ficticia)",
  sector: "bodega",
  zona: "san-juan-de-lurigancho",
  password: "Negocio-Demo-2026",
} as const;

export const DEMO_INVITES = [
  { code: "DEMO-CASO-A", max_uses: 5 },
  { code: "DEMO-CASO-B", max_uses: 5 },
  { code: "DEMO-CASO-C", max_uses: 5 },
  { code: "DEMO-LIMA-ESTE", max_uses: 100 },
] as const;

// ---------------------------------------------------------------------------
// Casos agregados del demo (solo para el mapa y el panorama por distrito)
// ---------------------------------------------------------------------------

/**
 * Casos ficticios por distrito: fichas sin evidencia, sin números, sin grupo, sin frases y sin canal
 * de pago conocido (así no forman patrones para el Vigía ni redes), con consentimiento comunitario.
 * `casos` y `victimas` caen en los últimos 28 días; `previos`, en los 28 anteriores (tendencia).
 * Unos distritos pasan el umbral (con rangos, niveles y tendencias distintos) y otros no.
 */
interface DemoZone {
  distrito: string;
  casos: number;
  victimas: number;
  previos: number;
  sectores: Sector[];
  amenazas: TipoAmenaza[];
  /** Cuántos de los casos más antiguos del periodo tuvieron intimidación física después del plazo. */
  escalamiento?: number;
}

export const DEMO_ZONES: readonly DemoZone[] = [
  // Sobre el umbral. San Juan de Lurigancho también tiene los casos de la historia (A, C, D, E, F y G).
  { distrito: "san-juan-de-lurigancho", casos: 9, victimas: 7, previos: 4, sectores: ["bodega", "mototaxi", "mercado"], amenazas: ["dano_local"], escalamiento: 1 },
  { distrito: "villa-el-salvador", casos: 23, victimas: 16, previos: 12, sectores: ["bodega", "bodega", "mototaxi", "transporte"], amenazas: ["dano_local", "dano_fisico"], escalamiento: 2 },
  { distrito: "ate", casos: 12, victimas: 8, previos: 11, sectores: ["mototaxi", "transporte", "bodega"], amenazas: ["dano_vehiculo"] },
  { distrito: "comas", casos: 7, victimas: 5, previos: 12, sectores: ["mercado", "bodega"], amenazas: ["dano_local"] },
  { distrito: "lima", casos: 5, victimas: 3, previos: 0, sectores: ["mercado", "restaurante"], amenazas: ["difusion_informacion"] },
  // Sin modalidad que pase el umbral ni intimidación: nivel bajo.
  { distrito: "la-victoria", casos: 6, victimas: 4, previos: 5, sectores: ["mercado", "restaurante", "construccion"], amenazas: ["dano_local", "dano_familia", "dano_fisico", "difusion_informacion", "otro"] },
  // Bajo el umbral: en el mapa se ven igual que un distrito sin casos.
  { distrito: "san-martin-de-porres", casos: 4, victimas: 4, previos: 3, sectores: ["bodega"], amenazas: ["dano_local"] },
  { distrito: "los-olivos", casos: 6, victimas: 2, previos: 0, sectores: ["restaurante"], amenazas: ["dano_local"] },
  { distrito: "callao", casos: 3, victimas: 3, previos: 2, sectores: ["transporte"], amenazas: ["dano_vehiculo"] },
  { distrito: "puente-piedra", casos: 2, victimas: 2, previos: 0, sectores: ["mototaxi"], amenazas: ["dano_vehiculo"] },
];

/** Plataforma de los dispositivos de los casos agregados: así el reset los borra en bloque. */
export const DEMO_AGGREGATE_PLATFORM = "demo-agregado";

const DAY_MS = 86_400_000;
const AMENAZA_TEXTO: Record<TipoAmenaza, string> = {
  dano_local: "Amenaza con dañar el local (ficticio)",
  dano_fisico: "Amenaza con hacer daño a la persona (ficticio)",
  dano_familia: "Amenaza a la familia (ficticio)",
  dano_vehiculo: "Amenaza con dañar el vehículo (ficticio)",
  difusion_informacion: "Amenaza con difundir información (ficticio)",
  otro: "Otra amenaza (ficticio)",
};

function limaIso(ms: number): string {
  return `${new Date(ms - 5 * 3600_000).toISOString().slice(0, 19)}-05:00`;
}

/** Total de casos agregados que crea el seed (para el reset y los tests). */
export function demoAggregateCount(): number {
  return DEMO_ZONES.reduce((n, z) => n + z.casos + z.previos, 0);
}

/**
 * Sentencias del seed de casos agregados. Códigos de caso "0NNN" y seudónimos "V-0NND": llevan un
 * 0, que ni caseCode() ni pseudonym() generan, así que nunca chocan con casos o víctimas reales.
 */
function aggregateStatements(env: AppEnv["Bindings"], now: number): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  const created = nowIso();
  let device = 0;
  let caso = 0;
  for (const z of DEMO_ZONES) {
    if (!districtById(z.distrito)) throw new Error(`Distrito desconocido en DEMO_ZONES: ${z.distrito}`);
    const devices: Array<{ id: string; pse: string }> = [];
    for (let i = 0; i < z.victimas; i++) {
      const d = { id: newId(), pse: `V-0${String(device++).padStart(2, "0")}D` };
      devices.push(d);
      stmts.push(
        env.DB.prepare(
          "INSERT INTO devices (id, org_id, pseudonym, public_key_jwk, platform, is_demo, created_at) VALUES (?, ?, ?, '{}', ?, 1, ?)",
        ).bind(d.id, CENTRAL_ORG_ID, d.pse, DEMO_AGGREGATE_PLATFORM, created),
      );
    }
    const periodos: Array<{ n: number; desde: number }> = [
      { n: z.casos, desde: 1 },
      { n: z.previos, desde: 29 },
    ];
    for (const [p, periodo] of periodos.entries()) {
      for (let i = 0; i < periodo.n; i++) {
        // i = 0 es el más antiguo del periodo: del día desde+26 al día desde.
        const dias = periodo.desde + 26 - Math.round((i * 26) / Math.max(1, periodo.n - 1));
        const t = now - dias * DAY_MS;
        const code = `0${String(caso++).padStart(3, "0")}`;
        const dev = devices[i % devices.length]!;
        const sector = z.sectores[i % z.sectores.length]!;
        const amenaza = z.amenazas[i % z.amenazas.length]!;
        const escala = p === 0 && i < (z.escalamiento ?? 0);
        const ficha: FichaStored = {
          caso: code,
          zona: z.distrito,
          sector,
          primer_contacto: limaIso(t),
          tipo_amenaza: amenaza,
          amenaza: AMENAZA_TEXTO[amenaza],
          monto_soles: [300, 500, 800, 1200, 2000][i % 5]!,
          periodicidad: i % 2 ? "semanal" : "unico",
          plazo: escala ? "48 horas" : null,
          plazo_horas: escala ? 48 : null,
          canal_pago: "otro",
          identificadores: [],
          grupo_que_dice_ser: null,
          frases_firma: [],
          escalamiento: escala ? [{ fecha: limaIso(t + 4 * DAY_MS).slice(0, 10), tipo: "Visita intimidatoria al local (ficticio)", evidencia: [] }] : [],
          resumen_mo: "Caso agregado ficticio del demo: solo cuenta para el mapa por distrito (sin evidencia).",
          fuentes: [],
        };
        stmts.push(
          env.DB.prepare(
            `INSERT INTO cases (id, code, org_id, device_id, seudonimo_victima, sector, zona_cuadricula, primer_contacto, estado, consent_mode,
               ficha_json, indexed, is_demo, created_at, updated_at, submitted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'listo', 'comunitario', ?, 0, 1, ?, ?, ?)`,
          ).bind(newId(), code, CENTRAL_ORG_ID, dev.id, dev.pse, sector, z.distrito, ficha.primer_contacto, JSON.stringify(ficha), created, created, created),
        );
      }
    }
  }
  return stmts;
}

const AGGREGATE_DEVICES = `SELECT id FROM devices WHERE is_demo = 1 AND platform = '${DEMO_AGGREGATE_PLATFORM}'`;

/** Borra los casos agregados y sus dispositivos (no tienen evidencia, vínculos ni índices). */
async function deleteAggregates(env: AppEnv["Bindings"]): Promise<number> {
  const [del] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM cases WHERE is_demo = 1 AND device_id IN (${AGGREGATE_DEVICES})`),
    env.DB.prepare(`DELETE FROM refresh_tokens WHERE subject_type = 'device' AND subject_id IN (${AGGREGATE_DEVICES})`),
    env.DB.prepare(`DELETE FROM devices WHERE id IN (${AGGREGATE_DEVICES})`),
  ]);
  return del!.meta.changes ?? 0;
}

async function chunkedBatch(env: AppEnv["Bindings"], stmts: D1PreparedStatement[], size = 50): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) await env.DB.batch(stmts.slice(i, i + size));
}

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
  // La organización central la crea la migración 0004; el seed la asegura por si falta.
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO organizations (id, name, kind, district, is_demo, created_at) VALUES (?, ?, ?, NULL, 0, ?)").bind(
      CENTRAL_ORG.id,
      CENTRAL_ORG.name,
      CENTRAL_ORG.kind,
      now,
    ),
    env.DB.prepare("INSERT OR IGNORE INTO organizations (id, name, kind, district, is_demo, created_at) VALUES (?, ?, ?, ?, 1, ?)").bind(
      DEMO_ORG.id,
      DEMO_ORG.name,
      DEMO_ORG.kind,
      DEMO_ORG.district,
      now,
    ),
  ]);
  const createdUsers: string[] = [];
  for (const u of DEMO_USERS) {
    const password = u.password ?? env.DEMO_ADMIN_PASSWORD;
    if (!password) continue;
    const exists = await env.DB.prepare("SELECT id FROM users WHERE id = ? OR email = ?").bind(u.id, u.email).first<{ id: string }>();
    if (exists) {
      // Un seed anterior al rediseño los dejó en la organización demo: pasan al equipo central.
      await env.DB.prepare("UPDATE users SET org_id = ?, display_name = ? WHERE id = ? AND is_demo = 1").bind(CENTRAL_ORG_ID, u.display_name, exists.id).run();
      continue;
    }
    await env.DB.prepare(
      "INSERT INTO users (id, org_id, email, display_name, password_hash, role, disabled, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)",
    )
      .bind(u.id, CENTRAL_ORG_ID, u.email, u.display_name, await hashPassword(password), u.role, now)
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
  // Casos agregados: se reemplazan en cada seed para que las fechas sigan dentro del periodo.
  await deleteAggregates(env);
  await chunkedBatch(env, aggregateStatements(env, Date.now()));
  const sobre = DEMO_ZONES.filter((z) => z.casos >= 5 && z.victimas >= 3).map((z) => z.distrito);
  const bajo = DEMO_ZONES.filter((z) => !sobre.includes(z.distrito)).map((z) => z.distrito);
  await audit(env, {
    ...DEMO_ACTOR,
    action: "demo.seed",
    target_type: "organization",
    target_id: DEMO_ORG.id,
    details: { users_created: createdUsers.length, business_created: bizExists ? 0 : 1, aggregate_cases: demoAggregateCount() },
  });
  return c.json(
    {
      org: { id: DEMO_ORG.id, name: DEMO_ORG.name },
      central: { id: CENTRAL_ORG.id, name: CENTRAL_ORG.name },
      users: DEMO_USERS.map((u) => ({ id: u.id, email: u.email, display_name: u.display_name, role: u.role })),
      invites: DEMO_INVITES.map((i) => i.code),
      business_accounts: [
        { id: DEMO_BUSINESS.id, email: DEMO_BUSINESS.email, business_name: DEMO_BUSINESS.business_name, sector: DEMO_BUSINESS.sector, zona: DEMO_BUSINESS.zona },
      ],
      zonas: { casos_agregados: demoAggregateCount(), sobre_umbral: sobre, bajo_umbral: bajo, consulta: "GET /v1/public/zones?demo=1" },
      passwords: "Ver services/api/README.md (sección Demo)",
      ficticio: true,
    },
    201,
  );
});

demoRoutes.post("/reset", async (c) => {
  const env = c.env;
  const demoOrgs = "SELECT id FROM organizations WHERE is_demo = 1";
  const counts = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM devices WHERE is_demo = 1 OR org_id IN (${demoOrgs})`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_demo = 1 OR org_id IN (${demoOrgs})`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM business_accounts WHERE is_demo = 1 OR org_id IN (${demoOrgs})`),
  ]);
  // Los casos agregados se borran en bloque (no tienen evidencia, vínculos ni índices); los demás,
  // uno por uno con todo lo suyo.
  const aggregates = await deleteAggregates(env);
  const { results: cases } = await env.DB.prepare(`SELECT * FROM cases WHERE is_demo = 1 OR org_id IN (${demoOrgs})`).all<CaseRow>();
  for (const cs of cases) await deleteCaseFully(env, cs, DEMO_ACTOR, { recompute: false });
  await recomputeNetworks(env);

  // Alertas del demo: las del Vigía con casos del demo (en la organización central, con el prefijo)
  // y las de organizaciones demo anteriores al rediseño.
  const demoAlerts = `SELECT id FROM alerts WHERE org_id IN (${demoOrgs}) OR COALESCE(pattern_key, '') LIKE '${DEMO_PATTERN_PREFIX}%'`;
  const { results: alertImages } = await env.DB.prepare(
    `SELECT image_r2_key FROM alerts WHERE image_r2_key IS NOT NULL AND id IN (${demoAlerts})`,
  ).all<{ image_r2_key: string }>();
  if (alertImages.length) await env.EVIDENCE.delete(alertImages.map((a) => a.image_r2_key));

  const demoUsers = "SELECT id FROM users WHERE is_demo = 1 OR org_id IN (SELECT id FROM organizations WHERE is_demo = 1)";
  const demoDevices = "SELECT id FROM devices WHERE is_demo = 1 OR org_id IN (SELECT id FROM organizations WHERE is_demo = 1)";
  const demoBusiness = "SELECT id FROM business_accounts WHERE is_demo = 1 OR org_id IN (SELECT id FROM organizations WHERE is_demo = 1)";
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM alerts WHERE id IN (${demoAlerts})`),
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
    cases: cases.length + aggregates,
    aggregate_cases: aggregates,
    devices: (counts[0]!.results[0] as { n: number }).n,
    users: (counts[1]!.results[0] as { n: number }).n,
    business_accounts: (counts[2]!.results[0] as { n: number }).n,
  };
  await audit(env, { ...DEMO_ACTOR, action: "demo.reset", target_type: null, target_id: null, details: summary });
  return c.json({ ok: true, deleted: summary });
});
