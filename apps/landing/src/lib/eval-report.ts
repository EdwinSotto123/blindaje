/**
 * Lee eval/report.json en tiempo de build. Si no existe o no se puede leer, devuelve null y la
 * landing muestra el marcador "[resultados de la evaluación]". Nunca inventa números.
 *
 * Formato preferido (lo produce el frente de evaluación):
 *   {
 *     "generated_at": "2026-11-02T18:00:00Z",
 *     "metrics": [
 *       { "id": "voice_top1", "value": 0.83, "unit": "ratio", "n": 120 },
 *       { "id": "false_links_per_100", "value": 1.2, "n": 400 },
 *       { "id": "infiltrator", "value": true }
 *     ]
 *   }
 * También acepta `metrics` como objeto { id: valor | { value, unit, n } } y etiquetas propias
 * (`label_es`, `label_en`) para métricas que la landing no conoce.
 */
import fs from "node:fs";
import path from "node:path";
import type { Lang } from "../i18n/types";

export interface EvalMetric {
  id: string;
  value: number | boolean | string | null;
  unit: string | null;
  n: number | null;
  passed: boolean | null;
  label: Partial<Record<Lang, string>>;
}

export interface EvalReport {
  generatedAt: string | null;
  metrics: EvalMetric[];
}

/** Sinónimos de ids que el reporte podría usar, normalizados a los ids de la landing. */
const ALIASES: Record<string, string> = {
  voz_top1: "voice_top1",
  voice_top_1: "voice_top1",
  voz_top3: "voice_top3",
  voice_top_3: "voice_top3",
  falsos_vinculos_por_100: "false_links_per_100",
  false_links: "false_links_per_100",
  identificadores: "identifier_match",
  identifiers: "identifier_match",
  identifier_exact_match: "identifier_match",
  fichas: "ficha_accuracy",
  ficha_field_accuracy: "ficha_accuracy",
  fidelidad_citas: "citation_fidelity",
  citations: "citation_fidelity",
  privacy_small_stats: "small_stats",
  estadisticas_menos_de_5: "small_stats",
  infiltrado: "infiltrator",
  infiltrator_test: "infiltrator",
};

/** Métricas que son proporciones: un valor entre 0 y 1 sin unidad se muestra como porcentaje. */
const RATIO_IDS = new Set(["voice_top1", "voice_top3", "identifier_match", "ficha_accuracy", "citation_fidelity"]);

function reportPath(): string {
  const fromEnv = process.env.EVAL_REPORT_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  // `astro build` corre con cwd en apps/landing.
  return path.resolve(process.cwd(), "../../eval/report.json");
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function toMetric(rawId: string, raw: unknown): EvalMetric | null {
  const id = ALIASES[rawId] ?? rawId;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") {
    return { id, value: raw, unit: null, n: null, passed: null, label: {} };
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const value = o.value ?? o.result ?? o.score ?? null;
  if (value !== null && !["number", "boolean", "string"].includes(typeof value)) return null;
  return {
    id,
    value: value as EvalMetric["value"],
    unit: str(o.unit),
    n: num(o.n) ?? num(o.count) ?? num(o.samples),
    passed: typeof o.passed === "boolean" ? o.passed : typeof o.pass === "boolean" ? o.pass : null,
    label: {
      es: str(o.label_es) ?? str(o.label) ?? undefined,
      en: str(o.label_en) ?? undefined,
    },
  };
}

export function readEvalReport(): EvalReport | null {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(reportPath(), "utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const metrics: EvalMetric[] = [];
  const m = root.metrics;
  if (Array.isArray(m)) {
    for (const item of m) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = str(o.id) ?? str(o.key) ?? str(o.name);
      if (!id) continue;
      const metric = toMetric(id, o);
      if (metric) metrics.push(metric);
    }
  } else if (m && typeof m === "object") {
    for (const [id, v] of Object.entries(m as Record<string, unknown>)) {
      const metric = toMetric(id, v);
      if (metric) metrics.push(metric);
    }
  }
  if (metrics.length === 0) return null;
  return {
    generatedAt: str(root.generated_at) ?? str(root.generatedAt) ?? null,
    metrics,
  };
}

/** Formatea un valor tal como vino, sin redondeos que cambien su sentido. */
export function formatValue(metric: EvalMetric, lang: Lang, words: { passed: string; failed: string }): string {
  const { value, unit } = metric;
  if (typeof value === "boolean") return value ? words.passed : words.failed;
  if (typeof value === "string") return value;
  if (value === null) return "";
  const locale = lang === "es" ? "es-PE" : "en-US";
  const isRatio = unit === "ratio" || (unit === null && RATIO_IDS.has(metric.id) && value >= 0 && value <= 1);
  if (isRatio) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value * 100)}%`;
  }
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  if (unit === "%" || unit === "percent") return `${formatted}%`;
  return unit ? `${formatted} ${unit}` : formatted;
}
