import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { DEFAULT_CALIBRATION, evidenceLabel, type Calibration, type FichaExtraction, type LinkView, type Signals } from "@blindaje/shared";
import { setMetaFetchForTests } from "../src/agents/common";
import { CALIBRATION_KV_KEY, findCandidates, indexCase } from "../src/linking";
import { commonPhrases, finalScore, imageProbability, moProbability, phraseSimilarity, voiceProbability } from "../src/linking/signals";
import { setMlClientForTests } from "../src/ml/client";
import { processCaseLinking } from "../src/pipeline/queues";
import { buildFicha, ensureTextEmbedding, processEvidence, storeIdentifiers } from "../src/pipeline/steps";
import { emptyMetaLog, fakeAudio, FakeMl, fakeMetaFetch, insertEvidence, metaNoSimulada, type FakeMetaConfig } from "./fakes";
import { apiJson, createCase, loginAs, registerDevice, seedOrg, type TestDevice } from "./helpers";

/** Calibración real de la evaluación (eval/calibration.json, versión v1-eval-2026-10-28). */
const EVAL_CAL: Calibration = {
  version: "v1-eval-2026-10-28",
  updated_at: "2026-10-28T07:17:08.967Z",
  source: "eval/report.json",
  thresholds: { probable: 0.9, revisar: 0.6 },
  voz: { a: 96.663, b: 0.6006, min_segmentos: 2, p_max: 0.85 },
  imagen: { hamming_max: 10, p_hamming: 0.8, dino_a: 40, dino_b: 0.959, p_max: 0.5 },
  mo: { a: 12, b: 0.85, p_max: 0.4 },
  identificador: { p: 0.95 },
};

const RESUMEN_X = "Voz masculina por audio de WhatsApp que dice ser de Los X; exige pago por Yape con plazo de 48 horas y amenaza con dañar el local.";
const turno = (text: string) => [{ speaker: "A", startMs: 0, endMs: 12_000, transcript: text }];

const log = emptyMetaLog();
const cfg: FakeMetaConfig = {
  guiones: {
    A1: turno("Somos de Los X, aquí todos pagan su colaboración. Tienes 48 horas. No llames a la policía."),
    B1: turno("Mototaxista, aquí mandamos Los X. Habla con el jefe para que te pase el Yape. Y no llames a la policía."),
    C1: turno("Comerciante, tu cupo es de ochocientos soles a la semana. Tienes hasta el viernes."),
    D1: turno("Le llamo por la deuda del préstamo, deposite en la cuenta del banco o difundimos sus fotos."),
    F1: turno("Habla con el jefe. Yapea al número que te mandamos."),
  },
  fichas: {},
  sam: {},
  lecturas: {},
  vinculador: "echo",
};

function ficha(over: Partial<FichaExtraction>): FichaExtraction {
  return {
    sector: "bodega",
    primer_contacto: null,
    tipo_amenaza: "dano_local",
    amenaza: "Daño al local",
    monto_soles: 2000,
    periodicidad: "unico",
    plazo: "48 horas",
    plazo_horas: 48,
    canal_pago: "yape",
    identificadores: [],
    grupo_que_dice_ser: "Los X",
    frases_firma: ["habla con el jefe", "no llames a la policía"],
    escalamiento: [],
    resumen_mo: RESUMEN_X,
    fuentes: [],
    ...over,
  };
}

let ml: FakeMl;
let org: Awaited<ReturnType<typeof seedOrg>>;
const cases: Record<string, { id: string; code: string; device: TestDevice }> = {};

/** Lo que hace el Workflow, paso a paso y sin colas: ingesta, ficha, identificadores, indexar. */
async function prepare(
  key: string,
  opts: { voz?: { guion: string; persona: string }; mensaje?: string; ficha: (labels: string[]) => Partial<FichaExtraction>; consent?: "comunitario" | "solo_denuncia"; device?: TestDevice },
) {
  const device = opts.device ?? (await registerDevice(org.invite));
  const c = await createCase(device.access_token, opts.consent ?? "comunitario");
  const labels: string[] = [];
  let n = 0;
  if (opts.voz) {
    const ev = await insertEvidence(c, ++n, "audio", fakeAudio(opts.voz.guion, { A: opts.voz.persona }));
    await processEvidence(env, ev.id);
    labels.push(ev.label);
  }
  if (opts.mensaje) {
    const ev = await insertEvidence(c, ++n, "texto", new TextEncoder().encode(opts.mensaje), { source: "pegado" });
    await processEvidence(env, ev.id);
    labels.push(ev.label);
  }
  cfg.fichas[c.code] = ficha({ fuentes: labels, ...opts.ficha(labels) });
  const f = await buildFicha(env, c.id);
  await env.DB.prepare("UPDATE cases SET ficha_json = ?, estado = 'listo' WHERE id = ?").bind(JSON.stringify(f), c.id).run();
  await storeIdentifiers(env, c.id);
  await ensureTextEmbedding(env, c.id, null);
  const idx = await indexCase(env, c.id);
  cases[key] = { ...c, device };
  return { ...c, indexed: idx.indexed };
}

async function linkBetween(x: string, y: string) {
  const [a, b] = [cases[x]!.id, cases[y]!.id].sort();
  const row = await env.DB.prepare("SELECT * FROM links WHERE case_a = ? AND case_b = ?").bind(a, b).first<{
    id: string;
    num: number;
    status: string;
    score: number;
    score_raw: number;
    signals_json: string;
    vinculador_valid: number | null;
  }>();
  return row ? { ...row, signals: JSON.parse(row.signals_json) as Signals } : null;
}

beforeAll(async () => {
  ml = new FakeMl();
  setMlClientForTests(ml);
  setMetaFetchForTests(fakeMetaFetch(cfg, log));
  await env.CONFIG.put(CALIBRATION_KV_KEY, JSON.stringify(EVAL_CAL));
  org = await seedOrg({ maxUses: 50 });
});

afterAll(async () => {
  setMlClientForTests(null);
  setMetaFetchForTests(metaNoSimulada);
  await env.CONFIG.delete(CALIBRATION_KV_KEY);
});

describe("motor de vinculación sobre los casos A, B y C (calibración de la evaluación)", () => {
  it("el primer caso no tiene con quién vincularse", async () => {
    await prepare("A", {
      voz: { guion: "A1", persona: "persona1" },
      mensaje: "Si no yapeas S/ 2,000 en 48 horas al 900 000 101 ya sabes lo que pasa. Los X.",
      ficha: ([audio, msg]) => ({
        identificadores: [
          { tipo: "cuenta_yape", valor: "900 000 101", rol: "cobro", evidencia: [msg!] },
          { tipo: "telefono", valor: "+51 900 000 111", rol: "contacto", evidencia: [audio!] },
        ],
      }),
    });
    expect((await processCaseLinking(env, cases.A!.id)).links).toEqual([]);
  });

  it("A–B: la voz se parece con números distintos y el mismo guion: supera el umbral (probable)", async () => {
    await prepare("B", {
      voz: { guion: "B1", persona: "persona1" },
      mensaje: "Yapea al 900 000 202. Habla con el jefe.",
      ficha: ([audio, msg]) => ({
        sector: "mototaxi",
        monto_soles: 1500,
        grupo_que_dice_ser: "los x",
        frases_firma: ["Habla con el jefe", "No llames a la policía!"],
        identificadores: [
          { tipo: "cuenta_yape", valor: "900000202", rol: "cobro", evidencia: [msg!] },
          { tipo: "telefono", valor: "900 000 222", rol: "contacto", evidencia: [audio!] },
        ],
      }),
    });
    const summary = await processCaseLinking(env, cases.B!.id);
    const ab = await linkBetween("A", "B");
    expect(ab).not.toBeNull();
    expect(ab!.signals.identificador).toBeUndefined();
    expect(ab!.signals.voz!.p).toBeCloseTo(0.85, 3);
    expect(ab!.signals.voz!.segmentos).toBeGreaterThanOrEqual(EVAL_CAL.voz.min_segmentos);
    expect(ab!.signals.modus_operandi).toMatchObject({ mismo_canal_pago: true, mismo_grupo: true, frases_comunes: ["Habla con el jefe", "No llames a la policía!"] });
    expect(ab!.signals.modus_operandi!.p).toBeLessThanOrEqual(EVAL_CAL.mo.p_max);
    expect(ab!.score_raw).toBeGreaterThanOrEqual(EVAL_CAL.thresholds.probable);
    expect(ab!.status).toBe("probable");
    expect(ab!.vinculador_valid).toBe(1);
    expect(summary.links.find((l) => l.other_case_id === cases.A!.id)?.status).toBe("probable");
    console.log(`[escenario] A–B score_raw=${ab!.score_raw} voz=${ab!.signals.voz!.p.toFixed(3)} (coseno ${ab!.signals.voz!.similitud}) mo=${ab!.signals.modus_operandi!.p.toFixed(3)}`);

    // El Vinculador recibió las dos fichas, las señales y los fragmentos con su EV y su huella.
    const input = log.vinculador.at(-1)!;
    expect(input).toContain(`FICHA-${cases.A!.code}`);
    expect(input).toContain(`FICHA-${cases.B!.code}`);
    expect(input).toMatch(/\[EV-[A-Z0-9-]+ · V-\d+ · \d\d:\d\d–\d\d:\d\d\] «/);

    // La consola muestra los segmentos que coinciden, con tiempos y texto, y la auditoría lo registra.
    const analyst = await loginAs("analyst", org.orgId);
    const view = await apiJson<LinkView>(`/v1/console/links/${ab!.id}`, { token: analyst.token });
    expect(view.status).toBe(200);
    expect(view.body.fragments.length).toBeGreaterThanOrEqual(2);
    for (const f of view.body.fragments) {
      expect(f.end_ms).toBeGreaterThan(f.start_ms);
      expect(f.voice_label).toMatch(/^V-\d+$/);
      expect(f.text).toBeTruthy();
    }
    expect(new Set(view.body.fragments.map((f) => f.evidence_label)).size).toBe(2);
    const audited = await env.DB.prepare("SELECT details_json FROM audit_log WHERE action = 'link.propose' AND target_id = ?").bind(ab!.id).first<{ details_json: string }>();
    expect(JSON.parse(audited!.details_json)).toMatchObject({ status: "probable", vinculador_valid: true });
  });

  it("C–B: la misma cuenta de Yape da un vínculo probable aunque la voz sea otra", async () => {
    await prepare("C", {
      voz: { guion: "C1", persona: "persona2" },
      mensaje: "Tu cupo es S/ 800 semanal. Yapea al 900 000 202. Tienes hasta el viernes.",
      ficha: ([audio, msg]) => ({
        sector: "mercado",
        monto_soles: 800,
        periodicidad: "semanal",
        plazo: "hasta el viernes",
        grupo_que_dice_ser: null,
        frases_firma: ["tienes hasta el viernes"],
        resumen_mo: "Mensajes y audios que cobran un cupo semanal por Yape con plazo hasta el viernes.",
        identificadores: [
          { tipo: "cuenta_yape", valor: "900 000 202", rol: "cobro", evidencia: [msg!] },
          { tipo: "telefono", valor: "900000333", rol: "contacto", evidencia: [audio!] },
        ],
      }),
    });
    await processCaseLinking(env, cases.C!.id);
    const bc = await linkBetween("B", "C");
    expect(bc!.signals.identificador).toMatchObject({ p: 0.95, compartidos: [expect.objectContaining({ tipo: "cuenta_yape", ultimos_3: "202" })] });
    expect(bc!.signals.voz!.p).toBeLessThan(0.01);
    expect(bc!.status).toBe("probable");
    expect(bc!.score_raw).toBeGreaterThanOrEqual(0.95);
    console.log(`[escenario] B–C score_raw=${bc!.score_raw} identificador=0.95 voz=${bc!.signals.voz!.p.toFixed(4)}`);
    const ac = await linkBetween("A", "C");
    if (ac) expect(ac.status).toBe("descartado_auto");
  });

  it("la voz sola, con guiones distintos, no llega a probable", async () => {
    await prepare("D", {
      voz: { guion: "D1", persona: "persona1" },
      ficha: ([audio]) => ({
        sector: "otro",
        tipo_amenaza: "difusion_informacion",
        amenaza: "Difundir fotos",
        monto_soles: 300,
        periodicidad: "mensual",
        canal_pago: "transferencia",
        grupo_que_dice_ser: null,
        frases_firma: ["deposite en la cuenta del banco"],
        resumen_mo: "Llamadas sobre una supuesta deuda de un préstamo; piden depósito bancario mensual y amenazan con difundir fotos.",
        identificadores: [{ tipo: "cuenta_bancaria", valor: "0011-2233-4455667788", rol: "cobro", evidencia: [audio!] }],
      }),
    });
    await processCaseLinking(env, cases.D!.id);
    const ad = await linkBetween("A", "D");
    expect(ad!.signals.voz!.p).toBeCloseTo(0.85, 3);
    expect(ad!.signals.modus_operandi!.p).toBeLessThan(0.05);
    expect(ad!.score_raw).toBeLessThan(EVAL_CAL.thresholds.probable);
    expect(ad!.status).not.toBe("probable");
    expect(ad!.status).toBe("por_revisar");
    console.log(`[escenario] A–D (solo voz) score_raw=${ad!.score_raw} → ${ad!.status}`);
  });

  it("el modus operandi solo nunca pasa de descartado_auto (y no llama al Vinculador)", async () => {
    const before = log.vinculador.length;
    await prepare("E", {
      mensaje: "Somos Los X. Yapea S/ 2,000 al 900 000 505 en 48 horas. Habla con el jefe y no llames a la policía.",
      ficha: ([msg]) => ({ identificadores: [{ tipo: "cuenta_yape", valor: "900000505", rol: "cobro", evidencia: [msg!] }] }),
    });
    const summary = await processCaseLinking(env, cases.E!.id);
    const ae = await linkBetween("A", "E");
    expect(ae!.signals.modus_operandi!.p).toBeCloseTo(EVAL_CAL.mo.p_max, 3);
    expect(Object.keys(ae!.signals)).toEqual(["modus_operandi"]);
    expect(ae!.status).toBe("descartado_auto");
    for (const l of summary.links) expect(l.status).toBe("descartado_auto");
    expect(log.vinculador.length).toBe(before);
    console.log(`[escenario] A–E (solo modus operandi) score_raw=${ae!.score_raw} → ${ae!.status}`);
  });

  it("un caso 'solo mi denuncia' no se indexa ni aparece como candidato", async () => {
    const f = await prepare("F", {
      consent: "solo_denuncia",
      voz: { guion: "F1", persona: "persona1" },
      mensaje: "Yapea al 900 000 202.",
      ficha: ([audio, msg]) => ({
        identificadores: [
          { tipo: "cuenta_yape", valor: "900000202", rol: "cobro", evidencia: [msg!] },
          { tipo: "telefono", valor: "900000666", rol: "contacto", evidencia: [audio!] },
        ],
      }),
    });
    expect(f.indexed).toBe(false);
    const row = await env.DB.prepare("SELECT indexed FROM cases WHERE id = ?").bind(f.id).first<{ indexed: number }>();
    expect(row!.indexed).toBe(0);
    const ci = await env.DB.prepare("SELECT MAX(indexed) AS m FROM case_identifiers WHERE case_id = ?").bind(f.id).first<{ m: number }>();
    expect(ci!.m).toBe(0);
    expect(await findCandidates(env, f.id)).toEqual([]);
    const fromB = await findCandidates(env, cases.B!.id);
    expect(fromB.map((p) => p.other_case_id)).not.toContain(f.id);
    await processCaseLinking(env, cases.B!.id, "reindex");
    const anyF = await env.DB.prepare("SELECT COUNT(*) AS n FROM links WHERE case_a = ? OR case_b = ?").bind(f.id, f.id).first<{ n: number }>();
    expect(anyF!.n).toBe(0);
  });

  it("dos casos del mismo dispositivo no se vinculan entre sí", async () => {
    await prepare("H", {
      device: cases.B!.device,
      mensaje: "Yapea al 900 000 202, habla con el jefe.",
      ficha: ([msg]) => ({ identificadores: [{ tipo: "cuenta_yape", valor: "900000202", rol: "cobro", evidencia: [msg!] }] }),
    });
    await processCaseLinking(env, cases.H!.id);
    expect(await linkBetween("B", "H")).toBeNull();
    expect((await linkBetween("C", "H"))?.status).toBe("probable");
  });

  it("una salida inválida del Vinculador no ajusta el puntaje", async () => {
    cfg.vinculador = "invalido";
    try {
      await prepare("G", {
        mensaje: "Pagas tu cupo al Yape 900 000 202.",
        ficha: ([msg]) => ({
          grupo_que_dice_ser: null,
          frases_firma: [],
          resumen_mo: "Mensaje de cobro de cupo por Yape.",
          identificadores: [{ tipo: "cuenta_yape", valor: "900000202", rol: "cobro", evidencia: [msg!] }],
        }),
      });
      await processCaseLinking(env, cases.G!.id);
    } finally {
      cfg.vinculador = "echo";
    }
    const bg = await linkBetween("B", "G");
    expect(bg!.vinculador_valid).toBe(0);
    expect(bg!.score).toBe(bg!.score_raw);
    expect(bg!.status).toBe("probable");
    const run = await env.DB.prepare("SELECT status, attempts FROM agent_runs WHERE agent = 'vinculador' ORDER BY created_at DESC LIMIT 1").first();
    expect(run).toEqual({ status: "invalido", attempts: 2 });
  });

  it("FAISS se reconstruye desde D1 si el contenedor perdió los índices", async () => {
    ml.indices.clear();
    const pairs = await findCandidates(env, cases.B!.id);
    expect(ml.calls).toContain("rebuild:voz");
    expect(pairs.map((p) => p.other_case_id)).toEqual(expect.arrayContaining([cases.A!.id, cases.C!.id]));
  });
});

describe("señales calibradas", () => {
  it("voz con pocos segmentos baja; modus operandi con tope; imagen con hash perceptual primero", () => {
    expect(voiceProbability(0.9, 3, EVAL_CAL)).toBeCloseTo(0.85, 6);
    expect(voiceProbability(0.9, 1, EVAL_CAL)).toBeCloseTo(0.85 * 0.25, 6);
    expect(voiceProbability(0.9, 0, EVAL_CAL)).toBe(0);
    expect(moProbability({ similitud_texto: 1, frases_comunes: 5, mismo_canal_pago: true, mismo_grupo: true }, EVAL_CAL)).toBe(0.4);
    expect(imageProbability(4, 0.2, EVAL_CAL)).toBe(0.8);
    expect(imageProbability(30, 0.999, EVAL_CAL)).toBe(0.5);
    expect(imageProbability(30, 0.9, EVAL_CAL)).toBeLessThan(0.1);
    expect(imageProbability(null, null, DEFAULT_CALIBRATION)).toBe(0);
  });

  it("el Vinculador baja libremente pero sube a lo más 0.05", () => {
    expect(finalScore(0.2, 0.91)).toBe(0.2);
    expect(finalScore(1, 0.91)).toBeCloseTo(0.96, 6);
    expect(finalScore(1, 0.99)).toBe(1);
  });

  it("frases firma: coincidencia difusa sin tildes ni mayúsculas", () => {
    expect(phraseSimilarity("No llames a la policía!", "no llames a la policia")).toBe(1);
    expect(commonPhrases(["Habla con el jefe", "tienes 48 horas"], ["habla con el jefe ya", "otra cosa"])).toEqual(["Habla con el jefe"]);
    expect(evidenceLabel("A", 1)).toBe("EV-A1");
  });
});
