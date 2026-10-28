/**
 * Lee eval/report.json en tiempo de build. Si no existe o no se puede leer, devuelve null y la
 * landing muestra el marcador "[resultados de la evaluación]". Nunca inventa números.
 *
 * Formato principal (schema 1.0 de eval/README.md): `resumen[]` con
 *   { id, nombre, nombre_en, valor, unidad: "proporcion" | "por_100" | "conteo" | "pasa",
 *     meta: { texto }, estado: "ok" | "pendiente", nota, cumple }
 * más datos de detalle (`escenarios`, `imagenes`) de los que se toman dos resultados que no son
 * metas, para no mostrar solo lo favorable. Si no hay `resumen`, se acepta `metrics[]` o un objeto
 * `metrics` con { id, value, unit, n }.
 */
import fs from "node:fs";
import path from "node:path";
import type { Lang } from "../i18n/types";

export interface EvalMetric {
  id: string;
  value: number | boolean | string | null;
  unit: string | null;
  n: number | null;
  /** true si cumple la meta, false si no, null si no aplica o está pendiente. */
  meets: boolean | null;
  pending: boolean;
  note: string | null;
  label: Partial<Record<Lang, string>>;
  target: string | null;
}

export interface EvalReport {
  generatedAt: string | null;
  metrics: EvalMetric[];
  /** Resultados de detalle que no tienen meta en la sección 16. */
  extra: EvalMetric[];
}

/** ids del reporte → ids de la landing (los de i18n `results.metrics`). */
const ALIASES: Record<string, string> = {
  voz_top1: "voice_top1",
  voice_top_1: "voice_top1",
  voz_top3: "voice_top3",
  voice_top_3: "voice_top3",
  falsos_vinculos_100: "false_links_per_100",
  falsos_vinculos_por_100: "false_links_per_100",
  false_links: "false_links_per_100",
  identificadores: "identifier_match",
  identifiers: "identifier_match",
  ficha_campos: "ficha_accuracy",
  fichas: "ficha_accuracy",
  agentes_citas: "citation_fidelity",
  fidelidad_citas: "citation_fidelity",
  estadisticas_menos_5: "small_stats",
  privacy_small_stats: "small_stats",
  infiltrado: "infiltrator",
  infiltrator_test: "infiltrator",
};

const RATIO_UNITS = new Set(["ratio", "proporcion", "proportion"]);

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

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function fromResumen(items: unknown[]): EvalMetric[] {
  const out: EvalMetric[] = [];
  for (const item of items) {
    const o = obj(item);
    const rawId = o && str(o.id);
    if (!o || !rawId) continue;
    const unit = str(o.unidad);
    const raw = o.valor;
    let value: EvalMetric["value"] = null;
    if (unit === "pasa") value = raw === null || raw === undefined ? null : raw === true || raw === 1;
    else if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") value = raw;
    out.push({
      id: ALIASES[rawId] ?? rawId,
      value,
      unit,
      n: null,
      meets: typeof o.cumple === "boolean" ? o.cumple : null,
      pending: o.estado === "pendiente" || value === null,
      note: str(o.nota),
      label: { es: str(o.nombre) ?? undefined, en: str(o.nombre_en) ?? undefined },
      target: str(obj(o.meta)?.texto),
    });
  }
  return out;
}

/** Dos resultados de detalle, con su conteo, para que la sección no muestre solo lo favorable. */
function detailExtras(root: Record<string, unknown>): EvalMetric[] {
  const extra: EvalMetric[] = [];
  const esc = obj(root.escenarios);
  const recall = num(esc?.recall);
  if (esc && recall !== null) {
    const found = num(esc.verdaderos);
    const expected = num(esc.pares_esperados);
    extra.push({
      id: "scenario_recall",
      value: recall,
      unit: "proporcion",
      n: null,
      meets: null,
      pending: false,
      note: found !== null && expected !== null ? `${found}/${expected}` : null,
      label: {
        es: "Vínculos esperados que el motor encontró en los cinco escenarios (todas las señales)",
        en: "Expected links the engine found across the five scenarios (all signals)",
      },
      target: null,
    });
  }
  const img = obj(obj(root.imagenes)?.con_hamming_max_10);
  const reused = num(img?.reutilizadas_detectadas);
  if (reused !== null) {
    extra.push({
      id: "reused_images",
      value: reused,
      unit: "proporcion",
      n: null,
      meets: null,
      pending: false,
      note: null,
      label: {
        es: "Imágenes reutilizadas detectadas por hash perceptual tras reenvíos y capturas",
        en: "Reused images detected by perceptual hash after forwards and screenshots",
      },
      target: null,
    });
  }
  return extra;
}

function fromGeneric(m: unknown): EvalMetric[] {
  const out: EvalMetric[] = [];
  const push = (rawId: string, raw: unknown) => {
    const o = obj(raw);
    const value = o ? (o.value ?? o.result ?? o.score ?? null) : raw;
    if (value !== null && !["number", "boolean", "string"].includes(typeof value)) return;
    out.push({
      id: ALIASES[rawId] ?? rawId,
      value: value as EvalMetric["value"],
      unit: o ? str(o.unit) : null,
      n: o ? (num(o.n) ?? num(o.count)) : null,
      meets: o && typeof o.passed === "boolean" ? o.passed : null,
      pending: value === null,
      note: o ? str(o.note) : null,
      label: { es: o ? (str(o.label_es) ?? str(o.label) ?? undefined) : undefined, en: o ? (str(o.label_en) ?? undefined) : undefined },
      target: null,
    });
  };
  if (Array.isArray(m)) {
    for (const item of m) {
      const o = obj(item);
      const id = o && (str(o.id) ?? str(o.key) ?? str(o.name));
      if (o && id) push(id, o);
    }
  } else if (obj(m)) {
    for (const [id, v] of Object.entries(m as Record<string, unknown>)) push(id, v);
  }
  return out;
}

export function readEvalReport(): EvalReport | null {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(reportPath(), "utf8"));
  } catch {
    return null;
  }
  const root = obj(data);
  if (!root) return null;
  const metrics = Array.isArray(root.resumen) ? fromResumen(root.resumen) : fromGeneric(root.metrics);
  if (metrics.length === 0) return null;
  return {
    generatedAt: str(root.generado) ?? str(root.generated_at) ?? str(root.generatedAt),
    metrics,
    extra: Array.isArray(root.resumen) ? detailExtras(root) : [],
  };
}

/** Formatea un valor tal como vino, sin redondeos que cambien su sentido. */
export function formatValue(metric: EvalMetric, lang: Lang, words: { passed: string; failed: string }): string {
  const { value, unit } = metric;
  if (typeof value === "boolean") return value ? words.passed : words.failed;
  if (typeof value === "string") return value;
  if (value === null) return "";
  const locale = lang === "es" ? "es-PE" : "en-US";
  if (unit && RATIO_UNITS.has(unit)) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value * 100)}%`;
  }
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  if (unit === "%" || unit === "percent") return `${formatted}%`;
  return formatted;
}
