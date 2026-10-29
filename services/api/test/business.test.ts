import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { CENTRAL_ORG_ID, type AsesorOutput, type BusinessRecommendationView, type ConsoleRecommendationView, type RiskOverview, type VictimReport } from "@blindaje/shared";
import { finalizeAsesor } from "../src/agents/asesor";
import { consejosParaVictima } from "../src/business/consejos";
import { AVISO_RUBRO, OTROS_RUBROS, VARIOS_RUBROS } from "../src/business/risk";
import { isUnsafeAdvice, sanitizePublicText } from "../src/business/safety";
import { newId, nowIso } from "../src/lib/ids";
import { hashPassword } from "../src/lib/password";
import { DEMO_BUSINESS } from "../src/routes/demo";
import { api, apiJson, createCase, insertLink, loginAs, registerDevice, seedOrg } from "./helpers";
import { call, daysAgo, fakeMeta, final, restoreMeta, seedCase, seedDevice, toolOutputs, type RecordedRequest } from "./agents-helpers";

/**
 * Inteligencia para negocios (rol business): guardas de rol, umbral de agregación, nada de números
 * ni ID-…, solo casos comunitarios, Asesor que nunca deja pasar "paga" ni "negocia", recomendaciones
 * aprobadas para la víctima y consejos de su propio caso. Todo ficticio.
 */

afterEach(() => restoreMeta());

async function createBusiness(orgId: string, opts: { sector?: string; zona?: string; disabled?: boolean } = {}) {
  const id = newId();
  const email = `negocio-${id.slice(0, 8)}@prueba.blindaje.test`;
  const password = `Clave-negocio-${id.slice(0, 6)}`;
  await env.DB.prepare(
    `INSERT INTO business_accounts (id, org_id, email, password_hash, business_name, sector, zona, disabled, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(id, orgId, email, await hashPassword(password), "Bodega de prueba (ficticia)", opts.sector ?? "bodega", opts.zona ?? "Lima Este", opts.disabled ? 1 : 0, nowIso())
    .run();
  return { id, email, password };
}

async function loginBusiness(orgId: string, opts: { sector?: string; zona?: string } = {}) {
  const b = await createBusiness(orgId, opts);
  const res = await apiJson<{ access_token: string; refresh_token: string }>("/v1/auth/business/login", { json: { email: b.email, password: b.password } });
  if (res.status !== 200) throw new Error(`business login failed ${res.status}`);
  return { ...b, token: res.body.access_token, refresh: res.body.refresh_token };
}

/** Siembra `n` casos comunitarios en una zona, repartidos entre `victims` dispositivos. */
async function seedZone(orgId: string, zona: string, n: number, victims: number, opts: { sector?: (i: number) => string; days?: (i: number) => number; consent?: (i: number) => "comunitario" | "solo_denuncia"; frases?: string[]; escalamiento?: boolean } = {}) {
  const devices = [];
  for (let i = 0; i < victims; i++) devices.push(await seedDevice(orgId));
  const cases = [];
  for (let i = 0; i < n; i++) {
    const d = opts.days?.(i) ?? 2 + i;
    cases.push(
      await seedCase({
        orgId,
        device: devices[i % victims]!,
        zona,
        sector: opts.sector?.(i) ?? "bodega",
        primer_contacto: daysAgo(d),
        grupo: "Los Ficticios del Cerro",
        canal: "yape",
        frases: opts.frases ?? ["habla con el jefe", "no llames a la policía"],
        consent: opts.consent?.(i) ?? "comunitario",
        escalamiento: opts.escalamiento && i === 0 ? [{ fecha: daysAgo(d - 4).slice(0, 10), tipo: "Foto del local con una bala" }] : [],
      }),
    );
  }
  return { devices, cases };
}

/** Recorre todos los textos de una respuesta (salvo ids y fechas) buscando números largos o ID-…. */
function leaks(value: unknown, key: string | null = null): string[] {
  const skip = new Set(["id", "org_id", "email", "approved_at", "actualizado_at", "created_at", "semana", "desde"]);
  if (typeof value === "string") {
    if (key && skip.has(key)) return [];
    return /\d(?:[\s.,-]?\d){5,}/.test(value) || /ID-/.test(value) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v) => leaks(v, key));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leaks(v, k));
  return [];
}

function allTexts(o: AsesorOutput): string[] {
  return [o.resumen, ...o.recomendaciones.flatMap((r) => [r.titulo, r.detalle]), ...o.que_hacer_si_te_pasa, ...o.advertencias, ...o.modalidades.map((m) => m.descripcion)];
}

// ---------------------------------------------------------------------------

describe("detector de consejos inseguros", () => {
  it("marca pagar, negociar y actuar contra personas, y deja pasar los consejos de no hacerlo", () => {
    for (const bad of [
      "Paga la cuota a tiempo",
      "Es mejor pagar para evitar problemas",
      "Negocia un monto menor",
      "Intenta negociar un plazo",
      "Págales por Yape y guarda el comprobante",
      "No respondas y paga",
      "No respondas, mejor paga",
      "No dudes en pagar si te amenazan",
      "Llega a un acuerdo con ellos",
      "Pide una rebaja",
      "Ofrece una parte del monto",
      "Enfrenta al cobrador",
      "Identifica a quien te llama",
      "Sigue a la persona que vino a cobrar",
    ]) {
      expect(isUnsafeAdvice(bad), bad).toBe(true);
    }
    for (const ok of [
      "No pagues ni negocies",
      "Nunca pagues ni negocies con extorsionadores",
      "Evita pagar o negociar",
      "Es mejor no pagar",
      "Si te exigen pagar, no lo hagas: denuncia",
      "Aunque te pidan que pagues, guarda la evidencia y denuncia en la Línea 1818",
      "Cuida la información del negocio en redes sociales",
      "Identifica las frases del guion",
      "Acuerda un protocolo con tu personal",
      "No enfrentes al cobrador",
      "Da parte a la policía",
      "Busca ayuda en la comisaría",
    ]) {
      expect(isUnsafeAdvice(ok), ok).toBe(false);
    }
  });

  it("los textos públicos no llevan números de 6 dígitos o más ni ID-…", () => {
    const s = sanitizePublicText("Te escriben desde el +51 987 654 321 y piden yapear al 900000202 (ID-3fa9c1, FICHA-A) el 2026-10-12.");
    expect(s).not.toMatch(/\d(?:[\s.,-]?\d){5,}/);
    expect(s).not.toContain("ID-");
    expect(s).not.toContain("FICHA-");
    expect(s).toContain("12 de octubre");
  });
});

describe("autenticación del rol business", () => {
  it("login, refresh rotativo, /me y logout; sesiones separadas de la consola", async () => {
    const { orgId } = await seedOrg();
    const b = await createBusiness(orgId);
    expect((await apiJson("/v1/auth/business/login", { json: { email: b.email, password: "incorrecta-123" } })).status).toBe(401);
    expect((await apiJson("/v1/auth/business/login", { json: { email: "nadie@prueba.blindaje.test", password: "incorrecta-123" } })).status).toBe(401);

    const login = await apiJson<{ access_token: string; refresh_token: string; business: { id: string; org: { id: string }; sector: string } }>(
      "/v1/auth/business/login",
      { json: { email: b.email.toUpperCase(), password: b.password } },
    );
    expect(login.status).toBe(200);
    expect(login.body.business).toMatchObject({ id: b.id, sector: "bodega", org: { id: orgId } });
    const claims = JSON.parse(atob(login.body.access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { role: string };
    expect(claims.role).toBe("business");

    const me = await apiJson<{ email: string }>("/v1/business/me", { token: login.body.access_token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(b.email);

    // Un refresh de negocio no sirve en la consola, y uno de consola no sirve en el portal.
    expect((await apiJson("/v1/auth/console/refresh", { json: { refresh_token: login.body.refresh_token } })).status).toBe(401);
    const reviewer = await loginAs("reviewer", orgId);
    expect((await apiJson("/v1/auth/business/refresh", { json: { refresh_token: reviewer.refresh } })).status).toBe(401);

    const ref = await apiJson<{ access_token: string; refresh_token: string }>("/v1/auth/business/refresh", { json: { refresh_token: login.body.refresh_token } });
    expect(ref.status).toBe(200);
    expect((await apiJson("/v1/auth/business/refresh", { json: { refresh_token: login.body.refresh_token } })).status).toBe(401);

    const login2 = await apiJson<{ access_token: string; refresh_token: string }>("/v1/auth/business/login", { json: { email: b.email, password: b.password } });
    expect((await api("/v1/auth/logout", { token: login2.body.access_token, json: { refresh_token: login2.body.refresh_token } })).status).toBe(204);
    expect((await apiJson("/v1/auth/business/refresh", { json: { refresh_token: login2.body.refresh_token } })).status).toBe(401);

    // Cuenta deshabilitada: no entra y su token deja de servir.
    await env.DB.prepare("UPDATE business_accounts SET disabled = 1 WHERE id = ?").bind(b.id).run();
    expect((await apiJson("/v1/auth/business/login", { json: { email: b.email, password: b.password } })).status).toBe(401);
    expect((await apiJson("/v1/business/me", { token: ref.body.access_token })).status).toBe(401);
  });

  it("guardas de rol: business no entra a consola ni a rutas de víctima, y nadie más entra al portal", async () => {
    const { orgId, invite } = await seedOrg();
    const biz = await loginBusiness(orgId);
    const victim = await registerDevice(invite);
    const analyst = await loginAs("analyst", orgId);

    const consoleRoutes: Array<[string, string]> = [
      ["GET", "/v1/console/me"],
      ["GET", "/v1/console/links"],
      ["GET", "/v1/console/networks"],
      ["GET", "/v1/console/alerts"],
      ["GET", "/v1/console/recommendations"],
      ["POST", "/v1/console/asesor/run"],
      ["POST", "/v1/console/business-accounts"],
      ["GET", "/v1/console/audit"],
    ];
    const victimRoutes: Array<[string, string]> = [
      ["GET", "/v1/cases"],
      ["POST", "/v1/cases"],
      ["GET", "/v1/alerts"],
      ["GET", "/v1/recommendations"],
      ["POST", "/v1/me/voice-sample"],
    ];
    for (const [method, path] of [...consoleRoutes, ...victimRoutes]) {
      const res = await api(path, { method, token: biz.token, ...(method === "POST" ? { json: {} } : {}) });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    for (const path of ["/v1/business/me", "/v1/business/risk", "/v1/business/recommendations", "/v1/business/alerts"]) {
      expect((await api(path, { token: victim.access_token })).status, `víctima ${path}`).toBe(403);
      expect((await api(path, { token: analyst.token })).status, `consola ${path}`).toBe(403);
      expect((await api(path)).status, `sin token ${path}`).toBe(401);
    }
  });
});

describe("panorama de riesgo agregado", () => {
  it("con 4 casos: sin_datos y null en todo; con 5 casos de 3 víctimas: cifras", async () => {
    const orgId = (await seedOrg()).orgId;
    const biz = await loginBusiness(orgId, { zona: "Zona Umbral", sector: "bodega" });
    const { devices } = await seedZone(orgId, "Zona Umbral - U1", 4, 3);

    const low = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    expect(low.status).toBe(200);
    expect(low.body.nivel_riesgo).toBe("sin_datos");
    expect(low.body.casos_periodo).toBeNull();
    expect(low.body.tendencia).toHaveLength(4);
    expect(low.body.tendencia.every((t) => t.casos === null)).toBe(true);
    expect(low.body.modalidades_activas).toEqual([]);
    expect(low.body.sectores_afectados).toEqual([]);
    expect(low.body.escalamiento).toBeNull();
    expect(low.body.aviso_umbral).toContain("Aún no hay suficientes casos para mostrar cifras");
    expect(low.body.sesgo).toMatch(/se denuncia más/);

    // Quinto caso de una de las mismas 3 víctimas, en la misma semana que los demás.
    await seedCase({ orgId, device: devices[0]!, zona: "Zona Umbral", sector: "bodega", primer_contacto: daysAgo(3), grupo: "Los Ficticios del Cerro", canal: "yape" });
    const ok = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    expect(ok.body.nivel_riesgo).not.toBe("sin_datos");
    expect(ok.body.casos_periodo).toBe(5);
    expect(ok.body.sector).toBe("bodega");
    expect(ok.body.aviso_umbral).toBeNull();
    expect(ok.body.tendencia.at(-1)!.casos).toBe(5);
    expect(ok.body.tendencia.slice(0, 3).every((t) => t.casos === null)).toBe(true);
    expect(ok.body.sectores_afectados).toEqual([{ sector: "bodega", casos: 5 }]);
    // Rasgos que cumplen el umbral: grupo, canal y frases (sin números).
    expect(ok.body.modalidades_activas).toHaveLength(1);
    expect(ok.body.modalidades_activas[0]!.descripcion).toContain("Los Ficticios del Cerro");
    expect(ok.body.modalidades_activas[0]!.senales_de_alerta).toContain("Usan la frase “habla con el jefe”");
    expect(leaks(ok.body)).toEqual([]);
  });

  it("5 casos de solo 2 víctimas no alcanzan", async () => {
    const orgId = (await seedOrg()).orgId;
    const biz = await loginBusiness(orgId, { zona: "Zona Dos Victimas" });
    await seedZone(orgId, "Zona Dos Victimas", 5, 2);
    const res = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    expect(res.body.nivel_riesgo).toBe("sin_datos");
    expect(res.body.casos_periodo).toBeNull();
  });

  it("solo cuentan los casos con consentimiento comunitario (y del mismo mundo: nada del demo)", async () => {
    const orgId = (await seedOrg()).orgId;
    const biz = await loginBusiness(orgId, { zona: "Zona Consentimiento" });
    const { cases } = await seedZone(orgId, "Zona Consentimiento", 6, 3, { consent: (i) => (i < 2 ? "solo_denuncia" : "comunitario") });
    let res = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    expect(res.body.nivel_riesgo).toBe("sin_datos");
    expect(res.body.casos_periodo).toBeNull();

    // Casos del demo en la misma zona no cuentan para una cuenta real.
    await env.DB.prepare("UPDATE cases SET consent_mode = 'comunitario', is_demo = 1 WHERE id = ?").bind(cases[0]!.id).run();
    res = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    expect(res.body.casos_periodo).toBeNull();

    await env.DB.prepare("UPDATE cases SET consent_mode = 'comunitario', is_demo = 0 WHERE id = ?").bind(cases[0]!.id).run();
    res = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    expect(res.body.casos_periodo).toBe(5);
  });

  it("si el rubro no llega al umbral, las cifras son de toda la zona; ninguna cifra exacta deja despejar un resto chico", async () => {
    const orgId = (await seedOrg()).orgId;
    const biz = await loginBusiness(orgId, { zona: "Zona Rubros", sector: "bodega" });
    await seedZone(orgId, "Zona Rubros", 7, 4, { sector: (i) => (i < 2 ? "bodega" : i < 6 ? "mototaxi" : "mercado"), escalamiento: true, days: (i) => 9 - i });
    const res = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    expect(res.body.sector).toBeNull();
    expect(res.body.casos_periodo).toBe(7);
    expect(res.body.aviso_umbral).toBe(AVISO_RUBRO);
    // Ningún rubro con menos de 5 casos aparece por su nombre.
    expect(res.body.sectores_afectados).toEqual([{ sector: VARIOS_RUBROS, casos: 7 }]);
    expect(res.body.escalamiento).toBe(
      "En esta zona, la intimidación física llegó 2 días después de vencido el plazo que dieron para pagar. No esperes al vencimiento para denunciar.",
    );
    expect(leaks(res.body)).toEqual([]);

    // Con un rubro que sí llega al umbral (7 de 10) y un resto chico (3): antes salía "mototaxi 7" con
    // el total 10, y una resta revelaba los 3 casos del resto. Ahora el rubro se nombra sin cifra.
    await seedZone(orgId, "Zona Rubros", 3, 3, { sector: () => "mototaxi" });
    const more = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    expect(more.body.casos_periodo).toBe(10);
    expect(more.body.sectores_afectados).toEqual([{ sector: "mototaxi", casos: null }]);
    expect(JSON.stringify(more.body)).not.toContain(OTROS_RUBROS);
    // Lo mismo con las semanas: lo que queda fuera de las semanas con cifra es 0 o pasa el umbral.
    const visibles = more.body.tendencia.reduce((n, t) => n + (t.casos ?? 0), 0);
    const resto = more.body.casos_periodo! - visibles;
    expect(resto === 0 || resto >= 5, `resto ${resto}`).toBe(true);
    // Y el rubro pedido sin cifra exacta propia no cambia el alcance (sería el mismo 7 por otro camino).
    const moto = await apiJson<RiskOverview>("/v1/business/risk?sector=mototaxi", { token: biz.token });
    expect(moto.body.sector).toBeNull();
    expect(moto.body.casos_periodo).toBe(10);
    expect(moto.body.aviso_umbral).toBe(AVISO_RUBRO);
  });

  it("ninguna respuesta de negocio lleva números largos ni ID-… (alertas, modalidades, recomendaciones)", async () => {
    const orgId = (await seedOrg()).orgId;
    const biz = await loginBusiness(orgId, { zona: "Zona Numeros" });
    await seedZone(orgId, "Zona Numeros", 5, 3, { frases: ["yapea al 900 000 202", "habla con el jefe"] });
    const now = nowIso();
    await env.DB.prepare("INSERT INTO alerts (id, org_id, draft_json, status, approved_at, created_at) VALUES (?, ?, ?, 'aprobada', ?, ?)")
      .bind(
        newId(),
        CENTRAL_ORG_ID,
        JSON.stringify({
          titulo: "Alerta ficticia",
          cuerpo: "Piden pagos por Yape al 987 654 321 (ID-3fa9c1). No pagues ni negocies.",
          zona: "Zona Numeros",
          modalidad: "Cobros por Yape al 987654321",
          que_hacer: ["No pagues ni negocies", "Denuncia en la Línea 1818"],
          evidencia: ["FICHA-A", "ID-3fa9c1"],
        }),
        now,
        now,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO business_recommendations (id, org_id, sector, zona, status, content_json, citation_check_json, model, approved_at, created_at)
       VALUES (?, ?, 'bodega', 'Zona Numeros', 'aprobada', ?, ?, 'muse-spark-1.3', ?, ?)`,
    )
      .bind(
        newId(),
        CENTRAL_ORG_ID,
        JSON.stringify({
          sector: "bodega",
          zona: "Zona Numeros",
          nivel_riesgo: "medio",
          resumen: "Llaman desde el 900-000-202 (FICHA-A, ID-abc123).",
          modalidades: [{ descripcion: "Cobros al 900000202", senales_de_alerta: ["yapea al 900 000 202"], evidencia: ["FICHA-A"] }],
          recomendaciones: [{ titulo: "No pagues ni negocies", detalle: "Bloquea el 987654321 después de guardar la evidencia.", prioridad: "alta" }],
          que_hacer_si_te_pasa: ["Denuncia en la Línea 1818"],
          advertencias: ["Datos ficticios ID-abc123"],
        }),
        JSON.stringify({ ok: true, total_afirmaciones: 0, sin_cita: [], citas_inexistentes: [] }),
        now,
        now,
      )
      .run();

    for (const path of ["/v1/business/me", "/v1/business/risk", "/v1/business/alerts", "/v1/business/recommendations"]) {
      const res = await apiJson(path, { token: biz.token });
      expect(res.status, path).toBe(200);
      if (path.endsWith("alerts") || path.endsWith("recommendations")) expect(JSON.stringify(res.body), path).toContain("Zona Numeros");
      expect(leaks(res.body), path).toEqual([]);
      expect(JSON.stringify(res.body), path).not.toMatch(/FICHA-|VIN-|"evidencia"/);
    }
    const risk = await apiJson<RiskOverview>("/v1/business/risk", { token: biz.token });
    // La frase con un número nunca llega como señal.
    expect(risk.body.modalidades_activas.flatMap((m) => m.senales_de_alerta).some((s) => s.includes("yapea"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Asesor
// ---------------------------------------------------------------------------

function parsedToolOutputs(req: RecordedRequest): Array<Record<string, unknown>> {
  return toolOutputs(req).map((o) => JSON.parse(o) as Record<string, unknown>);
}

/** Salida simulada del modelo que intenta aconsejar pagar y negociar, con números y un ID-…. */
function maliciousOutput(req: RecordedRequest): AsesorOutput {
  const outs = parsedToolOutputs(req);
  const mods = (outs.find((o) => "modalidades" in o)?.modalidades as Array<{ descripcion: string; senales_de_alerta: string[]; evidencia: string[] }>) ?? [];
  return {
    sector: "lo que sea",
    zona: "otra zona",
    nivel_riesgo: "alto",
    resumen: "En la zona hay cobros por Yape. Si te amenazan, paga y evita problemas. Guarda la evidencia en Blindaje.",
    modalidades: mods.map((m) => ({ descripcion: `${m.descripcion} (llaman del 987 654 321)`, senales_de_alerta: m.senales_de_alerta, evidencia: m.evidencia })),
    recomendaciones: [
      { titulo: "Paga la cuota a tiempo", detalle: "Es mejor pagar para evitar problemas.", prioridad: "alta" },
      { titulo: "Negocia un monto menor", detalle: "Intenta negociar un plazo más largo con ellos.", prioridad: "media" },
      { titulo: "Cuida tus redes", detalle: "No publiques horarios ni fotos de la caja. Bloquea el ID-abc123.", prioridad: "media" },
      { titulo: "Enfrenta al cobrador", detalle: "Identifica a quien viene a cobrar y síguelo.", prioridad: "baja" },
    ],
    que_hacer_si_te_pasa: ["Págales por Yape al 900000202", "Negocia un plazo mayor", "Guarda los audios en Blindaje"],
    advertencias: ["Llega a un acuerdo si no puedes pagar todo."],
  };
}

function asesorScript(finalFrom: (req: RecordedRequest) => AsesorOutput, zona: string) {
  return fakeMeta([
    () => [call("panorama_riesgo", { zona }), call("modalidades_activas", { zona }), call("escalamiento", { zona }), call("alertas_aprobadas", { zona })],
    (req) => [final(finalFrom(req))],
  ]);
}

describe("Asesor", () => {
  it("nunca deja pasar 'paga' ni 'negocia', quita números e ID-…, fija el nivel y queda en borrador auditado", async () => {
    const { orgId } = await seedOrg();
    // Sin zona en el pedido: el Asesor corre para los distritos que pasan el umbral (aquí, solo Carabayllo), con el rubro pedido.
    await seedZone(orgId, "carabayllo", 6, 3, { escalamiento: true, days: (i) => 8 - i });
    const analyst = await loginAs("analyst", orgId);
    const meta = asesorScript(maliciousOutput, "Carabayllo");

    const res = await apiJson<{ recommendations: ConsoleRecommendationView[] }>("/v1/console/asesor/run", { token: analyst.token, json: { sector: "bodega" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(meta.responses()).toHaveLength(2);
    // Las herramientas nunca le pasan números ni ID-… al modelo.
    for (const out of toolOutputs(meta.responses()[1]!)) {
      expect(out).not.toMatch(/ID-/);
      expect(out.replace(/\d{4}-\d{2}-\d{2}/g, "")).not.toMatch(/\d(?:[\s.,-]?\d){5,}/);
    }
    // El modelo ve rangos, no cifras exactas: una recomendación aprobada es pública.
    const panorama = parsedToolOutputs(meta.responses()[1]!).find((o) => "casos_periodo" in o)!;
    expect(panorama.casos_periodo).toBe("5-9");
    expect(res.body.recommendations).toHaveLength(1);
    const rec = res.body.recommendations[0]!;
    expect(rec.status).toBe("borrador");
    expect(rec.org_id).toBe(CENTRAL_ORG_ID);
    const c = rec.contenido;
    expect(c.zona).toBe("Carabayllo");
    expect(c.sector).toBe("bodega");
    expect(c.nivel_riesgo).toBe("medio"); // 6 casos (0) + escalamiento (1) + modalidad activa (1)
    for (const t of allTexts(c)) {
      expect(isUnsafeAdvice(t), t).toBe(false);
      expect(t, t).not.toMatch(/\d(?:[\s.,-]?\d){5,}/);
      expect(t, t).not.toContain("ID-");
    }
    expect(c.recomendaciones[0]!.titulo).toBe("No pagues ni negocies");
    expect(c.recomendaciones.map((r) => r.titulo)).toEqual(["No pagues ni negocies", "Cuida tus redes"]);
    expect(c.que_hacer_si_te_pasa[0]).toMatch(/^No pagues ni negocies/);
    expect(c.que_hacer_si_te_pasa.join(" ")).toMatch(/1818/);
    expect(c.que_hacer_si_te_pasa.join(" ")).toMatch(/\b105\b/);
    expect(c.resumen).not.toMatch(/paga/i);
    expect(c.advertencias.join(" ")).toMatch(/se denuncia más/);
    expect(allTexts(c).join(" ")).not.toMatch(/gremio/i);
    expect(c.modalidades.length).toBeGreaterThan(0);
    expect(c.modalidades[0]!.evidencia.every((e) => e.startsWith("FICHA-") || e.startsWith("VIN-") || e.startsWith("R-"))).toBe(true);
    expect(rec.citation_check.ok).toBe(true);

    const run = await env.DB.prepare("SELECT agent, status, target_type FROM agent_runs WHERE agent = 'asesor' ORDER BY created_at DESC LIMIT 1").first<{ agent: string; status: string; target_type: string }>();
    expect(run).toMatchObject({ agent: "asesor", status: "ok", target_type: "distrito" });
    const actions = (await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'agent.asesor.%'").all<{ action: string }>()).results.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["agent.asesor.run", "agent.asesor.result"]));
  });

  it("bajo el umbral el nivel es sin_datos y no hay modalidades aunque el modelo las invente", async () => {
    const { orgId } = await seedOrg();
    await seedZone(orgId, "carmen-de-la-legua-reynoso", 3, 3);
    const analyst = await loginAs("analyst", orgId);
    // Una zona que no es distrito no se acepta.
    expect((await apiJson("/v1/console/asesor/run", { token: analyst.token, json: { zona: "Lima Este" } })).status).toBe(400);
    asesorScript(
      () => ({
        sector: "bodega",
        zona: "Carmen de la Legua-Reynoso",
        nivel_riesgo: "alto",
        resumen: "Hay mucho riesgo en la zona.",
        modalidades: [{ descripcion: "Una modalidad inventada", senales_de_alerta: ["algo"], evidencia: [] }],
        recomendaciones: [{ titulo: "Acuerda un protocolo con tu personal", detalle: "Que nadie responda ni entregue nada.", prioridad: "alta" }],
        que_hacer_si_te_pasa: ["Guarda la evidencia en Blindaje"],
        advertencias: [],
      }),
      "Carmen de la Legua-Reynoso",
    );
    const res = await apiJson<{ recommendations: ConsoleRecommendationView[] }>("/v1/console/asesor/run", {
      token: analyst.token,
      json: { zona: "Carmen de la Legua", sector: "bodega" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const c = res.body.recommendations[0]!.contenido;
    expect(c.nivel_riesgo).toBe("sin_datos");
    expect(c.modalidades).toEqual([]);
    expect(c.resumen).toContain("Aún no hay suficientes casos");
    expect(c.advertencias.join(" ")).toContain("Aún no hay suficientes casos para mostrar cifras");
    expect(c.recomendaciones[0]).toMatchObject({ titulo: "No pagues ni negocies" });
  });

  it("finalizeAsesor corrige una salida que aconseja pagar o negociar", () => {
    const raw: AsesorOutput = {
      sector: "x",
      zona: "y",
      nivel_riesgo: "alto",
      resumen: "Lo mejor es pagar. Negocia si puedes.",
      modalidades: [],
      recomendaciones: [{ titulo: "Paga", detalle: "Paga la cuota.", prioridad: "alta" }],
      que_hacer_si_te_pasa: ["Negocia", "Paga"],
      advertencias: ["Págales si te amenazan"],
    };
    const { output, descartados } = finalizeAsesor(raw, { zona: "Zona Z", nivel: "bajo", modalidades: [] }, "bodega");
    expect(descartados.length).toBeGreaterThanOrEqual(5);
    for (const t of allTexts(output)) expect(isUnsafeAdvice(t), t).toBe(false);
    expect(output.recomendaciones).toHaveLength(1);
    expect(output.nivel_riesgo).toBe("bajo");
  });

  it("el equipo central aprueba; la ven la víctima del distrito, el portal público y el negocio de la zona", async () => {
    const { orgId, invite } = await seedOrg();
    const other = await seedOrg();
    await seedZone(orgId, "el-agustino", 5, 3);
    const analyst = await loginAs("analyst", orgId);
    const reviewer = await loginAs("reviewer", orgId);
    const otherReviewer = await loginAs("reviewer", other.orgId);
    const biz = await loginBusiness(orgId, { zona: "El Agustino" });
    const victim = await registerDevice(invite);
    await createCase(victim.access_token, "solo_denuncia", { zona: "el-agustino" });
    const outsider = await registerDevice(other.invite);
    await createCase(outsider.access_token, "solo_denuncia", { zona: "rimac" });

    asesorScript(maliciousOutput, "El Agustino");
    const run = await apiJson<{ recommendations: ConsoleRecommendationView[] }>("/v1/console/asesor/run", {
      token: analyst.token,
      json: { zona: "el-agustino", sector: "bodega" },
    });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const id = run.body.recommendations[0]!.id;
    expect(run.body.recommendations[0]!.org_id).toBe(CENTRAL_ORG_ID);

    // En borrador no la ve nadie fuera de la consola.
    expect((await apiJson<{ recommendations: unknown[] }>("/v1/recommendations", { token: victim.access_token })).body.recommendations).toEqual([]);
    expect((await apiJson<{ recommendations: unknown[] }>("/v1/business/recommendations", { token: biz.token })).body.recommendations).toEqual([]);
    expect((await apiJson<{ recommendations: unknown[] }>("/v1/public/recommendations?zona=el-agustino")).body.recommendations).toEqual([]);

    // Toda revisora del equipo central la ve, sin importar su organización.
    const list = await apiJson<{ recommendations: ConsoleRecommendationView[] }>("/v1/console/recommendations?status=borrador", { token: otherReviewer.token });
    expect(list.body.recommendations.map((r) => r.id)).toContain(id);
    const ok = await apiJson<ConsoleRecommendationView>(`/v1/console/recommendations/${id}/decision`, { token: reviewer.token, json: { decision: "aprobar" } });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("aprobada");
    expect(ok.body.approved_at).toBeTruthy();
    const audited = await env.DB.prepare("SELECT details_json FROM audit_log WHERE action = 'recommendation.decision' AND target_id = ?").bind(id).first<{ details_json: string }>();
    expect(JSON.parse(audited!.details_json)).toMatchObject({ decision: "aprobar", previous: "borrador" });

    const mine = await apiJson<{ recommendations: BusinessRecommendationView[] }>("/v1/recommendations", { token: victim.access_token });
    expect(mine.status).toBe(200);
    expect(mine.body.recommendations.map((r) => r.id)).toEqual([id]);
    expect(mine.body.recommendations[0]).toMatchObject({ zona: "El Agustino", distrito: "el-agustino", sector: "bodega" });
    expect(JSON.stringify(mine.body)).not.toMatch(/FICHA-|VIN-|R-\d|"evidencia"/);
    expect(leaks(mine.body)).toEqual([]);
    // Fuera del distrito no aparece; con el distrito elegido en el celular, sí (y filtra por rubro).
    expect((await apiJson<{ recommendations: unknown[] }>("/v1/recommendations", { token: outsider.access_token })).body.recommendations).toEqual([]);
    const elegido = await apiJson<{ recommendations: Array<{ id: string }> }>("/v1/recommendations?zona=el-agustino&sector=bodega", { token: outsider.access_token });
    expect(elegido.body.recommendations.map((r) => r.id)).toEqual([id]);
    expect((await apiJson<{ recommendations: unknown[] }>("/v1/recommendations?zona=el-agustino&sector=mototaxi", { token: outsider.access_token })).body.recommendations).toEqual([]);

    const forBiz = await apiJson<{ recommendations: BusinessRecommendationView[] }>("/v1/business/recommendations", { token: biz.token });
    expect(forBiz.body.recommendations.map((r) => r.id)).toEqual([id]);
    expect(leaks(forBiz.body)).toEqual([]);

    // Rechazada (la analista también decide): deja de verse.
    const rejected = await apiJson(`/v1/console/recommendations/${id}/decision`, { token: analyst.token, json: { decision: "rechazar" } });
    expect(rejected.status).toBe(200);
    expect((await apiJson<{ recommendations: unknown[] }>("/v1/recommendations", { token: victim.access_token })).body.recommendations).toEqual([]);
  });

  it("una recomendación que no pasó el validador de citas no se puede aprobar", async () => {
    const { orgId } = await seedOrg();
    await seedZone(orgId, "independencia", 5, 3);
    const analyst = await loginAs("analyst", orgId);
    const reviewer = await loginAs("reviewer", orgId);
    // Cita una ficha que no existe en las dos vueltas (la segunda, después de la lista de problemas).
    const bad = (): AsesorOutput => ({
      ...maliciousOutput({ url: "", body: {} }),
      modalidades: [{ descripcion: "Cobros por Yape con un plazo corto", senales_de_alerta: [], evidencia: ["FICHA-ZZZZ"] }],
    });
    fakeMeta([() => [call("modalidades_activas", { zona: "Independencia" })], () => [final(bad())], () => [final(bad())]]);
    const run = await apiJson<{ recommendations: ConsoleRecommendationView[] }>("/v1/console/asesor/run", {
      token: analyst.token,
      json: { zona: "independencia", sector: "bodega" },
    });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const rec = run.body.recommendations[0]!;
    expect(rec.citation_check.ok).toBe(false);
    expect(rec.status).toBe("borrador");
    expect((await apiJson(`/v1/console/recommendations/${rec.id}/decision`, { token: reviewer.token, json: { decision: "aprobar" } })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Víctima: consejos de su propio caso
// ---------------------------------------------------------------------------

describe("consejos para la víctima", () => {
  it("siempre dicen no pagues ni negocies, 1818 y 105, sin datos de nadie más", () => {
    const base = consejosParaVictima(null);
    expect(base[0]).toMatch(/^No pagues ni negocies/);
    expect(base.join(" ")).toMatch(/1818/);
    expect(base.join(" ")).toMatch(/\b105\b/);
    for (const t of base) expect(isUnsafeAdvice(t), t).toBe(false);
  });

  it("según su ficha (escalamiento físico → 105) y sin mencionar otros casos, vínculos ni redes", async () => {
    const { invite } = await seedOrg();
    const real = await registerDevice(invite);
    const otra = await registerDevice(invite);
    const mine = await createCase(real.access_token, "comunitario");
    const theirs = await createCase(otra.access_token, "comunitario");
    const ficha = {
      caso: mine.code,
      zona: "Lima Este",
      sector: "mototaxi",
      primer_contacto: daysAgo(6),
      tipo_amenaza: "dano_vehiculo",
      amenaza: "Amenazan con quemar la mototaxi (ficticio)",
      monto_soles: 500,
      periodicidad: "semanal",
      plazo: "48 horas",
      plazo_horas: 48,
      canal_pago: "yape",
      identificadores: [],
      grupo_que_dice_ser: "Los Ficticios",
      frases_firma: ["no llames a la policía"],
      escalamiento: [{ fecha: daysAgo(2).slice(0, 10), tipo: "Visita al paradero", evidencia: [] }],
      resumen_mo: "Mensajes por WhatsApp (ficticio)",
      fuentes: [],
    };
    await env.DB.prepare("UPDATE cases SET ficha_json = ?, estado = 'listo', indexed = 1 WHERE id = ?").bind(JSON.stringify(ficha), mine.id).run();
    await env.DB.prepare("UPDATE cases SET ficha_json = ?, estado = 'listo', indexed = 1 WHERE id = ?").bind(JSON.stringify({ ...ficha, caso: theirs.code }), theirs.id).run();
    const link = await insertLink(mine.id, theirs.id, "confirmado", 0.97);

    const res = await api(`/v1/cases/${mine.id}/report`, { token: real.access_token });
    expect(res.status).toBe(200);
    const text = await res.text();
    const report = JSON.parse(text) as VictimReport;
    expect(report.consejos.length).toBeGreaterThan(3);
    expect(report.consejos[0]).toMatch(/^No pagues ni negocies/);
    const all = report.consejos.join(" ");
    expect(all).toMatch(/llama al 105 de inmediato/);
    expect(all).toMatch(/no avises a la policía/);
    expect(all).toMatch(/rutas/);
    for (const t of report.consejos) expect(isUnsafeAdvice(t), t).toBe(false);
    expect(all).not.toMatch(/otros casos|otro caso|vínculo|vinculad|\bred\b|coincid|VIN-|R-\d|FICHA-/i);
    expect(all).not.toContain(theirs.code);
    expect(text).not.toContain(theirs.id);
    expect(text).not.toContain(`VIN-${link.num}`);
  });
});

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

describe("demo: cuenta de negocio ficticia", () => {
  it("seed la crea (idempotente) y reset la borra", async () => {
    const secret = { "x-demo-secret": "demo-secret-de-prueba" };
    const seed = await apiJson<{ business_accounts: Array<{ email: string; business_name: string }> }>("/v1/demo/seed", { method: "POST", headers: secret });
    expect(seed.status).toBe(201);
    expect(seed.body.business_accounts[0]).toMatchObject({ email: DEMO_BUSINESS.email, business_name: "Bodega Don Lucho (ficticia)" });
    expect((await apiJson("/v1/demo/seed", { method: "POST", headers: secret })).status).toBe(201);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM business_accounts WHERE is_demo = 1").first<{ n: number }>())!.n).toBe(1);

    const login = await apiJson<{ business: { zona: string; sector: string } }>("/v1/auth/business/login", {
      json: { email: DEMO_BUSINESS.email, password: DEMO_BUSINESS.password },
    });
    expect(login.status).toBe(200);
    expect(login.body.business).toMatchObject({ zona: "san-juan-de-lurigancho", sector: "bodega" });

    const reset = await apiJson<{ deleted: { business_accounts: number } }>("/v1/demo/reset", { method: "POST", headers: secret });
    expect(reset.status).toBe(200);
    expect(reset.body.deleted.business_accounts).toBe(1);
    expect(await env.DB.prepare("SELECT 1 FROM business_accounts WHERE id = ?").bind(DEMO_BUSINESS.id).first()).toBeNull();
    expect((await apiJson("/v1/auth/business/login", { json: { email: DEMO_BUSINESS.email, password: DEMO_BUSINESS.password } })).status).toBe(401);
  });
});
