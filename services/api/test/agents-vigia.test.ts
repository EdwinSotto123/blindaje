import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { AlertView } from "@blindaje/shared";
import { detectPatterns, sanitizeAlert } from "../src/agents/vigia";
import { api, apiJson, loginAs, registerDevice, seedOrg } from "./helpers";
import { daysAgo, fakeMeta, final, PNG_BYTES, restoreMeta, seedCase, seedDevice, seedOrgRow, type RecordedRequest } from "./agents-helpers";

afterEach(() => restoreMeta());

/** Borrador que devuelve el modelo simulado: con un número completo y una cita dentro del cuerpo. */
function draftFrom(req: RecordedRequest) {
  const input = String(req.body.input);
  const fichas = [...new Set(input.match(/FICHA-[A-Z0-9]+/g) ?? [])];
  return {
    titulo: "Alerta para asociados: cobros por Yape a nombre de un grupo",
    cuerpo: `En las últimas dos semanas varios comerciantes recibieron mensajes de un grupo que pide pagos por Yape al 987 654 321 (${fichas[0]}). No negocies solo.`,
    zona: "Lima Este - E12",
    modalidad: "Cobro de cupos por Yape con plazo de 48 horas",
    que_hacer: ["Guarda los audios y mensajes en Blindaje", "No negocies solo"],
    evidencia: fichas,
  };
}

async function seedPattern(opts: { zona: string; n: number; victims: number; orgs?: string[]; grupo?: string; spanDays?: number }) {
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
  return { orgs, devices, cases };
}

describe("Vigía: detección de patrones", () => {
  it("no dispara con 4 casos (ni con 5 casos de 2 víctimas) y sí con 5 casos de 3 víctimas", async () => {
    await seedPattern({ zona: "Zona Ficticia Norte - N1", n: 4, victims: 3 });
    await seedPattern({ zona: "Zona Ficticia Sur - S1", n: 5, victims: 2 });
    let patterns = await detectPatterns(env);
    expect(patterns.filter((p) => p.zona.startsWith("Zona Ficticia"))).toEqual([]);

    const meta = fakeMeta([]);
    const analyst = await loginAs("analyst", await seedOrgRow());
    const none = await apiJson<{ alerts: AlertView[] }>("/v1/console/vigia/run", { method: "POST", token: analyst.token });
    expect(none.status).toBe(200);
    expect(none.body.alerts).toEqual([]);
    expect(meta.requests).toHaveLength(0);

    // Un quinto caso de una tercera víctima en la zona sur: ahora sí.
    const org = (await env.DB.prepare("SELECT org_id FROM cases WHERE zona_cuadricula = 'Zona Ficticia Sur - S1' LIMIT 1").first<{ org_id: string }>())!.org_id;
    const third = await seedDevice(org);
    await seedCase({ orgId: org, device: third, zona: "Zona Ficticia Sur - S1", grupo: "Los Ficticios del Cerro", canal: "otro", primer_contacto: daysAgo(3) });
    patterns = await detectPatterns(env);
    const sur = patterns.filter((p) => p.zona === "Zona Ficticia Sur - S1");
    expect(sur).toHaveLength(1);
    expect(sur[0]!.cases).toHaveLength(6);
    expect(sur[0]!.n_victims).toBe(3);
    expect(sur[0]!.primary.kind).toBe("grupo");
    expect(patterns.some((p) => p.zona === "Zona Ficticia Norte - N1")).toBe(false);
  });

  it("los casos fuera de la ventana de 14 días o sin consentimiento comunitario no cuentan", async () => {
    const org = await seedOrgRow();
    const devs = [await seedDevice(org), await seedDevice(org), await seedDevice(org)];
    for (let i = 0; i < 3; i++) await seedCase({ orgId: org, device: devs[i]!, zona: "Zona Ventana", grupo: "Los Lejanos", canal: "otro", primer_contacto: daysAgo(2 + i) });
    // Dos casos más del mismo patrón, pero 20 días antes: no caben en la misma ventana.
    for (let i = 0; i < 2; i++) await seedCase({ orgId: org, device: devs[i]!, zona: "Zona Ventana", grupo: "Los Lejanos", canal: "otro", primer_contacto: daysAgo(25 + i) });
    // Y dos dentro de la ventana pero sin consentimiento comunitario.
    for (let i = 0; i < 2; i++) {
      await seedCase({ orgId: org, device: devs[i]!, zona: "Zona Ventana", grupo: "Los Lejanos", canal: "otro", primer_contacto: daysAgo(4), consent: "solo_denuncia" });
    }
    const patterns = await detectPatterns(env);
    expect(patterns.some((p) => p.zona === "Zona Ventana")).toBe(false);
  });

  it("forma del seed del demo: agrupa por zona exacta y reúne Los X + Yape en Lima Este", async () => {
    const org = await seedOrgRow("Asociación ficticia del demo");
    const mk = async (o: { zona: string; dia: number; grupo: string | null; frases: string[] }) =>
      seedCase({ orgId: org, device: await seedDevice(org), zona: o.zona, grupo: o.grupo, canal: "yape", frases: o.frases, primer_contacto: daysAgo(o.dia) });
    const A = await mk({ zona: "Lima Este", dia: 13, grupo: "Los X", frases: ["ya sabes lo que pasa"] });
    const D = await mk({ zona: "Lima Este", dia: 11, grupo: "Los X", frases: ["aquí todos pagan su colaboración", "habla con el jefe"] });
    const E = await mk({ zona: "Lima Este", dia: 9, grupo: "Los X", frases: ["no llames a la policía", "habla con el jefe"] });
    const B = await mk({ zona: "Lima Norte", dia: 8, grupo: null, frases: ["habla con el jefe"] });
    const F = await mk({ zona: "Lima Este", dia: 6, grupo: "Los X", frases: ["habla con el jefe si quieres arreglar"] });
    const C = await mk({ zona: "Lima Este", dia: 5, grupo: null, frases: ["tienes hasta el viernes"] });
    const G = await mk({ zona: "Lima Este", dia: 3, grupo: "Los X", frases: ["habla con el jefe"] });
    // Una zona parecida pero distinta no se mezcla.
    await mk({ zona: "Lima Este - E12", dia: 4, grupo: "Los X", frases: ["habla con el jefe"] });

    const patterns = (await detectPatterns(env)).filter((p) => p.zona.startsWith("Lima"));
    expect(patterns).toHaveLength(1);
    const p = patterns[0]!;
    expect(p.zona).toBe("Lima Este");
    expect(p.primary).toMatchObject({ kind: "grupo", key: "los x" });
    expect(p.features.map((f) => f.kind).sort()).toEqual(["canal", "grupo"]);
    const ids = p.cases.map((c) => c.id).sort();
    expect(ids).toEqual([A, C, D, E, F, G].map((c) => c.id).sort());
    expect(ids).not.toContain(B.id);
    expect(p.n_victims).toBe(6);
  });
});

describe("Vigía: borradores, aprobación y aislamiento", () => {
  it("redacta un borrador por organización, sin números completos, con tarjeta, y solo la víctima de esa organización lo ve aprobado", async () => {
    const orgA = await seedOrg({ invites: 2 });
    const orgB = await seedOrg({ invites: 2 });
    await env.DB.prepare("UPDATE organizations SET name = 'Gremio ficticio A' WHERE id = ?").bind(orgA.orgId).run();
    const { cases } = await seedPattern({ zona: "Zona Alerta - A1", n: 5, victims: 3, orgs: [orgA.orgId, orgB.orgId], grupo: "Los Inventados" });
    // Otros patrones de este archivo también pueden disparar: el modelo simulado responde a todos.
    const meta = fakeMeta([], (req) => [final(draftFrom(req))]);
    const analyst = await loginAs("analyst", orgA.orgId);
    const run = await apiJson<{ alerts: AlertView[] }>("/v1/console/vigia/run", { method: "POST", token: analyst.token, json: { image: true } });
    expect(run.status).toBe(200);
    const alerts = run.body.alerts.filter((a) => a.borrador.zona === "Zona Alerta");
    expect(alerts.map((a) => a.org_id).sort()).toEqual([orgA.orgId, orgB.orgId].sort());
    expect(alerts.find((a) => a.org_id === orgA.orgId)!.org_name).toBe("Gremio ficticio A");
    const mine = meta.responses().filter((r) => String(r.body.input).includes("Zona Alerta"));
    expect(mine).toHaveLength(1);
    // La petición al modelo no lleva seudónimos ni identificadores de dispositivo.
    const sent = JSON.stringify(mine[0]!.body);
    for (const c of cases) {
      const row = await env.DB.prepare("SELECT device_id, seudonimo_victima FROM cases WHERE id = ?").bind(c.id).first<{ device_id: string; seudonimo_victima: string }>();
      expect(sent).not.toContain(row!.device_id);
      expect(sent).not.toContain(row!.seudonimo_victima);
    }

    for (const a of alerts) {
      expect(a.status).toBe("borrador");
      const text = `${a.borrador.titulo} ${a.borrador.cuerpo} ${a.borrador.que_hacer.join(" ")}`;
      expect(text).not.toMatch(/\d(?:[\s.-]?\d){6,}/);
      expect(text).not.toMatch(/FICHA-/);
      expect(text).toContain("1818");
      expect(text).toMatch(/\b105\b/);
      expect(a.borrador.zona).toBe("Zona Alerta");
      expect(a.borrador.evidencia.length).toBeGreaterThanOrEqual(5);
      expect(a.image_url).toBe(`/v1/console/alerts/${a.id}/image`);
    }
    // Una tarjeta por patrón (compartida por las alertas de cada organización).
    const images = meta.requests.filter((r) => r.url.endsWith("/images/generations")).length;
    expect(images).toBe(meta.responses().length);
    // Segunda corrida: el patrón ya tiene alerta (deduplicación por pattern_key): no llama al modelo.
    const calls = meta.requests.length;
    const run2 = await apiJson<{ alerts: AlertView[] }>("/v1/console/vigia/run", { method: "POST", token: analyst.token, json: { image: false } });
    expect(run2.body.alerts).toEqual([]);
    expect(meta.requests.length).toBe(calls);

    const alertA = alerts.find((a) => a.org_id === orgA.orgId)!;
    const reviewerA = await loginAs("reviewer", orgA.orgId);
    const reviewerB = await loginAs("reviewer", orgB.orgId);
    const img = await api(`/v1/console/alerts/${alertA.id}/image`, { token: reviewerA.token });
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG_BYTES);

    const victimA = await registerDevice(orgA.invite);
    const victimB = await registerDevice(orgB.invite);
    const before = await apiJson<{ alerts: unknown[] }>("/v1/alerts", { token: victimA.access_token });
    expect(before.body.alerts).toEqual([]);

    // La revisora de otra organización no la ve; la de su organización la aprueba.
    expect((await api(`/v1/console/alerts/${alertA.id}/decision`, { token: reviewerB.token, json: { decision: "aprobar" } })).status).toBe(404);
    const approved = await apiJson<AlertView>(`/v1/console/alerts/${alertA.id}/decision`, { token: reviewerA.token, json: { decision: "aprobar" } });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("aprobada");

    const seenA = await apiJson<{ alerts: Array<{ id: string; cuerpo: string }> }>("/v1/alerts", { token: victimA.access_token });
    expect(seenA.body.alerts.map((a) => a.id)).toEqual([alertA.id]);
    const seenB = await apiJson<{ alerts: unknown[] }>("/v1/alerts", { token: victimB.access_token });
    expect(seenB.body.alerts).toEqual([]);
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
