import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { CENTRAL_ORG_ID, type ConsoleZones, type PublicRiskOverview, type PublicZoneMap, type RiskOverview } from "@blindaje/shared";
import { app } from "../src/app";
import { newId, nowIso } from "../src/lib/ids";
import { hashPassword } from "../src/lib/password";
import { recomputeNetworks } from "../src/networks";
import { api, apiJson, insertLink, loginAs, registerDevice } from "./helpers";
import { daysAgo, seedCase, seedDevice, seedOrgRow } from "./agents-helpers";

/**
 * Portal público por distrito y vista de zonas de la consola (rediseño del 28/10). Todo ficticio.
 * Cada prueba usa distritos propios: el almacenamiento se comparte dentro del archivo.
 */

async function seedDistrict(
  zona: string,
  n: number,
  victims: number,
  opts: { sector?: (i: number) => string; days?: (i: number) => number; demo?: boolean } = {},
) {
  const org = await seedOrgRow();
  const devices = [];
  for (let i = 0; i < victims; i++) devices.push(await seedDevice(org));
  const cases = [];
  for (let i = 0; i < n; i++) {
    // Sin grupo, canal ni frases: no forman patrones para el Vigía.
    cases.push(
      await seedCase({
        orgId: org,
        device: devices[i % victims]!,
        zona,
        sector: opts.sector?.(i) ?? "bodega",
        primer_contacto: daysAgo(opts.days?.(i) ?? 2 + (i % 4)),
        grupo: null,
        canal: "otro",
        frases: [],
      }),
    );
  }
  if (opts.demo) for (const c of cases) await env.DB.prepare("UPDATE cases SET is_demo = 1 WHERE id = ?").bind(c.id).run();
  return cases;
}

async function insertAlert(o: { org?: string; zona: string; titulo: string; modalidad?: string; status?: "aprobada" | "borrador"; patternKey?: string; cuerpo?: string }) {
  const id = newId();
  const status = o.status ?? "aprobada";
  await env.DB.prepare("INSERT INTO alerts (id, org_id, pattern_key, draft_json, status, approved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(
      id,
      o.org ?? CENTRAL_ORG_ID,
      o.patternKey ?? null,
      JSON.stringify({
        titulo: o.titulo,
        cuerpo: o.cuerpo ?? "Circulan mensajes que piden pagos. No pagues ni negocies.",
        zona: o.zona,
        modalidad: o.modalidad ?? "Mensajes que piden pagos (ficticio)",
        que_hacer: ["Denuncia en la Línea 1818"],
        evidencia: ["FICHA-ABCD", "VIN-3", "ID-abc123"],
      }),
      status,
      status === "aprobada" ? nowIso() : null,
      nowIso(),
    )
    .run();
  return id;
}

const cell = (m: PublicZoneMap, id: string) => m.celdas.find((c) => c.distrito === id)!;

describe("mapa público por distrito", () => {
  it("los 50 distritos; rango y nivel solo sobre el umbral; bajo el umbral igual que sin casos; sin totales; nota de sesgo", async () => {
    await seedDistrict("punta-negra", 6, 3);
    await seedDistrict("San Bartolo - B2", 4, 4);
    await seedDistrict("pucusana", 6, 2);
    await seedDistrict("Zona Inventada", 7, 4);
    // Casos del demo solo cuentan en el mapa del demo.
    await seedDistrict("punta-hermosa", 6, 3, { demo: true });
    await insertAlert({ zona: "Punta Negra", titulo: "punta negra", modalidad: "Cobros por llamadas (ficticio)" });
    await insertAlert({ zona: "Punta Negra", titulo: "borrador", modalidad: "En borrador", status: "borrador" });
    await insertAlert({ zona: "Punta Negra", titulo: "demo", modalidad: "Del demo", patternKey: "demo:ficticio" });
    await insertAlert({ org: await seedOrgRow(), zona: "Punta Negra", titulo: "otra org", modalidad: "De otra organización" });
    await insertAlert({ zona: "San Bartolo", titulo: "bajo umbral", modalidad: "Bajo el umbral" });

    const res = await api("/v1/public/zones");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const map = (await res.json()) as PublicZoneMap;
    expect(Object.keys(map).sort()).toEqual(["actualizado", "celdas", "demo", "nota_sesgo", "periodo_dias", "umbral"]);
    expect(map).toMatchObject({ periodo_dias: 28, umbral: { casos: 5, victimas: 3 }, demo: false });
    expect(map.nota_sesgo).toMatch(/se denuncia más/);
    expect(map.celdas).toHaveLength(50);

    const pn = cell(map, "punta-negra");
    expect(pn).toMatchObject({ casos: "5-9", tendencia: "sube", modalidades: ["Cobros por llamadas (ficticio)"] });
    expect(pn.nivel).not.toBe("sin_datos");
    // Un distrito bajo el umbral (por casos o por víctimas) no se distingue de uno sin casos.
    const vacio = cell(map, "santa-maria-del-mar");
    expect(vacio).toEqual({ distrito: "santa-maria-del-mar", nivel: "sin_datos", casos: null, tendencia: null, modalidades: [] });
    for (const id of ["san-bartolo", "pucusana", "punta-hermosa"]) expect({ ...cell(map, id), distrito: "x" }, id).toEqual({ ...vacio, distrito: "x" });
    // Nada de cifras exactas ni de un cubo "otras zonas" (la zona inventada no aparece en ningún lado).
    expect(JSON.stringify(map.celdas)).not.toMatch(/"\w+":\d/);
    expect(JSON.stringify(map)).not.toMatch(/otras zonas|Zona Inventada|total/i);

    const demo = await apiJson<PublicZoneMap>("/v1/public/zones?demo=1");
    expect(demo.body.demo).toBe(true);
    expect(cell(demo.body, "punta-hermosa").casos).toBe("5-9");
    expect(cell(demo.body, "punta-negra").nivel).toBe("sin_datos");

    // Donde DEMO_MODE no es "true", ?demo=1 se ignora: siempre los casos reales.
    const ctx = createExecutionContext();
    const prod = await app.fetch(
      new Request("https://api.blindaje.test/v1/public/zones?demo=1", { headers: { "cf-connecting-ip": "192.0.2.80" } }),
      { ...env, DEMO_MODE: "false" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const prodMap = (await prod.json()) as PublicZoneMap;
    expect(prodMap.demo).toBe(false);
    expect(cell(prodMap, "punta-hermosa").nivel).toBe("sin_datos");
    expect(cell(prodMap, "punta-negra").casos).toBe("5-9");
  });
});

describe("panorama público por distrito", () => {
  it("rangos en vez de cifras, sin 'otros rubros' ni semanas que se puedan restar (tampoco en el portal anterior)", async () => {
    // 10 casos de 6 víctimas: mototaxi 7, bodega 2, mercado 1. Ocho en la última semana y dos antes.
    await seedDistrict("cieneguilla", 10, 6, {
      sector: (i) => (i < 7 ? "mototaxi" : i < 9 ? "bodega" : "mercado"),
      days: (i) => (i < 8 ? 1 + (i % 5) : 10 + i - 8),
    });
    const res = await api("/v1/public/risk?zona=cieneguilla");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const risk = (await res.json()) as PublicRiskOverview;
    expect(Object.keys(risk).sort()).toEqual(
      [
        "actualizado_at",
        "aviso_umbral",
        "casos_periodo",
        "demo",
        "escalamiento",
        "modalidades_activas",
        "nivel_riesgo",
        "periodo_dias",
        "sector",
        "sectores_afectados",
        "sesgo",
        "tendencia",
        "zona",
      ].sort(),
    );
    expect(risk).toMatchObject({ zona: "cieneguilla", sector: null, casos_periodo: "10-19", demo: false });
    expect(risk.nivel_riesgo).not.toBe("sin_datos");
    expect(risk.sesgo).toMatch(/se denuncia más/);
    // Solo el rubro que pasa el umbral por sí solo, en rango; ningún cubo con el resto.
    expect(risk.sectores_afectados).toEqual([{ sector: "mototaxi", casos: "5-9" }]);
    expect(JSON.stringify(risk)).not.toMatch(/Otros rubros|Varios rubros/);
    expect(risk.tendencia.at(-1)!.casos).toBe("5-9");
    expect(risk.tendencia.slice(0, 2).every((t) => t.casos === null)).toBe(true);
    // Ninguna cifra exacta.
    expect(JSON.stringify(risk)).not.toMatch(/"casos(_periodo)?":\d/);

    // El mismo distrito por nombre; una zona que no es distrito, 400.
    expect((await apiJson<PublicRiskOverview>("/v1/public/risk?zona=Cieneguilla")).body.zona).toBe("cieneguilla");
    expect((await api("/v1/public/risk?zona=Lima%20Este")).status).toBe(400);
    expect((await api("/v1/public/risk")).status).toBe(400);
    // Un rubro cuya cifra exacta dejaría un resto chico no se vuelve el alcance.
    const moto = await apiJson<PublicRiskOverview>("/v1/public/risk?zona=cieneguilla&sector=mototaxi");
    expect(moto.body.sector).toBeNull();
    expect(moto.body.aviso_umbral).toMatch(/rubro/);

    // Portal de negocios anterior (cifras exactas): lo que queda fuera de las partes exactas es 0 o pasa el umbral.
    const orgId = await seedOrgRow();
    const email = `negocio-${newId().slice(0, 8)}@prueba.blindaje.test`;
    await env.DB.prepare(
      `INSERT INTO business_accounts (id, org_id, email, password_hash, business_name, sector, zona, disabled, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'Bodega de prueba (ficticia)', 'bodega', 'cieneguilla', 0, 0, ?)`,
    )
      .bind(newId(), orgId, email, await hashPassword("Clave-negocio-ficticia"), nowIso())
      .run();
    const login = await apiJson<{ access_token: string }>("/v1/auth/business/login", { json: { email, password: "Clave-negocio-ficticia" } });
    const legacy = await apiJson<RiskOverview>("/v1/business/risk", { token: login.body.access_token });
    expect(legacy.status).toBe(200);
    const total = legacy.body.casos_periodo!;
    expect(total).toBe(10);
    const restoDe = (partes: Array<{ casos: number | null }>) => total - partes.reduce((n, p) => n + (p.casos ?? 0), 0);
    const restoRubros = restoDe(legacy.body.sectores_afectados);
    const restoSemanas = restoDe(legacy.body.tendencia);
    expect(restoRubros === 0 || restoRubros >= 5, `rubros ${restoRubros}`).toBe(true);
    expect(restoSemanas === 0 || restoSemanas >= 5, `semanas ${restoSemanas}`).toBe(true);
  });

  it("bajo el umbral: sin_datos y ninguna modalidad, aunque haya una alerta aprobada del distrito", async () => {
    await seedDistrict("pachacamac", 4, 3);
    await insertAlert({ zona: "Pachacámac", titulo: "pachacamac", modalidad: "Una modalidad aprobada (ficticio)" });
    const risk = await apiJson<PublicRiskOverview>("/v1/public/risk?zona=pachacamac");
    expect(risk.status).toBe(200);
    expect(risk.body).toMatchObject({ nivel_riesgo: "sin_datos", casos_periodo: null, sectores_afectados: [], modalidades_activas: [], escalamiento: null });
    expect(risk.body.tendencia.every((t) => t.casos === null)).toBe(true);
    expect(risk.body.aviso_umbral).toContain("Aún no hay suficientes casos");
    // La alerta aprobada sigue en su propio endpoint.
    const alerts = await apiJson<{ alerts: Array<{ titulo: string }> }>("/v1/public/alerts?zona=pachacamac");
    expect(alerts.body.alerts.map((a) => a.titulo)).toEqual(["pachacamac"]);
  });
});

describe("alertas y consejos públicos", () => {
  it("solo lo aprobado por el equipo central, del mundo pedido, sin citas internas, números ni datos de organización", async () => {
    const otra = await seedOrgRow();
    await insertAlert({ zona: "Barranco", titulo: "barranco", cuerpo: "Piden pagos al 987 654 321 (FICHA-ABCD, VIN-3). No pagues ni negocies." });
    await insertAlert({ zona: "Barranco", titulo: "barranco borrador", status: "borrador" });
    await insertAlert({ org: otra, zona: "Barranco", titulo: "barranco otra org" });
    await insertAlert({ zona: "Barranco", titulo: "barranco demo", patternKey: "demo:ficticio" });
    await insertAlert({ zona: "Surquillo", titulo: "surquillo" });

    const res = await api("/v1/public/alerts?zona=barranco");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = (await res.json()) as { alerts: Array<Record<string, unknown>>; nota_sesgo: string; demo: boolean };
    expect(body.alerts.map((a) => a.titulo)).toEqual(["barranco"]);
    expect(Object.keys(body.alerts[0]!).sort()).toEqual(["approved_at", "cuerpo", "distrito", "id", "que_hacer", "titulo", "zona"]);
    expect(body.alerts[0]).toMatchObject({ zona: "Barranco", distrito: "barranco" });
    expect(body.nota_sesgo).toMatch(/se denuncia más/);
    expect(body.demo).toBe(false);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/FICHA-|VIN-|ID-|org_id|evidencia|987/);
    expect(text).toContain("[número omitido]");

    const todas = await apiJson<{ alerts: Array<{ titulo: string }> }>("/v1/public/alerts");
    expect(todas.body.alerts.map((a) => a.titulo)).toEqual(expect.arrayContaining(["barranco", "surquillo"]));
    expect(todas.body.alerts.map((a) => a.titulo)).not.toEqual(expect.arrayContaining(["barranco otra org"]));
    const demo = await apiJson<{ alerts: Array<{ titulo: string }>; demo: boolean }>("/v1/public/alerts?zona=Barranco&demo=1");
    expect(demo.body).toMatchObject({ demo: true, alerts: [expect.objectContaining({ titulo: "barranco demo" })] });
    expect((await api("/v1/public/alerts?zona=Lima%20Norte")).status).toBe(400);

    // Consejos del Asesor: aprobados, del equipo central, del distrito y rubro (o de todos los rubros).
    const rec = async (o: { sector: string; org?: string; status?: string; demo?: number; approvedAt: string }) => {
      const id = newId();
      await env.DB.prepare(
        `INSERT INTO business_recommendations (id, org_id, sector, zona, status, content_json, citation_check_json, model, approved_at, is_demo, created_at)
         VALUES (?, ?, ?, 'barranco', ?, ?, ?, 'muse-spark-1.3', ?, ?, ?)`,
      )
        .bind(
          id,
          o.org ?? CENTRAL_ORG_ID,
          o.sector,
          o.status ?? "aprobada",
          JSON.stringify({
            sector: o.sector,
            zona: "Barranco",
            nivel_riesgo: "medio",
            resumen: "Resumen ficticio (FICHA-ABCD).",
            modalidades: [{ descripcion: "Cobros por mensajes", senales_de_alerta: ["habla con el jefe"], evidencia: ["FICHA-ABCD", "VIN-3"] }],
            recomendaciones: [{ titulo: "No pagues ni negocies", detalle: "Guarda la evidencia y denuncia en la Línea 1818.", prioridad: "alta" }],
            que_hacer_si_te_pasa: ["Denuncia en la Línea 1818"],
            advertencias: ["Más casos puede significar que ahí se denuncia más."],
          }),
          JSON.stringify({ ok: true, total_afirmaciones: 0, sin_cita: [], citas_inexistentes: [] }),
          o.approvedAt,
          o.demo ?? 0,
          nowIso(),
        )
        .run();
      return id;
    };
    const bodega = await rec({ sector: "bodega", approvedAt: "2026-10-20T10:00:00.000Z" });
    const todos = await rec({ sector: "todos los rubros", approvedAt: "2026-10-21T10:00:00.000Z" });
    const moto = await rec({ sector: "mototaxi", approvedAt: "2026-10-22T10:00:00.000Z" });
    await rec({ sector: "bodega", status: "borrador", approvedAt: "2026-10-23T10:00:00.000Z" });
    await rec({ sector: "bodega", org: otra, approvedAt: "2026-10-24T10:00:00.000Z" });
    const demoRec = await rec({ sector: "bodega", demo: 1, approvedAt: "2026-10-25T10:00:00.000Z" });

    const recs = await apiJson<{ recommendations: Array<{ id: string; distrito: string }>; nota_sesgo: string; demo: boolean }>(
      "/v1/public/recommendations?zona=barranco&sector=bodega",
    );
    expect(recs.status).toBe(200);
    expect(recs.body.recommendations.map((r) => r.id)).toEqual([bodega, todos]);
    expect(recs.body.recommendations[0]!.distrito).toBe("barranco");
    expect(recs.body.nota_sesgo).toMatch(/se denuncia más/);
    expect(JSON.stringify(recs.body)).not.toMatch(/FICHA-|VIN-|org_id|"evidencia"/);
    const sinRubro = await apiJson<{ recommendations: Array<{ id: string }> }>("/v1/public/recommendations?zona=barranco");
    expect(sinRubro.body.recommendations.map((r) => r.id).sort()).toEqual([bodega, todos, moto].sort());
    const recsDemo = await apiJson<{ recommendations: Array<{ id: string }> }>("/v1/public/recommendations?zona=barranco&demo=1");
    expect(recsDemo.body.recommendations.map((r) => r.id)).toEqual([demoRec]);
    expect((await api("/v1/public/recommendations?zona=barranco&sector=narcotrafico")).status).toBe(400);
  });

  it("se limitan por IP", async () => {
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await api("/v1/public/alerts?zona=lince", { ip })).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    const limited = await api("/v1/public/zones", { ip });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    // Otra IP sigue entrando.
    expect((await api("/v1/public/zones")).status).toBe(200);
  });
});

describe("vista de zonas de la consola", () => {
  it("cifras exactas por distrito con el periodo anterior, víctimas, redes y modalidades; bajo el umbral, sin detalle", async () => {
    const mag = await seedDistrict("magdalena-del-mar", 6, 3);
    await seedDistrict("magdalena-del-mar", 2, 2, { days: (i) => 35 + i * 5 });
    const lince = await seedDistrict("lince", 3, 2);
    await seedDistrict("Zona Inventada Consola", 2, 1);
    await seedDistrict("magdalena-del-mar", 1, 1, { demo: true });
    await insertLink(mag[0]!.id, mag[1]!.id, "confirmado", 0.95);
    await insertLink(lince[0]!.id, lince[1]!.id, "confirmado", 0.95);
    await recomputeNetworks(env);
    const netMag = (await env.DB.prepare("SELECT n.num FROM networks n JOIN network_cases nc ON nc.network_id = n.id WHERE nc.case_id = ?").bind(mag[0]!.id).first<{ num: number }>())!.num;

    const analyst = await loginAs("analyst", await seedOrgRow());
    const res = await apiJson<ConsoleZones>("/v1/console/zones", { token: analyst.token });
    expect(res.status).toBe(200);
    expect(res.body.periodo_dias).toBe(28);
    expect(res.body.filas).toHaveLength(50);
    expect(res.body.sin_distrito).toBeGreaterThanOrEqual(2);
    const fila = (id: string, b = res.body) => b.filas.find((f) => f.distrito === id)!;
    const m = fila("magdalena-del-mar");
    expect(m).toMatchObject({ casos: 6, victimas: 3, casos_previos: 2, sobre_umbral: true });
    expect(m.redes).toEqual([`R-${String(netMag).padStart(3, "0")}`]);
    expect((await api("/v1/console/zones?dias=14", { token: analyst.token })).status).toBe(200);
    expect((await api("/v1/console/zones?dias=90", { token: analyst.token })).status).toBe(200);
    expect(m.modalidades.length).toBeGreaterThan(0);
    // Bajo el umbral: las cifras, pero ni redes ni modalidades.
    expect(fila("lince")).toEqual({ distrito: "lince", casos: 3, victimas: 2, casos_previos: 0, redes: [], modalidades: [], sobre_umbral: false });

    const largo = await apiJson<ConsoleZones>("/v1/console/zones?dias=60", { token: analyst.token });
    expect(largo.body.periodo_dias).toBe(60);
    expect(fila("magdalena-del-mar", largo.body).casos).toBe(8);
    expect((await api("/v1/console/zones?dias=3", { token: analyst.token })).status).toBe(400);

    // Mundo: las cuentas reales ven casos reales; ?demo=1 (solo con DEMO_MODE=true) los del demo.
    const demo = await apiJson<ConsoleZones>("/v1/console/zones?demo=1", { token: analyst.token });
    expect(fila("magdalena-del-mar", demo.body)).toMatchObject({ casos: 1, sobre_umbral: false, redes: [] });
    const reviewer = await loginAs("reviewer", await seedOrgRow());
    expect((await api("/v1/console/zones", { token: reviewer.token })).status).toBe(200);
    const victim = await registerDevice();
    expect((await api("/v1/console/zones", { token: victim.access_token })).status).toBe(403);
  });
});
