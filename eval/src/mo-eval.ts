import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { combineSignals, evidenceLabel, logistic, statusForScore, type Calibration, type FichaExtraction } from "@blindaje/shared";
// La fórmula del pipeline, sin copiarla: funciones puras de services/api (solo dependen de shared).
import { commonPhrases, moProbability, sameGroup } from "../../services/api/src/linking/signals";
import { CACHE_DIR, DEMO_DIR, ML_URL, RESULTS_DIR } from "./env";
import { loadGuiones } from "./data";
import { loadDemo } from "./demo-data";
import { extractFicha, extractFichaPiezas, pool } from "./ficha-eval";
import type { PiezaEvidencia } from "./ficha-input";

/**
 * Calibración de la señal de modus operandi (sección 9.2) con datos.
 *
 * 1. Fichas reales de Muse Spark para los 32 guiones ficticios y para los casos del demo (A–G).
 * 2. Vector del resumen_mo con el contenedor ML (`/text/embed`, kind passage), como el pipeline.
 * 3. Para cada par, la entrada de la logística del pipeline:
 *      x = coseno + 0.05·min(frases comunes, 3) + 0.03·(mismo canal) + 0.05·(mismo grupo)
 *    con `commonPhrases` y `sameGroup` de services/api/src/linking/signals.ts.
 * 4. Pares del mismo guion o banda (misma familia, salvo "sin_grupo") frente a pares distintos.
 * 5. a y b con el mismo método que la voz (gaussiana: b donde el cociente de verosimilitud vale 1,
 *    a = pendiente de su logaritmo) y una restricción: como máximo 1 de cada 100 pares distintos
 *    llega a p_crit, la probabilidad de MO que con la voz en su tope haría "probable" el vínculo:
 *      p_crit = 1 − (1 − umbral probable) / (1 − p_max de voz) = 1/3 con 0.90 y 0.85.
 * 6. Verificaciones: (a) A–B del demo (voz + mismo guion) ≥ 0.90; (b) voz sola + guion distinto
 *    < 0.90; (c) el MO solo nunca pasa de descartado_auto.
 */

export interface MoReport {
  estado: "ok" | "pendiente" | "error";
  motivo?: string;
  modelo_texto?: string;
  formula: string;
  pares: { mismo_guion: number; distintos: number };
  distribuciones?: Record<string, Record<string, number>>;
  coseno_texto?: Record<string, Record<string, number>>;
  calibracion?: { a: number; b: number; p_max: number; b_gauss: number; b_restringido: number; p_crit: number; x_percentil_99_distintos: number };
  comparacion?: Record<string, { a: number; b: number; mismo_guion_alcanzan_p_crit: number; distintos_alcanzan_p_crit: number; mo_max: number }>;
  verificaciones?: {
    a_demo_AB: { voz_coseno: number; p_voz: number; p_mo: number; score: number; estado: string; cumple: boolean; con_calibracion_anterior: number };
    b_voz_sola_guion_distinto: {
      pares_guiones: number;
      llegan_a_probable: number;
      tasa: number;
      demo: { par: string; p_mo: number; score_con_voz_al_tope: number; estado: string }[];
      cumple: boolean;
    };
    c_mo_solo: { mo_max: number; estado_max: string; cumple: boolean };
  };
  demo_pares?: { par: string; similitud_texto: number; frases_comunes: string[]; mismo_canal: boolean; mismo_grupo: boolean; p_mo: number }[];
  costo_usd_fichas_nuevas: number;
}

interface Feat {
  id: string;
  familia: string;
  ficha: FichaExtraction;
  vector: number[];
}

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);

// ---------------------------------------------------------------------------------------------
// Embeddings de texto (contenedor ML) con caché
// ---------------------------------------------------------------------------------------------

const TEXT_CACHE = resolve(CACHE_DIR, "text-embed.json");

async function embedPassages(texts: string[]): Promise<{ model: string; vectors: number[][] }> {
  const cache: Record<string, { model: string; v: number[] }> = existsSync(TEXT_CACHE) ? JSON.parse(readFileSync(TEXT_CACHE, "utf8")) : {};
  const key = (t: string) => createHash("sha256").update(`passage\u0000${t}`).digest("hex");
  const faltan = [...new Set(texts.filter((t) => !cache[key(t)]))];
  let model = Object.values(cache)[0]?.model ?? "";
  if (faltan.length) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.ML_TOKEN) headers["x-ml-token"] = process.env.ML_TOKEN;
    const res = await fetch(`${ML_URL}/text/embed`, { method: "POST", headers, body: JSON.stringify({ texts: faltan, kind: "passage" }) });
    if (!res.ok) throw new Error(`ML /text/embed respondió ${res.status}`);
    const d = (await res.json()) as { model: string; vectors: number[][] };
    model = d.model;
    faltan.forEach((t, i) => (cache[key(t)] = { model: d.model, v: d.vectors[i]! }));
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(TEXT_CACHE, JSON.stringify(cache));
  }
  return { model, vectors: texts.map((t) => cache[key(t)]!.v) };
}

// ---------------------------------------------------------------------------------------------
// Fichas de los casos del demo (mismas piezas que sube demo:seed)
// ---------------------------------------------------------------------------------------------

function demoPiezas(): { code: string; piezas: PiezaEvidencia[] }[] {
  // Fecha fija para que la entrada (y la caché) no cambie de un día a otro.
  const demo = loadDemo(new Date("2026-11-02T12:00:00-05:00"));
  const audios = JSON.parse(readFileSync(resolve(DEMO_DIR, "guiones-audio.json"), "utf8")).audios as Record<string, { texto: string }>;
  return demo.casos.map((c) => {
    const origen = demo.identificadores[`contacto_${c.code}`] ?? null;
    const piezas: PiezaEvidencia[] = c.evidencia.map((e, i) => {
      const label = evidenceLabel(c.code, i + 1);
      if (e.tipo === "audio") {
        const nombre = e.archivo!.replace(/^audio\//, "").replace(/\.ogg$/, "");
        return { label, tipo: "audio", recibido: e.captured_at, origen, contenido: `[Hablante A] ${audios[nombre]!.texto}` };
      }
      if (e.tipo === "imagen") {
        return {
          label,
          tipo: "imagen",
          recibido: e.captured_at,
          origen,
          contenido: "Lectura de imagen: mostrador de una bodega con una bala encima y una nota escrita a mano que dice 'LOS X. 48 HORAS'.",
        };
      }
      return { label, tipo: "texto", recibido: e.captured_at, origen, contenido: e.texto ?? "" };
    });
    piezas.push({ label: evidenceLabel(c.code, piezas.length + 1), tipo: "relato", recibido: null, origen: null, contenido: c.relato });
    return { code: c.code, piezas };
  });
}

// ---------------------------------------------------------------------------------------------
// Voz de los casos del demo (contenedor ML)
// ---------------------------------------------------------------------------------------------

async function demoVoiceCentroid(files: string[]): Promise<number[]> {
  const headers: Record<string, string> = process.env.ML_TOKEN ? { "x-ml-token": process.env.ML_TOKEN } : {};
  const segs: number[][] = [];
  for (const f of files) {
    const wav = await fetch(`${ML_URL}/audio/normalize`, { method: "POST", headers, body: readFileSync(resolve(DEMO_DIR, f)) });
    if (!wav.ok) throw new Error(`ML /audio/normalize respondió ${wav.status}`);
    const b64 = Buffer.from(await wav.arrayBuffer()).toString("base64");
    const r = await fetch(`${ML_URL}/voice/embed`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ wav_b64: b64, turns: null, exclude_vectors: [] }),
    });
    if (!r.ok) throw new Error(`ML /voice/embed respondió ${r.status}`);
    const d = (await r.json()) as { speakers: { segments: { vector: number[] }[] }[] };
    for (const s of d.speakers[0]?.segments ?? []) segs.push(s.vector);
  }
  const m = segs[0]!.map((_, i) => segs.reduce((s, v) => s + v[i]!, 0) / segs.length);
  const n = Math.hypot(...m);
  return m.map((x) => x / n);
}

// ---------------------------------------------------------------------------------------------
// Calibración
// ---------------------------------------------------------------------------------------------

function stats(x: number[]) {
  const n = x.length;
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const sorted = [...x].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))]!;
  return { n, media: mean, std: sd, min: sorted[0]!, p05: q(0.05), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[n - 1]! };
}

/** Igual que calibracion_gaussiana de py/blindaje_eval/voice_eval.py. */
export function calibracionGaussiana(tar: number[], non: number[]): { a: number; b: number } {
  const t = stats(tar);
  const o = stats(non);
  const [m1, s1, m0, s0] = [t.media, t.std, o.media, o.std];
  const A = -1 / (2 * s1 ** 2) + 1 / (2 * s0 ** 2);
  const B = m1 / s1 ** 2 - m0 / s0 ** 2;
  const C = -(m1 ** 2) / (2 * s1 ** 2) + m0 ** 2 / (2 * s0 ** 2) + Math.log(s0 / s1);
  let root: number;
  if (Math.abs(A) < 1e-12) root = -C / B;
  else {
    const disc = Math.max(B * B - 4 * A * C, 0);
    const roots = [(-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)];
    const dentro = roots.filter((r) => r >= Math.min(m0, m1) && r <= Math.max(m0, m1));
    root = dentro[0] ?? roots.sort((x, y) => Math.abs(x - (m0 + m1) / 2) - Math.abs(y - (m0 + m1) / 2))[0]!;
  }
  return { a: 2 * A * root + B, b: root };
}

const logit = (p: number) => Math.log(p / (1 - p));

function moX(fa: FichaExtraction, fb: FichaExtraction, cos: number) {
  const frases = commonPhrases(fa.frases_firma ?? [], fb.frases_firma ?? []);
  const mismoCanal = Boolean(fa.canal_pago && fa.canal_pago === fb.canal_pago);
  const mismoGrupo = sameGroup(fa.grupo_que_dice_ser, fb.grupo_que_dice_ser);
  const x = cos + 0.05 * Math.min(frases.length, 3) + (mismoCanal ? 0.03 : 0) + (mismoGrupo ? 0.05 : 0);
  return { x, frases, mismoCanal, mismoGrupo, input: { similitud_texto: cos, frases_comunes: frases.length, mismo_canal_pago: mismoCanal, mismo_grupo: mismoGrupo } };
}

export async function runMoEval(cal: Calibration): Promise<{ report: MoReport; mo: Calibration["mo"] | null }> {
  const base: MoReport = {
    estado: "pendiente",
    formula: "x = coseno(resumen_mo) + 0.05·min(frases comunes, 3) + 0.03·mismo canal + 0.05·mismo grupo; p = min(logística(x, a, b), p_max)",
    pares: { mismo_guion: 0, distintos: 0 },
    costo_usd_fichas_nuevas: 0,
  };
  try {
    const h = await fetch(`${ML_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!h.ok) throw new Error(String(h.status));
  } catch {
    return { report: { ...base, motivo: `El contenedor ML no responde en ${ML_URL} (hace falta /text/embed).` }, mo: null };
  }

  // 1) Fichas
  const file = loadGuiones();
  let costo = 0;
  const fichasG = await pool(file.guiones, 4, async (g) => {
    const { data, cache } = await extractFicha(g);
    if (!cache) costo += data.cost_usd;
    return { id: g.id, familia: g.familia, ficha: data.output };
  });
  const fichasD = await pool(demoPiezas(), 4, async (d) => {
    const { data, cache } = await extractFichaPiezas(`DEMO-${d.code}`, d.piezas);
    if (!cache) costo += data.cost_usd;
    return { id: d.code, familia: "demo", ficha: data.output };
  });

  // 2) Embeddings del resumen_mo
  const todas = [...fichasG, ...fichasD];
  const { model, vectors } = await embedPassages(todas.map((f) => f.ficha.resumen_mo));
  const feats: Feat[] = todas.map((f, i) => ({ ...f, vector: vectors[i]! }));
  const G = feats.filter((f) => f.familia !== "demo");
  const D = new Map(feats.filter((f) => f.familia === "demo").map((f) => [f.id, f]));

  // 3) Pares de guiones
  const same: number[] = [];
  const diff: number[] = [];
  const cosSame: number[] = [];
  const cosDiff: number[] = [];
  for (let i = 0; i < G.length; i++)
    for (let j = i + 1; j < G.length; j++) {
      const a = G[i]!;
      const b = G[j]!;
      const cos = dot(a.vector, b.vector);
      const { x } = moX(a.ficha, b.ficha, cos);
      const mismo = a.familia === b.familia && a.familia !== "sin_grupo";
      (mismo ? same : diff).push(x);
      (mismo ? cosSame : cosDiff).push(cos);
    }

  // 4) Calibración
  const pCrit = 1 - (1 - cal.thresholds.probable) / (1 - cal.voz.p_max);
  const g = calibracionGaussiana(same, diff);
  const q99 = stats(diff).p99;
  const bRestr = q99 - logit(pCrit) / g.a;
  const pMax = cal.mo.p_max;
  const propuesta = { a: +g.a.toFixed(3), b: +Math.max(g.b, bRestr).toFixed(4), p_max: pMax };
  const evalCal = (a: number, b: number) => {
    const p = (x: number) => Math.min(logistic(x, a, b), pMax);
    return {
      a,
      b,
      mismo_guion_alcanzan_p_crit: same.filter((x) => p(x) >= pCrit).length / same.length,
      distintos_alcanzan_p_crit: diff.filter((x) => p(x) >= pCrit).length / diff.length,
      mo_max: Math.max(...[...same, ...diff].map(p)),
    };
  };
  const comparacion = {
    anterior: evalCal(cal.mo.a, cal.mo.b),
    propuesta_pipeline: evalCal(40, 1.0),
    propuesta: evalCal(propuesta.a, propuesta.b),
  };
  const calNueva: Calibration = { ...cal, mo: propuesta };

  // Consistencia: la x de esta evaluación produce exactamente la p de moProbability del pipeline.
  const a0 = G[0]!;
  const b0 = G[1]!;
  const chk = moX(a0.ficha, b0.ficha, dot(a0.vector, b0.vector));
  if (Math.abs(moProbability(chk.input, calNueva) - Math.min(logistic(chk.x, propuesta.a, propuesta.b), pMax)) > 1e-12) {
    throw new Error("La fórmula de la evaluación no coincide con moProbability del pipeline");
  }

  // 5) Verificaciones con el demo
  const pmo = (x: string, y: string, c: Calibration) => {
    const a = D.get(x)!;
    const b = D.get(y)!;
    const r = moX(a.ficha, b.ficha, dot(a.vector, b.vector));
    return { p: moProbability(r.input, c), r, cos: dot(a.vector, b.vector) };
  };
  const vA = await demoVoiceCentroid(["audio/A1.ogg", "audio/A2.ogg"]);
  const vB = await demoVoiceCentroid(["audio/B1.ogg"]);
  const vozCos = dot(vA, vB);
  const pVoz = Math.min(logistic(vozCos, cal.voz.a, cal.voz.b), cal.voz.p_max);
  const ab = pmo("A", "B", calNueva);
  const abAnterior = pmo("A", "B", cal);
  const scoreAB = combineSignals([pVoz, ab.p]);

  const pMoDiff = diff.map((x) => Math.min(logistic(x, propuesta.a, propuesta.b), pMax));
  const llegan = pMoDiff.filter((p) => combineSignals([cal.voz.p_max, p]) >= cal.thresholds.probable).length;
  const demoDistintos = [["A", "C"], ["B", "C"]].map(([x, y]) => {
    const r = pmo(x!, y!, calNueva);
    const s = combineSignals([cal.voz.p_max, r.p]);
    return { par: `${x}–${y}`, p_mo: r.p, score_con_voz_al_tope: s, estado: statusForScore(s, calNueva) };
  });
  const moMax = comparacion.propuesta.mo_max;
  const codes = [...D.keys()].sort();
  const demoPares: MoReport["demo_pares"] = [];
  for (let i = 0; i < codes.length; i++)
    for (let j = i + 1; j < codes.length; j++) {
      const r = pmo(codes[i]!, codes[j]!, calNueva);
      demoPares.push({
        par: `${codes[i]}–${codes[j]}`,
        similitud_texto: +r.cos.toFixed(4),
        frases_comunes: r.r.frases,
        mismo_canal: r.r.mismoCanal,
        mismo_grupo: r.r.mismoGrupo,
        p_mo: +r.p.toFixed(4),
      });
    }

  const report: MoReport = {
    ...base,
    estado: "ok",
    modelo_texto: model,
    pares: { mismo_guion: same.length, distintos: diff.length },
    distribuciones: { x_mismo_guion: stats(same), x_distintos: stats(diff) },
    coseno_texto: { mismo_guion: stats(cosSame), distintos: stats(cosDiff) },
    calibracion: { a: propuesta.a, b: propuesta.b, p_max: pMax, b_gauss: g.b, b_restringido: bRestr, p_crit: pCrit, x_percentil_99_distintos: q99 },
    comparacion,
    verificaciones: {
      a_demo_AB: {
        voz_coseno: vozCos,
        p_voz: pVoz,
        p_mo: ab.p,
        score: scoreAB,
        estado: statusForScore(scoreAB, calNueva),
        cumple: scoreAB >= cal.thresholds.probable,
        con_calibracion_anterior: combineSignals([pVoz, abAnterior.p]),
      },
      b_voz_sola_guion_distinto: {
        pares_guiones: diff.length,
        llegan_a_probable: llegan,
        tasa: llegan / diff.length,
        demo: demoDistintos,
        cumple: demoDistintos.every((d) => d.score_con_voz_al_tope < cal.thresholds.probable) && llegan / diff.length <= 0.01,
      },
      c_mo_solo: { mo_max: moMax, estado_max: statusForScore(moMax, calNueva), cumple: statusForScore(moMax, calNueva) === "descartado_auto" },
    },
    demo_pares: demoPares,
    costo_usd_fichas_nuevas: costo,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    resolve(RESULTS_DIR, "mo.json"),
    JSON.stringify({ report, guiones: Object.fromEntries(G.map((f) => [f.id, { ficha: f.ficha, vector: f.vector }])) }),
  );
  return { report, mo: propuesta };
}
