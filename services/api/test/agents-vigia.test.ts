import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { CENTRAL_ORG_ID, type AlertView } from "@blindaje/shared";
import { detectPatterns, sanitizeAlert } from "../src/agents/vigia";
import { api, apiJson, createCase, loginAs, registerDevice, seedOrg } from "./helpers";
import { daysAgo, fakeMeta, final, PNG_BYTES, restoreMeta, seedCase, seedDevice, seedOrgRow, type RecordedRequest } from "./agents-helpers";

afterEach(() => restoreMeta());

/** Borrador que devuelve el modelo simulado: con un número completo y una cita dentro del cuerpo. */
function draftFrom(req: RecordedRequest) {
  const input = String(req.body.input);
  const fichas = [...new Set(input.match(/FICHA-[A-Z0-9]+/g) ?? [])];
  return {
    titulo: "Alerta para tu zona: cobros por Yape a nombre de un grupo",
    cuerpo: `En las últimas dos semanas varios comerciantes recibieron mensajes de un grupo que pide pagos por Yape al 987 654 321 (${fichas[0]}). No pagues ni negocies.`,
    zona: "Lima Este - E12",
    modalidad: "Cobro de cupos por Yape con plazo de 48 horas",
    que_hacer: ["Guarda los audios y mensajes en Blindaje", "No pagues ni negocies"],
    evidencia: fichas,
  };
}

async function seedPattern(opts: { zona: string; n: number; victims: number; orgs?: string[]; grupo?: string; spanDays?: number; demo?: boolean }) {
  const orgs = opts.orgs ?? [await seedOrgRow()];
  const devices = [];
  for (let i = 0; i < opts.victims; i++) devices.push(await seedDevice(orgs[i % orgs.length]!));
  const cases = [];
  for (let i = 0; i < opts.n; i++) {
    const device = devices[i % devices.length]!;
    const orgId = (await env.DB.prepare("SELECT org_id FROM devices WHERE id = ?").bind(device.id).first<{ org_id: string }>())!.org_id;
    cases.push(
      await seedCase({
        orgId,
        device,
        zona: opts.zona,
        grupo: opts.grupo ?? "Los Ficticios del Cerro",
        canal: "otro",
        frases: [`frase única ${opts.zona} ${i}`],
        primer_contacto: daysAgo(2 + Math.round(((opts.spanDays ?? 10) * i) / Math.max(1, opts.n - 1))),
      }),
    );
  }
  if (opts.demo) {
    for (const c of cases) await env.DB.prepare("UPDATE cases SET is_demo = 1 WHERE id = ?").bind(c.id).run();
  }
  return { orgs, devices, cases };
}

describe("Vigía: detección de patrones", () => {
  it("no dispara con 4 casos (ni con 5 casos de 2 víctimas) y sí con 5 casos de 3 víctimas", async () => {
    await seedPattern({ zona: "ancon", n: 4, victims: 3 });
    await seedPattern({ zona: "Santa Rosa - S1", n: 5, victims: 2 });
    let patterns = await detectPatterns(env);
    expect(patterns.filter((p) => ["ancon", "santa-rosa"].includes(p.zona))).toEqual([]);

    const meta = fakeMeta([]);
    const analyst = await loginAs("analyst", await seedOrgRow());
    const none = await apiJson<{ alerts: AlertView[] }>("/v1/console/vigia/run", { method: "POST", token: analyst.token });
    expect(none.status).toBe(200);
    expect(none.body.alerts).toEqual([]);
    expect(meta.requests).toHaveLength(0);

    // Un quinto caso de una tercera víctima en Santa Rosa: ahora sí (la celda se normaliza al distrito).
    const org = (await env.DB.prepare("SELECT org_id FROM cases WHERE zona_cuadricula = 'Santa Rosa - S1' LIMIT 1").first<{ org_id: string }>())!.org_id;
    const third = await seedDevice(org);
    await seedCase({ orgId: org, device: third, zona: "santa-rosa", grupo: "Los Ficticios del Cerro", canal: "otro", primer_contacto: daysAgo(3) });
    patterns = await detectPatterns(env);
    const sur = patterns.filter((p) => p.zona === "santa-rosa");
    expect(sur).toHaveLength(1);
    expect(sur[0]!.cases).toHaveLength(6);
    expect(sur[0]!.n_victims).toBe(3);
    expect(sur[0]!.primary.kind).toBe("grupo");
    expect(sur[0]!.is_demo).toBe(false);
    expect(patterns.some((p) => p.zona === "ancon")).toBe(false);
  });

  it("los casos fuera de la ventana de 14 días, sin consentimiento comunitario o sin distrito no cuentan", async () => {
    const org = await seedOrgRow();
    const devs = [await seedDevice(org), await seedDevice(org), await seedDevice(org)];
    for (let i = 0; i < 3; i++) await seedCase({ orgId: org, device: devs[i]!, zona: "chaclacayo", grupo: "Los Lejanos", canal: "otro", primer_contacto: daysAgo(2 + i) });
    // Dos casos más del mismo patrón, pero 20 días antes: no caben en la misma ventana.
    for (let i = 0; i < 2; i++) await seedCase({ orgId: org, device: devs[i]!, zona: "chaclacayo", grupo: "Los Lejanos", canal: "otro", primer_contacto: daysAgo(25 + i) });
    // Y dos dentro de la ventana pero sin consentimiento comunitario.
    for (let i = 0; i < 2; i++) {
      await seedCase({ orgId: org, device: devs[i]!, zona: "chaclacayo", grupo: "Los Lejanos", canal: "otro", primer_contacto: daysAgo(4), consent: "solo_denuncia" });
    }
    // Y cinco en una zona que no es un distrito (un área de una app antigua).
    for (let i = 0; i < 5; i++) await seedCase({ orgId: org, device: devs[i % 3]!, zona: "Lima Este", grupo: "Los Lejanos", canal: "otro", primer_contacto: daysAgo(3) });
    const patterns = await detectPatterns(env);
    expect(patterns.some((p) => p.zona === "chaclacayo")).toBe(false);
    expect(patterns.some((p) => p.cases.some((c) => c.zona === "Lima Este"))).toBe(false);
  });

  it("forma del seed del demo: agrupa por distrito (con sus celdas) y reúne Los X + Yape en San Juan de Lurigancho", async () => {
    const org = await seedOrgRow("Asociación ficticia del demo");
    const mk = async (o: { zona: string; dia: number; grupo: string | null; frases: string[] }) =>
      seedCase({ orgId: org, device: await seedDevice(org), zona: o.zona, grupo: o.grupo, canal: "yape", frases: o.frases, primer_contacto: daysAgo(o.dia) });
    const A = await mk({ zona: "san-juan-de-lurigancho", dia: 13, grupo: "Los X", frases: ["ya sabes lo que pasa"] });
    const D = await mk({ zona: "san-juan-de-lurigancho", dia: 11, grupo: "Los X", frases: ["aquí todos pagan su colaboración", "habla con el jefe"] });
    const E = await mk({ zona: "san-juan-de-lurigancho", dia: 9, grupo: "Los X", frases: ["no llames a la policía", "habla con el jefe"] });
    const B = await mk({ zona: "comas", dia: 8, grupo: null, frases: ["habla con el jefe"] });
    const F = await mk({ zona: "san-juan-de-lurigancho", dia: 6, grupo: "Los X", frases: ["habla con el jefe si quieres arreglar"] });
    const C = await mk({ zona: "san-juan-de-lurigancho", dia: 5, grupo: null, frases: ["tienes hasta el viernes"] });
    const G = await mk({ zona: "san-juan-de-lurigancho", dia: 3, grupo: "Los X", frases: ["habla con el jefe"] });
    // Una celda del mismo distrito es el mismo distrito; un área ("Lima Este") no es un distrito.
    const E12 = await mk({ zona: "San Juan de Lurigancho - E12", dia: 4, grupo: "Los X", frases: ["habla con el jefe"] });
    await mk({ zona: "Lima Este", dia: 4, grupo: "Los X", frases: ["habla con el jefe"] });

    const patterns = (await detectPatterns(env)).filter((p) => ["san-juan-de-lurigancho", "comas"].includes(p.zona));
    expect(patterns).toHaveLength(1);
    const p = patterns[0]!;
    expect(p.zona).toBe("san-juan-de-lurigancho");
    expect(p.primary).toMatchObject({ kind: "grupo", key: "los x" });
    expect(p.features.map((f) => f.kind).sort()).toEqual(["canal", "grupo"]);
    const ids = p.cases.map((c) => c.id).sort();
    expect(ids).toEqual([A, C, D, E, F, G, E12].map((c) => c.id).sort());
    expect(ids).not.toContain(B.id);
    expect(p.n_victims).toBe(7);
  });

  it("los casos del demo forman sus propios patrones (pattern_key con prefijo demo:) y nunca se mezclan con los reales", async () => {
    await seedPattern({ zona: "lurin", n: 3, victims: 3, grupo: "Los Mezclados" });
    await seedPattern({ zona: "lurin", n: 3, victims: 3, grupo: "Los Mezclados", demo: true });
    expect((await detectPatterns(env)).filter((p) => p.zona === "lurin")).toEqual([]);

    await seedPattern({ zona: "lurin", n: 2, victims: 2, grupo: "Los Mezclados", demo: true });
    const lurin = (await detectPatterns(env)).filter((p) => p.zona === "lurin");
    expect(lurin).toHaveLength(1);
    expect(lurin[0]!.is_demo).toBe(true);
    expect(lurin[0]!.pattern_key).toMatch(/^demo:[0-9a-f]{32}$/);
    expect(lurin[0]!.cases).toHaveLength(5);
  });
});

describe("Vigía: borradores, aprobación y aislamiento", () => {
  it("redacta una alerta por patrón y distrito en la organización central, sin números completos y con tarjeta; la ve la víctima de ese distrito", async () => {
    const orgA = await seedOrg({ invites: 2 });
    const orgB = await seedOrg({ invites: 2 });
    const { cases } = await seedPattern({ zona: "mi-peru", n: 5, victims: 3, orgs: [orgA.orgId, orgB.orgId], grupo: "Los Inventados" });
    // Otros patrones de este archivo también pueden disparar: el modelo simulado responde a todos.
    const meta = fakeMeta([], (req) => [final(draftFrom(req))]);
    const analyst = await loginAs("analyst", orgA.orgId);
    const run = await apiJson<{ alerts: AlertView[] }>("/v1/console/vigia/run", { method: "POST", token: analyst.token, json: { image: true } });
    expect(run.status).toBe(200);
    // Una sola alerta, aunque los casos lleguen por dos organizaciones.
    const alerts = run.body.alerts.filter((a) => a.distrito === "mi-peru");
    expect(alerts).toHaveLength(1);
    const alert = alerts[0]!;
    expect(alert).toMatchObject({ org_id: CENTRAL_ORG_ID, org_name: "Equipo Blindaje", status: "borrador" });
    expect(alert.borrador.zona).toBe("Mi Perú");
    const mine = meta.responses().filter((r) => String(r.body.input).includes("Mi Perú"));
    expect(mine).toHaveLength(1);
    expect(String(mine[0]!.body.input)).not.toMatch(/gremio|asociados/i);
    // La petición al modelo no lleva seudónimos ni identificadores de dispositivo.
    const sent = JSON.stringify(mine[0]!.body);
    for (const c of cases) {
      const row = await env.DB.prepare("SELECT device_id, seudonimo_victima FROM cases WHERE id = ?").bind(c.id).first<{ device_id: string; seudonimo_victima: string }>();
      expect(sent).not.toContain(row!.device_id);
      expect(sent).not.toContain(row!.seudonimo_victima);
    }

    const text = `${alert.borrador.titulo} ${alert.borrador.cuerpo} ${alert.borrador.que_hacer.join(" ")}`;
    expect(text).not.toMatch(/\d(?:[\s.-]?\d){6,}/);
    expect(text).not.toMatch(/FICHA-/);
    expect(text).toContain("1818");
    expect(text).toMatch(/\b105\b/);
    expect(alert.borrador.evidencia.length).toBeGreaterThanOrEqual(5);
    expect(alert.image_url).toBe(`/v1/console/alerts/${alert.id}/image`);
    // Una tarjeta por patrón.
    const images = meta.requests.filter((r) => r.url.endsWith("/images/generations")).length;
    expect(images).toBe(meta.responses().length);
    // Segunda corrida: el patrón ya tiene alerta en el distrito (deduplicación por pattern_key): no llama al modelo.
    const calls = meta.requests.length;
    const run2 = await apiJson<{ alerts: AlertView[] }>("/v1/console/vigia/run", { method: "POST", token: analyst.token, json: { image: false } });
    expect(run2.body.alerts).toEqual([]);
    expect(meta.requests.length).toBe(calls);

    // Cualquier persona del equipo central la revisa: una revisora que llegó por otra organización.
    const reviewerB = await loginAs("reviewer", orgB.orgId);
    const img = await api(`/v1/console/alerts/${alert.id}/image`, { token: reviewerB.token });
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG_BYTES);

    const victimMiPeru = await registerDevice(orgA.invite);
    await createCase(victimMiPeru.access_token, "solo_denuncia", { zona: "mi-peru" });
    const victimOtra = await registerDevice();
    await createCase(victimOtra.access_token, "solo_denuncia", { zona: "ancon" });
    const before = await apiJson<{ alerts: unknown[] }>("/v1/alerts", { token: victimMiPeru.access_token });
    expect(before.body.alerts).toEqual([]);

    const approved = await apiJson<AlertView>(`/v1/console/alerts/${alert.id}/decision`, { token: reviewerB.token, json: { decision: "aprobar" } });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("aprobada");

    const seen = await apiJson<{ alerts: Array<{ id: string; zona: string; distrito: string }> }>("/v1/alerts", { token: victimMiPeru.access_token });
    expect(seen.body.alerts.map((a) => a.id)).toEqual([alert.id]);
    expect(seen.body.alerts[0]).toMatchObject({ zona: "Mi Perú", distrito: "mi-peru" });
    expect((await apiJson<{ alerts: unknown[] }>("/v1/alerts", { token: victimOtra.access_token })).body.alerts).toEqual([]);
    // La app puede pedir el distrito elegido en el celular.
    const elegido = await apiJson<{ alerts: Array<{ id: string }> }>("/v1/alerts?zona=mi-peru", { token: victimOtra.access_token });
    expect(elegido.body.alerts.map((a) => a.id)).toEqual([alert.id]);
    // Y está en el portal público del distrito.
    const pub = await apiJson<{ alerts: Array<{ id: string }> }>("/v1/public/alerts?zona=mi-peru");
    expect(pub.body.alerts.map((a) => a.id)).toEqual([alert.id]);
  });

  it("la limpieza del borrador quita números completos, citas y fechas exactas", () => {
    const out = sanitizeAlert(
      {
        titulo: "Cobros al +51 900 000 202",
        cuerpo: "Desde el 2026-10-12 piden pagar a la cuenta 1234 5678 9012 (FICHA-A, VIN-3). Llama al 105.",
        zona: "x",
        modalidad: "Yape",
        que_hacer: ["Denuncia en la Línea 1818"],
        evidencia: ["EV-Z9"],
      },
      "Lima Este - E12",
      ["FICHA-A"],
    );
    expect(out.titulo).toBe("Cobros al [número omitido]");
    expect(out.cuerpo).toBe("Desde el 12 de octubre piden pagar a la cuenta [número omitido]. Llama al 105.");
    expect(out.zona).toBe("Lima Este");
    expect(out.evidencia).toEqual(["FICHA-A"]);
    const d = sanitizeAlert({ titulo: "t", cuerpo: "c", zona: "x", modalidad: "m", que_hacer: [], evidencia: [] }, "san-juan-de-lurigancho", []);
    expect(d.zona).toBe("San Juan de Lurigancho");
  });
});

describe("redacción de números largos", () => {
  it("tapa teléfonos y cuentas pero respeta las fechas ISO", async () => {
    const { redactLongNumbers } = await import("../src/agents/tools/safety");
    expect(redactLongNumbers("El 2026-10-12T10:00:00-05:00 llamó el +51 987 654 321; cuenta 1234-5678-9012")).toBe(
      "El 2026-10-12T10:00:00-05:00 llamó el [número omitido]; cuenta [número omitido]",
    );
    expect(redactLongNumbers("2026-10-12 987654321")).toBe("2026-10-12 [número omitido]");
    expect(redactLongNumbers("S/ 2,000 en 48 horas")).toBe("S/ 2,000 en 48 horas");
  });
});
