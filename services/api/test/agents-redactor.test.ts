import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { Expediente, PerfilRed } from "@blindaje/shared";
import { audit } from "../src/audit";
import { sha256Hex } from "../src/lib/crypto";
import { newId, nowIso } from "../src/lib/ids";
import { setMlClientForTests, type MlClient } from "../src/ml/client";
import { api, apiJson, loginAs } from "./helpers";
import { call, fakeMeta, final, restoreMeta, seedNetwork, toolOutputs, type SeededNetwork } from "./agents-helpers";

afterEach(() => {
  restoreMeta();
  setMlClientForTests(null);
});

const FAKE_PDF = new TextEncoder().encode("%PDF-1.7\n% expediente ficticio de prueba\n%%EOF\n");

function fakeMl() {
  const rendered: Array<{ template: string; data: Record<string, unknown> }> = [];
  setMlClientForTests({
    kind: "http",
    raw: async () => {
      throw new Error("sin ML");
    },
    pdfRender: async (template: string, data: unknown) => {
      rendered.push({ template, data: data as Record<string, unknown> });
      return FAKE_PDF.slice().buffer;
    },
  } as unknown as MlClient);
  return rendered;
}

/** Perfil aprobado, una hipótesis aprobada y otra en borrador (que no debe aparecer). */
async function approveProfile(net: SeededNetwork, analystId: string) {
  const profileId = newId();
  const perfil: PerfilRed = {
    red: net.label,
    casos: net.cases.length,
    periodo: null,
    sectores: [{ sector: "bodega", casos: 2 }],
    territorio: [],
    modus_operandi: "Audios y cobro por Yape (ficticio)",
    hechos: [{ texto: `La cuenta ${net.identifier} aparece en 2 casos`, evidencia: [net.identifier] }],
    hipotesis: [],
    escalamiento: null,
    brechas: [],
    recomendaciones_autoridad: ["Pedir por vía fiscal la información de la cuenta compartida"],
  };
  await env.DB.prepare(
    `INSERT INTO network_profiles (id, network_id, profile_json, citation_check_json, status, model, reviewer_id, reviewed_at, created_at)
     VALUES (?, ?, ?, '{"ok":true}', 'aprobado', 'muse-spark-1.3', ?, ?, ?)`,
  )
    .bind(profileId, net.networkId, JSON.stringify(perfil), analystId, nowIso(), nowIso())
    .run();
  const approved = { id: newId(), num: 9001, texto: `${net.identifier} funciona como cuenta recaudadora`, evidencia: [net.identifier] };
  const draft = { id: newId(), num: 9002, texto: "Hipótesis en borrador que no debe salir", evidencia: [net.identifier] };
  for (const [h, status] of [
    [approved, "aprobada"],
    [draft, "borrador"],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO hypotheses (id, num, profile_id, network_id, texto, confianza, evidence_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'media', ?, ?, ?)`,
    )
      .bind(h.id, h.num, profileId, net.networkId, h.texto, JSON.stringify(h.evidencia), status, nowIso())
      .run();
  }
  return { profileId, approved, draft };
}

function expediente(net: SeededNetwork, over: Partial<Expediente> = {}): Expediente {
  const [a, b] = net.cases;
  return {
    red: "R-999",
    resumen: `Red de ${net.cases.length} casos vinculados por voz y una cuenta de cobro compartida (${net.identifier}, VIN-${net.links[0]!.num}).`,
    cronologia: [{ fecha: "2026-10-08", texto: `Primer contacto del caso ${a!.code}`, evidencia: [`FICHA-${a!.code}`] }],
    vinculos: [{ vinculo: `VIN-${net.links[0]!.num}`, texto: `Los casos ${a!.code} y ${b!.code} comparten la cuenta ${net.identifier}`, evidencia: [net.identifier, `VIN-${net.links[0]!.num}`] }],
    hechos: [{ texto: `La cuenta ${net.identifier} aparece en los casos ${a!.code} y ${b!.code}`, evidencia: [net.identifier] }],
    hipotesis: [{ texto: "Una hipótesis que nadie aprobó", confianza: "alta", evidencia: [net.identifier] }],
    brechas: ["Faltan los audios originales de un caso"],
    ...over,
  };
}

describe("Redactor de expedientes", () => {
  it("genera el expediente con SHA-256, evidencia, cadena de custodia y solo hipótesis aprobadas", async () => {
    const net = await seedNetwork({ n: 3 });
    const analyst = await loginAs("analyst", net.orgId);
    const { approved, draft } = await approveProfile(net, analyst.id);
    // Entradas de custodia de la evidencia (lo que escribe la subida real).
    for (const c of net.cases) {
      for (const e of c.evidence) {
        await audit(env, { actor_type: "victim", actor_id: "V-PRB1", action: "evidence.upload", target_type: "evidence", target_id: e.id, details: { label: e.label, sha256: e.sha256 } });
      }
    }
    const rendered = fakeMl();
    const meta = fakeMeta([
      () => [
        call("obtener_red", { red_id: net.label }),
        call("obtener_perfil_aprobado", { red_id: net.label }),
        call("hipotesis_aprobadas", { red_id: net.label }),
        call("linea_de_tiempo", { red_id: net.label }),
        call("vinculos_confirmados", { red_id: net.label }),
      ],
      () => [final(expediente(net))],
    ]);

    const res = await apiJson<{ id: string; status: string; sha256: string; download_url: string }>(`/v1/console/networks/${net.networkId}/expediente`, {
      token: analyst.token,
      method: "POST",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("listo");
    expect(res.body.sha256).toBe(await sha256Hex(FAKE_PDF));
    expect(res.body.download_url).toBe(`/v1/console/expedientes/${res.body.id}/pdf`);

    // Las herramientas del Redactor: solo la hipótesis aprobada, nunca la de borrador.
    const outs = toolOutputs(meta.responses()[1]!);
    expect(outs[2]).toContain(approved.texto);
    expect(outs.join("\n")).not.toContain(draft.texto);

    // Datos que van al PDF.
    expect(rendered).toHaveLength(1);
    expect(rendered[0]!.template).toBe("expediente");
    const data = rendered[0]!.data as {
      red: string;
      demo: boolean;
      aprobado: boolean;
      hipotesis: Array<{ texto: string }>;
      vinculos: Array<{ vinculo: string; texto: string; puntaje: number; casos: string[] }>;
      evidencia: Array<{ label: string; sha256: string; caso: string }>;
      custodia: Array<{ seq: number; action: string; target_id: string; prev_hash: string; hash: string }>;
      perfil: Record<string, unknown>;
    };
    expect(data.red).toBe(net.label);
    expect(data.demo).toBe(true);
    expect(data.aprobado).toBe(false);
    expect(data.hipotesis.map((h) => h.texto)).toEqual([approved.texto]);
    // Un vínculo por cada vínculo confirmado (el que el modelo no explicó lleva una explicación de las señales).
    expect(data.vinculos.map((v) => v.vinculo)).toEqual(net.links.map((l) => `VIN-${l.num}`));
    expect([...data.vinculos[0]!.casos].sort()).toEqual([net.cases[0]!.code, net.cases[1]!.code].sort());
    expect(data.vinculos[1]!.texto.length).toBeGreaterThan(10);
    const allEvidence = net.cases.flatMap((c) => c.evidence);
    expect(data.evidencia.map((e) => e.label).sort()).toEqual(allEvidence.map((e) => e.label).sort());
    for (const e of allEvidence) expect(data.evidencia.find((x) => x.label === e.label)!.sha256).toBe(e.sha256);
    const uploads = data.custodia.filter((x) => x.action === "evidence.upload");
    expect(uploads.map((x) => x.target_id).sort()).toEqual(allEvidence.map((e) => e.label).sort());
    for (const x of data.custodia) {
      expect(x.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(x.prev_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    const seqs = data.custodia.map((x) => x.seq);
    expect([...seqs].sort((p, q) => p - q)).toEqual(seqs);
    // Las filas de custodia son las de la auditoría encadenada.
    const row = await env.DB.prepare("SELECT hash FROM audit_log WHERE seq = ?").bind(uploads[0]!.seq).first<{ hash: string }>();
    expect(row!.hash).toBe(uploads[0]!.hash);
    expect(JSON.stringify(data)).not.toContain("V-PRB1");

    // El PDF se guarda cifrado y se descarga igual, con auditoría.
    const pdf = await api(`/v1/console/expedientes/${res.body.id}/pdf`, { token: analyst.token });
    expect(pdf.status).toBe(200);
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(FAKE_PDF);
    const stored = await env.EVIDENCE.get(`expedientes/${res.body.id}.pdf`);
    expect(new Uint8Array(await stored!.arrayBuffer())).not.toEqual(FAKE_PDF);
    const created = await env.DB.prepare("SELECT details_json FROM audit_log WHERE action = 'expediente.create' AND target_id = ?").bind(res.body.id).first<{ details_json: string }>();
    expect(JSON.parse(created!.details_json)).toMatchObject({ sha256: res.body.sha256, hipotesis_aprobadas: 1 });

    const list = await apiJson<{ expedientes: Array<{ id: string; status: string }> }>(`/v1/console/networks/${net.networkId}/expedientes`, { token: analyst.token });
    expect(list.status).toBe(200);
    expect(list.body.expedientes.map((e) => e.id)).toEqual([res.body.id]);
    const admin = await loginAs("admin", net.orgId);
    expect((await api(`/v1/console/networks/${net.networkId}/expedientes`, { token: admin.token })).status).toBe(200);
    const reviewer = await loginAs("reviewer", net.orgId);
    expect((await api(`/v1/console/networks/${net.networkId}/expedientes`, { token: reviewer.token })).status).toBe(403);
  });

  it("sin el contenedor ML responde 503 claro y el expediente queda en error", async () => {
    const net = await seedNetwork({ n: 2 });
    const analyst = await loginAs("analyst", net.orgId);
    fakeMeta([() => [call("obtener_red", { red_id: net.label })], () => [final(expediente(net, { cronologia: [], hechos: [], resumen: "Red de dos casos (ficticia)." }))]]);
    const res = await apiJson<{ error: { code: string; message: string } }>(`/v1/console/networks/${net.networkId}/expediente`, { token: analyst.token, method: "POST" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("upstream_error");
    const row = await env.DB.prepare("SELECT status, content_json FROM expedientes WHERE network_id = ?").bind(net.networkId).first<{ status: string; content_json: string }>();
    expect(row!.status).toBe("error");
    expect(row!.content_json).toBeTruthy();
  });

  it("si las citas no pasan el validador después del reintento no genera PDF", async () => {
    const net = await seedNetwork({ n: 2 });
    const analyst = await loginAs("analyst", net.orgId);
    const rendered = fakeMl();
    const bad = expediente(net, { hechos: [{ texto: "Hecho inventado", evidencia: ["EV-ZZ9"] }] });
    fakeMeta([() => [final(bad)], () => [final(bad)]]);
    const res = await apiJson<{ error: { code: string; details: { citation_check: { citas_inexistentes: string[] } } } }>(`/v1/console/networks/${net.networkId}/expediente`, {
      token: analyst.token,
      method: "POST",
    });
    expect(res.status).toBe(502);
    expect(res.body.error.details.citation_check.citas_inexistentes).toContain("EV-ZZ9");
    expect(rendered).toHaveLength(0);
  });
});
