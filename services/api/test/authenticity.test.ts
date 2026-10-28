import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  DEFAULT_CALIBRATION,
  textoAutenticidadVictima,
  VICTIM_FORBIDDEN_KEYS,
  type AnalisisForense,
  type CaseSide,
  type ResultadoAutenticidad,
  type SenalesTecnicas,
  type VictimReport,
} from "@blindaje/shared";
import { autenticidadExpediente } from "../src/agents/redactor";
import { setMetaFetchForTests } from "../src/agents/common";
import { vinculadorMaterial } from "../src/agents/vinculador";
import { findCandidates, indexCase } from "../src/linking";
import { SYNTHETIC_VOICE_FACTOR, syntheticVoiceAdjust } from "../src/linking/signals";
import { parseSenalesTecnicas, setMlClientForTests } from "../src/ml/client";
import { loadNetworkData } from "../src/networks/graph";
import { AUTENTICIDAD_MODEL_AUDIO, AUTENTICIDAD_MODEL_VISUAL, nivelFinal, sanitizeTecnicas, SIN_SENALES_TECNICAS } from "../src/pipeline/authenticity";
import { processCaseLinking } from "../src/pipeline/queues";
import { processEvidence } from "../src/pipeline/steps";
import { seedNetwork } from "./agents-helpers";
import { emptyMetaLog, fakeAudio, fakeImage, FakeMl, fakeMetaFetch, insertEvidence, metaNoSimulada, senalesLimpias, type FakeMetaConfig } from "./fakes";
import { api, apiJson, createCase, loginAs, registerDevice, seedOrg } from "./helpers";

const turno = (text: string) => [{ speaker: "A", startMs: 0, endMs: 12_000, transcript: text }];

const VOZ_SINTETICA: AnalisisForense = {
  nivel: "indicios_fuertes",
  senales: [
    { fuente: "analisis_audio", descripcion: "Voz demasiado uniforme, sin respiración entre frases", peso: "fuerte" },
    { fuente: "analisis_audio", descripcion: "Ruido de fondo que se corta en seco", peso: "debil" },
  ],
  explicacion: "La voz podría ser sintética: la entonación es plana y no hay respiración audible (EXPLICACION-SECRETA).",
  limitaciones: "No se puede afirmar que sea una voz generada con IA sin marca de agua.",
};

const log = emptyMetaLog();
const cfg: FakeMetaConfig = {
  guiones: {
    M1: turno("Somos de Los X. Tienes 48 horas para pagar."),
    M2: turno("Habla con el jefe. No llames a la policía."),
    F1: turno("Paga hoy o atente a las consecuencias."),
    S1: turno("Aquí mandamos Los X. Yapea antes del viernes."),
    S2: turno("Aquí mandamos Los X. Yapea antes del viernes, ¿me escuchas?"),
    S3: turno("Los X te saludan. Yapea antes del viernes."),
    V1: turno("Tu cupo vence mañana."),
    N1: turno("Paga o ya sabes."),
  },
  fichas: {},
  sam: {},
  lecturas: {},
  vinculador: "echo",
  autenticidad: {
    // El modelo "confirma" sin marca de agua: el servidor debe recortarlo a indicios fuertes.
    M2: { ...VOZ_SINTETICA, nivel: "generado_ia_confirmado" },
    F1: "falla",
    S2: VOZ_SINTETICA,
    V1: VOZ_SINTETICA,
    // Como en la prueba real con Muse Spark 1.2: "señales" que solo dicen que algo no se revisó.
    N1: {
      nivel: "sin_senales",
      senales: [
        { fuente: "analisis_audio", descripcion: "Marca de agua AudioSeal no se pudo revisar - no concluyente", peso: "debil" },
        { fuente: "analisis_audio", descripcion: "No se observan alteraciones perceptibles compatibles con síntesis", peso: "debil" },
        { fuente: "analisis_audio", descripcion: "Respiración audible entre frases", peso: "debil" },
      ],
      explicacion: "Voz natural.",
      limitaciones: "Audio comprimido.",
    },
  },
};

let ml: FakeMl;
let org: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ml = new FakeMl();
  setMlClientForTests(ml);
  setMetaFetchForTests(fakeMetaFetch(cfg, log));
  org = await seedOrg({ maxUses: 50 });
});

afterAll(() => {
  setMlClientForTests(null);
  setMetaFetchForTests(metaNoSimulada);
});

async function autenticidad(evidenceId: string): Promise<ResultadoAutenticidad | null> {
  const row = await env.DB.prepare("SELECT content_json FROM derivatives WHERE evidence_id = ? AND tipo = 'autenticidad'")
    .bind(evidenceId)
    .first<{ content_json: string }>();
  return row ? (JSON.parse(row.content_json) as ResultadoAutenticidad) : null;
}

async function newCase(consent: "comunitario" | "solo_denuncia" = "comunitario") {
  const d = await registerDevice(org.invite);
  return { device: d, ...(await createCase(d.access_token, consent)) };
}

describe("reglas del nivel final", () => {
  const forense = (nivel: AnalisisForense["nivel"]): AnalisisForense => ({ nivel, senales: [], explicacion: "x", limitaciones: "y" });

  it("solo la marca de agua o C2PA confirman; el modelo nunca", () => {
    const marca: SenalesTecnicas = { ...SIN_SENALES_TECNICAS, watermark: { detector: "audioseal", detected: true, score: 0.97 } };
    const c2pa: SenalesTecnicas = { ...SIN_SENALES_TECNICAS, c2pa: { present: true, ai_generated: true, generator: "Muse Image", claims: [] } };
    expect(nivelFinal(marca, null)).toBe("generado_ia_confirmado");
    expect(nivelFinal(marca, forense("sin_senales"))).toBe("generado_ia_confirmado");
    expect(nivelFinal(c2pa, null)).toBe("generado_ia_confirmado");
    expect(nivelFinal(SIN_SENALES_TECNICAS, forense("generado_ia_confirmado"))).toBe("indicios_fuertes");
    expect(nivelFinal(SIN_SENALES_TECNICAS, forense("indicios_debiles"))).toBe("indicios_debiles");
    expect(nivelFinal(SIN_SENALES_TECNICAS, null)).toBe("sin_senales");
  });

  it("los metadatos y el detector de voz ponen un piso, sin confirmar", () => {
    const iptc: SenalesTecnicas = {
      ...SIN_SENALES_TECNICAS,
      metadata: { present: true, software: "x", digital_source_type: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia", suspicious: [], fields: {} },
    };
    expect(nivelFinal(iptc, forense("sin_senales"))).toBe("indicios_fuertes");
    const editada: SenalesTecnicas = { ...SIN_SENALES_TECNICAS, metadata: { present: true, software: "Editor", digital_source_type: null, suspicious: ["editada con software"], fields: {} } };
    expect(nivelFinal(editada, forense("sin_senales"))).toBe("indicios_debiles");
    const sintetica: SenalesTecnicas = { ...SIN_SENALES_TECNICAS, synthetic_speech: { detector: "d", score: 0.9, available: true } };
    expect(nivelFinal(sintetica, null)).toBe("indicios_fuertes");
  });

  it("los metadatos que ubican o identifican nunca se guardan", () => {
    const t = sanitizeTecnicas({
      ...SIN_SENALES_TECNICAS,
      metadata: {
        present: true,
        software: "Camera",
        digital_source_type: null,
        suspicious: [],
        fields: { GPSLatitude: "-12.04", GPSLongitude: "-77.03", Make: "Fabricante", BodySerialNumber: "123", Artist: "Fulano", DateTimeOriginal: "2026:10:01" },
      },
    });
    expect(Object.keys(t.metadata!.fields).sort()).toEqual(["DateTimeOriginal", "Make"]);
  });

  it("una respuesta del ML sin alguna clave cuenta como no revisada", () => {
    const t = parseSenalesTecnicas({ watermark: { detector: "videoseal", detected: false, score: 0.1, frames_checked: 12 }, extra: 1 });
    expect(t).toEqual({ watermark: { detector: "videoseal", detected: false, score: 0.1, frames_checked: 12 }, c2pa: null, metadata: null, synthetic_speech: null });
    expect(() => parseSenalesTecnicas({ watermark: { detected: "sí" } })).toThrow();
  });

  it("la voz sintética multiplica la p de voz por 0.5 una sola vez", () => {
    expect(syntheticVoiceAdjust(0.8, ["EV-A1", "EV-B1"], new Set())).toEqual({ p: 0.8 });
    const adj = syntheticVoiceAdjust(0.8, ["EV-A1", "EV-B1"], new Set(["EV-B1", "EV-A1"]));
    expect(adj.p).toBeCloseTo(0.4, 6);
    expect(adj.voz_sintetica).toEqual({ evidencia: ["EV-A1", "EV-B1"], factor: SYNTHETIC_VOICE_FACTOR, p_sin_ajuste: 0.8 });
  });
});

describe("paso autenticidad del pipeline", () => {
  it("marca de agua detectada: generado_ia_confirmado (audio con Muse Spark 1.2 e input_audio)", async () => {
    const c = await newCase();
    ml.authenticity.M1 = { watermark: { detector: "audioseal", detected: true, score: 0.98 } };
    const ev = await insertEvidence(c, 1, "audio", fakeAudio("M1", { A: "persona1" }), { mime: "audio/ogg" });
    expect(await processEvidence(env, ev.id)).toEqual({ status: "processed" });

    const r = await autenticidad(ev.id);
    expect(r).toMatchObject({ evidence_label: ev.label, tipo: "audio", nivel: "generado_ia_confirmado", model: AUTENTICIDAD_MODEL_AUDIO });
    expect(r!.tecnicas.watermark).toEqual({ detector: "audioseal", detected: true, score: 0.98 });
    expect(r!.forense?.nivel).toBe("sin_senales");

    const call = log.autenticidad.find((x) => x.marker === "M1")!;
    expect(call.model).toBe("muse-spark-1.2");
    expect(call.parts).toEqual(["input_text", "input_audio"]);
    expect(call.effort).toBe("low");
    expect(call.max_output_tokens).toBeGreaterThanOrEqual(4000);
    expect(call.text).toContain("Marca de agua de IA (audioseal): DETECTADA");
    expect(call.text).toContain('puedes usar "generado_ia_confirmado"');
    const cost = await env.DB.prepare("SELECT model, status, case_id FROM api_costs WHERE operation = 'autenticidad' AND case_id = ?").bind(c.id).first();
    expect(cost).toMatchObject({ model: "muse-spark-1.2", status: "ok", case_id: c.id });
  });

  it("sin señales: sin_senales (imagen con Muse Spark 1.3 e input_image)", async () => {
    const c = await newCase();
    const ev = await insertEvidence(c, 1, "imagen", fakeImage("limpia1"), { mime: "image/jpeg" });
    expect(await processEvidence(env, ev.id)).toEqual({ status: "processed" });
    const r = await autenticidad(ev.id);
    expect(r).toMatchObject({ tipo: "imagen", nivel: "sin_senales", model: AUTENTICIDAD_MODEL_VISUAL, tecnicas: senalesLimpias("image") });
    expect(r!.forense).toMatchObject({ nivel: "sin_senales", senales: [] });
    const call = log.autenticidad.find((x) => x.marker === "limpia1")!;
    expect(call.model).toBe("muse-spark-1.3");
    expect(call.parts).toEqual(["input_text", "input_image"]);
    expect(call.text).toContain('NO uses "generado_ia_confirmado"');
  });

  it("el modelo no puede confirmar sin marca de agua ni C2PA", async () => {
    const c = await newCase();
    const ev = await insertEvidence(c, 1, "audio", fakeAudio("M2", { A: "persona1" }));
    await processEvidence(env, ev.id);
    const r = await autenticidad(ev.id);
    expect(r!.nivel).toBe("indicios_fuertes");
    expect(r!.forense!.nivel).toBe("indicios_fuertes");
  });

  it("un fallo del ML no rompe el caso: se guarda solo el análisis forense", async () => {
    const c = await newCase();
    ml.authenticityFails = true;
    try {
      const ev = await insertEvidence(c, 1, "imagen", fakeImage("sinml1"));
      expect(await processEvidence(env, ev.id)).toEqual({ status: "processed" });
      const r = await autenticidad(ev.id);
      expect(r!.tecnicas).toEqual(SIN_SENALES_TECNICAS);
      expect(r!.forense).not.toBeNull();
      expect(log.autenticidad.find((x) => x.marker === "sinml1")!.text).toContain("Marca de agua de IA (marca de agua): no se pudo revisar.");
      // El resto del procesamiento siguió igual.
      const segs = await env.DB.prepare("SELECT COUNT(*) AS n FROM derivatives WHERE evidence_id = ? AND tipo = 'segmentacion'").bind(ev.id).first<{ n: number }>();
      expect(segs!.n).toBe(1);
    } finally {
      ml.authenticityFails = false;
    }
  });

  it("si fallan el ML y Meta, la evidencia se procesa y queda 'no analizado'", async () => {
    const c = await newCase();
    ml.authenticityFails = true;
    try {
      const ev = await insertEvidence(c, 1, "audio", fakeAudio("F1", { A: "persona1" }));
      expect(await processEvidence(env, ev.id)).toEqual({ status: "processed" });
      const row = await env.DB.prepare("SELECT status FROM evidence WHERE id = ?").bind(ev.id).first<{ status: string }>();
      expect(row!.status).toBe("procesado");
      expect(await autenticidad(ev.id)).toBeNull();
      const tr = await env.DB.prepare("SELECT COUNT(*) AS n FROM derivatives WHERE evidence_id = ? AND tipo = 'transcripcion'").bind(ev.id).first<{ n: number }>();
      expect(tr!.n).toBe(1);

      const report = await apiJson<VictimReport>(`/v1/cases/${c.id}/report`, { token: c.device.access_token });
      expect(report.status).toBe(200);
      expect(report.body.evidencia[0]!.autenticidad).toBeNull();
    } finally {
      ml.authenticityFails = false;
    }
  });

  it("descarta las 'señales' que solo dicen que algo no se revisó", async () => {
    const c = await newCase();
    const ev = await insertEvidence(c, 1, "audio", fakeAudio("N1", { A: "persona1" }));
    await processEvidence(env, ev.id);
    const r = await autenticidad(ev.id);
    expect(r!.forense!.senales.map((s) => s.descripcion)).toEqual(["Respiración audible entre frases"]);
    const call = log.autenticidad.find((x) => x.marker === "N1")!;
    expect(call.text).toContain("No incluyas las fuentes que no se pudieron revisar");
  });

  it("el texto no se analiza", async () => {
    const c = await newCase();
    const before = ml.calls.filter((x) => x.startsWith("authenticity")).length;
    const ev = await insertEvidence(c, 1, "texto", new TextEncoder().encode("Yapea hoy. Los X."), { source: "pegado" });
    await processEvidence(env, ev.id);
    expect(await autenticidad(ev.id)).toBeNull();
    expect(ml.calls.filter((x) => x.startsWith("authenticity")).length).toBe(before);
  });
});

describe("víctima y consola", () => {
  it("la víctima solo ve el texto corto, nunca las señales técnicas ni el análisis", async () => {
    const c = await newCase();
    ml.authenticity.V1 = {
      metadata: { present: true, software: "SoftwareSecreto", digital_source_type: null, suspicious: ["sin datos de grabación"], fields: { Encoder: "x" } },
    };
    const ev = await insertEvidence(c, 1, "audio", fakeAudio("V1", { A: "persona4" }));
    await processEvidence(env, ev.id);
    expect((await autenticidad(ev.id))!.nivel).toBe("indicios_fuertes");

    const res = await api(`/v1/cases/${c.id}/report`, { token: c.device.access_token });
    expect(res.status).toBe(200);
    const text = await res.text();
    const report = JSON.parse(text) as VictimReport;
    expect(report.evidencia[0]!.autenticidad).toBe(textoAutenticidadVictima("indicios_fuertes"));
    for (const secret of ["tecnicas", "forense", "watermark", "c2pa", "synthetic_speech", "explicacion", "limitaciones", "EXPLICACION-SECRETA", "SoftwareSecreto", "audioseal", "indicios_fuertes"]) {
      expect(text.includes(secret), secret).toBe(false);
    }
    for (const k of VICTIM_FORBIDDEN_KEYS) expect(text.includes(`"${k}"`), k).toBe(false);
  });

  it("la consola ve el resultado completo en la evidencia del caso", async () => {
    const c = await newCase();
    const ev = await insertEvidence(c, 1, "imagen", fakeImage("consola1"));
    const txt = await insertEvidence(c, 2, "texto", new TextEncoder().encode("Paga. Los X."), { source: "pegado" });
    await processEvidence(env, ev.id);
    await processEvidence(env, txt.id);
    const analyst = await loginAs("analyst", org.orgId);
    const res = await apiJson<CaseSide>(`/v1/console/cases/${c.id}`, { token: analyst.token });
    expect(res.status).toBe(200);
    const [img, msg] = res.body.evidencia;
    expect(img!.autenticidad).toMatchObject({ nivel: "sin_senales", tipo: "imagen", forense: { nivel: "sin_senales" } });
    expect(msg!.autenticidad).toBeUndefined();
  });
});

describe("vinculación con voz sintética", () => {
  const cases: Record<string, { id: string; code: string; audio: string }> = {};

  async function voiceCase(key: string, guion: string) {
    const c = await newCase();
    const ev = await insertEvidence(c, 1, "audio", fakeAudio(guion, { A: "persona7" }));
    expect(await processEvidence(env, ev.id)).toEqual({ status: "processed" });
    expect((await indexCase(env, c.id)).indexed).toBe(true);
    cases[key] = { id: c.id, code: c.code, audio: ev.label };
  }

  it("un audio con indicios fuertes baja a la mitad la señal de voz y queda marcado", async () => {
    await voiceCase("limpio", "S1");
    await voiceCase("sintetico", "S2");
    await voiceCase("otro", "S3");

    // Limpio contra limpio: sin ajuste.
    const otro = await findCandidates(env, cases.otro!.id);
    const conLimpio = otro.find((p) => p.other_case_id === cases.limpio!.id)!;
    expect(conLimpio.signals.voz).toBeDefined();
    expect(conLimpio.signals.voz!.voz_sintetica).toBeUndefined();

    // Contra el audio con voz sintética: p × 0.5 y la evidencia marcada.
    const conSintetico = otro.find((p) => p.other_case_id === cases.sintetico!.id)!;
    const voz = conSintetico.signals.voz!;
    expect(voz.voz_sintetica).toMatchObject({ evidencia: [cases.sintetico!.audio], factor: 0.5 });
    expect(voz.p).toBeCloseTo(voz.voz_sintetica!.p_sin_ajuste * 0.5, 4);
    expect(voz.p).toBeLessThan(conLimpio.signals.voz!.p);

    // Desde el caso con voz sintética, también.
    const desde = await findCandidates(env, cases.sintetico!.id);
    for (const p of desde) expect(p.signals.voz?.voz_sintetica?.evidencia).toEqual([cases.sintetico!.audio]);
  });

  it("el Vinculador recibe la autenticidad en su entrada", async () => {
    // Solo voz (p 0.85 × 0.5) queda bajo 0.60 y el Vinculador no corre: se revisa su material.
    const pair = (await findCandidates(env, cases.sintetico!.id)).find((p) => p.other_case_id === cases.limpio!.id)!;
    const material = await vinculadorMaterial(env, pair, DEFAULT_CALIBRATION);
    const input = material!.input;
    expect(input).toContain(`${cases.sintetico!.audio} tiene indicios fuertes de voz sintética`);
    expect(input).toContain("una voz sintética podría imitar a otra");
    expect(input).toContain(`- ${cases.sintetico!.audio} (audio): indicios fuertes de IA o manipulación.`);
    expect(input).not.toContain(`- ${cases.limpio!.audio} (audio)`);
    // Y el vínculo que se guarda conserva la marca para la consola.
    await processCaseLinking(env, cases.sintetico!.id);
    const [a, b] = [cases.sintetico!.id, cases.limpio!.id].sort();
    const link = await env.DB.prepare("SELECT signals_json FROM links WHERE case_a = ? AND case_b = ?").bind(a, b).first<{ signals_json: string }>();
    if (link) expect(JSON.parse(link.signals_json).voz.voz_sintetica.evidencia).toEqual([cases.sintetico!.audio]);
  });
});

describe("expediente", () => {
  it("los datos del PDF traen la sección de autenticidad con la nota fija", async () => {
    const net = await seedNetwork({ n: 2 });
    const img = net.cases[0]!.evidence[1]!;
    const result: ResultadoAutenticidad = {
      evidence_label: img.label,
      tipo: "imagen",
      nivel: "indicios_fuertes",
      tecnicas: { ...SIN_SENALES_TECNICAS, c2pa: { present: false, ai_generated: null, generator: null, claims: [] } },
      forense: { nivel: "indicios_fuertes", senales: [{ fuente: "analisis_visual", descripcion: "Sombra incoherente", peso: "fuerte" }], explicacion: "Podría estar generada.", limitaciones: "Sin marca no se confirma." },
      model: "muse-spark-1.3",
      analizado_at: "2026-10-28T10:00:00Z",
    };
    await env.DB.prepare("INSERT INTO derivatives (id, evidence_id, case_id, tipo, content_json, r2_key, created_at) VALUES (?, ?, ?, 'autenticidad', ?, NULL, ?)")
      .bind(crypto.randomUUID(), img.id, net.cases[0]!.id, JSON.stringify(result), "2026-10-28T10:00:00Z")
      .run();
    const sec = await autenticidadExpediente(env, await loadNetworkData(env, net.networkId));
    expect(sec.titulo).toBe("Autenticidad de la evidencia");
    expect(sec.nota).toContain("La ausencia de marca de agua no prueba que sea real");
    expect(sec.items).toHaveLength(4);
    const item = sec.items.find((i) => i.label === img.label)!;
    expect(item).toMatchObject({ nivel: "indicios_fuertes", nivel_texto: "Indicios fuertes", explicacion: "Podría estar generada.", limitaciones: "Sin marca no se confirma." });
    expect(item.senales).toEqual(["Análisis visual (Muse Spark) (fuerte): Sombra incoherente"]);
    expect(item.tecnicas).toEqual(["C2PA: no trae"]);
    expect(sec.items.filter((i) => i.nivel === null).every((i) => i.nivel_texto === "No analizado")).toBe(true);
  });
});
