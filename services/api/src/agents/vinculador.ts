import {
  DEFAULT_CALIBRATION,
  fichaLabel,
  VINCULADOR_SYSTEM,
  VinculadorOutput,
  type Calibration,
  type FichaStored,
  type NivelAutenticidad,
  type Signals,
} from "@blindaje/shared";
import type { Env } from "../env";
import { costCacheKey, withCostCache } from "../costs";
import { sha256Hex } from "../lib/crypto";
import { parseJsonColumn } from "../lib/db";
import type { CandidatePair } from "../linking";
import type { TranscripcionContent } from "../pipeline/types";
import { metaClientFor, runCheckedAgent } from "./common";

/**
 * Vinculador (sección 10.2): evalúa un par candidato del motor, ajusta el puntaje cuando ve
 * contradicciones o refuerzos y redacta la explicación con citas. Entrada: las dos fichas
 * (FICHA-…), las señales con sus probabilidades y los fragmentos de transcripción relevantes con su
 * etiqueta EV-… y su huella V-n. Salida `VinculadorOutput` strict, validada con el validador de
 * citas (solo puede citar etiquetas del material que recibe). También recibe la autenticidad de la
 * evidencia con indicios y, si la voz bajó por voz sintética, el aviso en la señal de voz.
 *
 * El puntaje final lo fija el motor: min(puntaje_ajustado, score_raw + 0.05) (ver `finalScore`).
 */

export const VINCULADOR_MODEL = "muse-spark-1.3";
const EFFORT = "low" as const;

interface CaseInfo {
  id: string;
  code: string;
  is_demo: number;
  ficha: FichaStored | null;
  evidence: Array<{ id: string; label: string; tipo: string; autenticidad: NivelAutenticidad | null }>;
}

async function loadCase(env: Env, caseId: string): Promise<CaseInfo | null> {
  const c = await env.DB.prepare("SELECT id, code, is_demo, ficha_json FROM cases WHERE id = ?")
    .bind(caseId)
    .first<{ id: string; code: string; is_demo: number; ficha_json: string | null }>();
  if (!c) return null;
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.label, e.tipo,
       (SELECT json_extract(d.content_json, '$.nivel') FROM derivatives d WHERE d.evidence_id = e.id AND d.tipo = 'autenticidad' LIMIT 1) AS autenticidad
     FROM evidence e WHERE e.case_id = ? ORDER BY e.seq`,
  )
    .bind(caseId)
    .all<{ id: string; label: string; tipo: string; autenticidad: NivelAutenticidad | null }>();
  return { id: c.id, code: c.code, is_demo: c.is_demo, ficha: parseJsonColumn<FichaStored>(c.ficha_json), evidence: results };
}

const NIVEL_TEXTO: Record<NivelAutenticidad, string> = {
  sin_senales: "sin señales de IA (no prueba que sea real)",
  indicios_debiles: "indicios débiles de IA o manipulación",
  indicios_fuertes: "indicios fuertes de IA o manipulación",
  generado_ia_confirmado: "generado con IA según su marca de agua o C2PA",
};

/** Autenticidad de la evidencia de ambos casos que tiene indicios (las que no, se omiten). */
function describeAuthenticity(cases: CaseInfo[]): string[] {
  return cases.flatMap((c) =>
    c.evidence
      .filter((e) => e.autenticidad && e.autenticidad !== "sin_senales")
      .map((e) => `- ${e.label} (${e.tipo}): ${NIVEL_TEXTO[e.autenticidad!]}.`),
  );
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const pct = (p: number) => p.toFixed(2);

/** Describe las señales en texto, con las etiquetas citables. */
export function describeSignals(s: Signals): string[] {
  const out: string[] = [];
  if (s.identificador) {
    const ids = s.identificador.compartidos.map((c) => `${c.ref} (${c.tipo}, termina en ${c.ultimos_3}; evidencia ${c.evidencia.join(", ") || "sin etiqueta"})`);
    out.push(`- Identificador idéntico (HMAC): p=${pct(s.identificador.p)}. Compartidos: ${ids.join("; ")}.`);
  }
  if (s.voz) {
    out.push(
      `- Voz: p=${pct(s.voz.p)}, coseno ${s.voz.similitud.toFixed(3)}${s.voz.z != null ? `, s-norm ${s.voz.z.toFixed(2)}` : ""}, ` +
        `${s.voz.segmentos} de ${s.voz.segmentos_total} segmentos de 3 s coinciden. Huellas comparadas: ${s.voz.huellas.join(", ")} ` +
        `(evidencia ${s.voz.evidencia.join(", ")}).`,
    );
    if (s.voz.voz_sintetica) {
      out.push(
        `  Ojo: ${s.voz.voz_sintetica.evidencia.join(", ")} tiene indicios fuertes de voz sintética o generada con IA (análisis de autenticidad). ` +
          `La p de voz ya se multiplicó por ${s.voz.voz_sintetica.factor} (era ${pct(s.voz.voz_sintetica.p_sin_ajuste)}): una voz sintética podría imitar a otra, ` +
          "así que la similitud de voz no prueba que hable la misma persona.",
      );
    }
  }
  if (s.modus_operandi) {
    const m = s.modus_operandi;
    out.push(
      `- Modus operandi: p=${pct(m.p)}, similitud del resumen ${m.similitud_texto.toFixed(3)}, frases firma comunes: ` +
        `${m.frases_comunes.length ? m.frases_comunes.map((f) => `"${f}"`).join(", ") : "ninguna"}; mismo canal de pago: ${m.mismo_canal_pago ? "sí" : "no"}; ` +
        `mismo grupo que dice ser: ${m.mismo_grupo ? "sí" : "no"}.`,
    );
  }
  if (s.imagen) {
    out.push(
      `- Imagen: p=${pct(s.imagen.p)}, distancia de Hamming mínima ${s.imagen.hamming_min ?? "sin dato"}, DINOv2 máximo ${s.imagen.dino_max ?? "sin dato"}. ` +
        `Recortes: ${s.imagen.recortes.join(", ")} (evidencia ${s.imagen.evidencia.join(", ")}).`,
    );
  }
  return out;
}

/** Fragmentos de transcripción de los segmentos de voz que coinciden (sin turnos de la víctima). */
async function voiceFragments(env: Env, signals: Signals): Promise<string[]> {
  const segs = signals.voz?.segmentos_coincidentes ?? [];
  const out: string[] = [];
  const cache = new Map<string, TranscripcionContent | null>();
  for (const s of segs) {
    if (!cache.has(s.evidence_id)) {
      const row = await env.DB.prepare("SELECT content_json FROM derivatives WHERE evidence_id = ? AND tipo = 'transcripcion' LIMIT 1")
        .bind(s.evidence_id)
        .first<{ content_json: string | null }>();
      cache.set(s.evidence_id, parseJsonColumn<TranscripcionContent>(row?.content_json));
    }
    const text = (cache.get(s.evidence_id)?.turns ?? [])
      .filter((t) => !t.es_victima && t.end_ms > s.start_ms && t.start_ms < s.end_ms)
      .map((t) => t.text.trim())
      .join(" ")
      .trim();
    out.push(`[${s.evidencia} · ${s.huella} · ${mmss(s.start_ms)}–${mmss(s.end_ms)}] ${text ? `«${text}»` : "(sin texto en ese tramo)"}`);
  }
  return out;
}

function fichaBlock(c: CaseInfo): string {
  if (!c.ficha) return `${fichaLabel(c.code)}: sin ficha todavía.`;
  const { caso: _c, ...f } = c.ficha;
  return `${fichaLabel(c.code)} (caso ${c.code}):\n${JSON.stringify(f, null, 1)}`;
}

export interface VinculadorMaterial {
  input: string;
  known: Set<string>;
}

/** Arma el mensaje del Vinculador y el conjunto de etiquetas que puede citar. */
export async function vinculadorMaterial(env: Env, pair: CandidatePair, cal: Calibration): Promise<VinculadorMaterial | null> {
  const [a, b] = await Promise.all([loadCase(env, pair.case_id), loadCase(env, pair.other_case_id)]);
  if (!a || !b) return null;
  const known = new Set<string>([fichaLabel(a.code), fichaLabel(b.code), ...a.evidence.map((e) => e.label), ...b.evidence.map((e) => e.label)]);
  for (const f of [a.ficha, b.ficha]) for (const i of f?.identificadores ?? []) known.add(i.ref);
  const s = pair.signals;
  for (const h of s.voz?.huellas ?? []) known.add(h);
  for (const c of s.identificador?.compartidos ?? []) known.add(c.ref);
  for (const r of s.imagen?.recortes ?? []) known.add(r);

  const fragments = await voiceFragments(env, s);
  const authenticity = describeAuthenticity([a, b]);
  const demo = a.is_demo === 1 || b.is_demo === 1;
  const input = [
    `Par candidato: caso ${a.code} (${fichaLabel(a.code)}) y caso ${b.code} (${fichaLabel(b.code)}).${demo ? " Contenido ficticio de demostración." : ""}`,
    "",
    `Señales del motor (probabilidades calibradas, calibración ${cal.version}):`,
    ...describeSignals(s),
    `Puntaje combinado del motor: ${pair.score_raw.toFixed(3)} (probable >= ${cal.thresholds.probable}, por revisar >= ${cal.thresholds.revisar}).`,
    "",
    "Criterios del motor para leer las señales:",
    "- Que los números de contacto o las cuentas sean distintos NO es una contradicción: quien extorsiona cambia de chip y de cuenta. Un identificador idéntico sí es una señal fuerte.",
    "- Que las víctimas sean de otro sector o de otra zona tampoco contradice: una misma banda cobra a negocios distintos en varios distritos.",
    "- Contradicciones reales: guiones, montos, canales de pago o formas de operar incompatibles entre sí, o voces claramente distintas cuando la voz es la señal principal.",
    "- La similitud del resumen es alta entre casi todos los casos de extorsión: pesa poco frente a frases firma comunes.",
    "- Autenticidad: una voz sintética podría imitar a otra, así que con indicios de voz sintética la similitud de voz pesa menos. Una imagen hecha con IA que se repite en dos casos sigue siendo una señal de plantilla común. Son indicios, no prueba.",
    "",
    fichaBlock(a),
    "",
    fichaBlock(b),
    "",
    "Fragmentos de transcripción de los segmentos de voz que coinciden:",
    ...(fragments.length ? fragments : ["(ninguno)"]),
    "",
    "Autenticidad de la evidencia (¿hecha con IA o manipulada?):",
    ...(authenticity.length ? authenticity : ["(ninguna evidencia con indicios)"]),
    "",
    `Evidencia del caso ${a.code}: ${a.evidence.map((e) => `${e.label} (${e.tipo})`).join(", ") || "ninguna"}.`,
    `Evidencia del caso ${b.code}: ${b.evidence.map((e) => `${e.label} (${e.tipo})`).join(", ") || "ninguna"}.`,
    `Identificadores que puedes citar: ${[...known].join(", ")}.`,
    "Devuelve el JSON con el esquema indicado. puntaje_ajustado va entre 0 y 1.",
  ].join("\n");
  return { input, known };
}

export interface VinculadorResult {
  output: VinculadorOutput;
  valid: boolean;
  run_id: string;
}

export async function runVinculador(env: Env, pair: CandidatePair, calibration: Calibration = DEFAULT_CALIBRATION): Promise<VinculadorResult | null> {
  const material = await vinculadorMaterial(env, pair, calibration);
  if (!material) return null;
  const meta = metaClientFor(env, { case_id: pair.case_id });
  const run = await runCheckedAgent<VinculadorOutput>(env, {
    agent: "vinculador",
    model: VINCULADOR_MODEL,
    target_type: "par",
    target_id: [pair.case_id, pair.other_case_id].sort().join("|"),
    known: material.known,
    attempt: async (feedback) => {
      const text = feedback ? `${material.input}\n\n${feedback}` : material.input;
      const cacheKey = await costCacheKey(await sha256Hex(text), "vinculador", `${VINCULADOR_MODEL}:${EFFORT}`);
      const r = await withCostCache(env, { cache_key: cacheKey, model: VINCULADOR_MODEL, operation: "vinculador", case_id: pair.case_id }, async () => {
        const p = await meta.responses.parse(
          {
            model: VINCULADOR_MODEL,
            instructions: VINCULADOR_SYSTEM,
            input: [{ role: "user", content: text }],
            schema: VinculadorOutput,
            schemaName: "vinculador",
            reasoningEffort: EFFORT,
            store: false,
          },
          { operation: "vinculador", context: { case_id: pair.case_id, cache_key: cacheKey } },
        );
        return { output: p.output, cost_usd: p.costUsd };
      });
      return { output: r.output, cost_usd: r.cost_usd, tool_calls: 0 };
    },
  });
  const inRange = Number.isFinite(run.output.puntaje_ajustado) && run.output.puntaje_ajustado >= 0 && run.output.puntaje_ajustado <= 1;
  return { output: run.output, valid: run.status === "ok" && inRange, run_id: run.run_id };
}
