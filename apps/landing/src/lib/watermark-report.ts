/**
 * Lee eval/results/watermark.json en tiempo de build (evaluación del rastreo de filtraciones, PLAN
 * D14). Si no existe o no se puede leer, devuelve null y la landing no muestra el bloque. Nunca
 * inventa números: cada resultado sale de `atribucion_con_regla` y `n` de una transformación.
 */
import fs from "node:fs";
import path from "node:path";

export interface WatermarkRow {
  /** "audio.whatsapp_opus_16k", "imagen.whatsapp"… (la clave del reporte). */
  id: string;
  ok: number;
  n: number;
  ratio: number;
}

export interface WatermarkReport {
  generatedAt: string | null;
  recipients: number | null;
  rows: WatermarkRow[];
  /** Medios sin marca que el rastreo atribuyó por error, sumando todas las transformaciones. */
  falseAudio: { wrong: number; n: number } | null;
  falseImage: { wrong: number; n: number } | null;
}

function reportPath(): string {
  const fromEnv = process.env.WATERMARK_REPORT_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "../../eval/results/watermark.json");
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function marked(root: Record<string, unknown>, media: "audio" | "imagen", key: string): WatermarkRow | null {
  const t = obj(obj(obj(root[media])?.con_marca)?.[key]);
  const n = num(t?.n);
  const ratio = num(t?.atribucion_con_regla);
  if (!t || n === null || ratio === null) return null;
  return { id: `${media}.${key}`, ok: Math.round(ratio * n), n, ratio };
}

function falses(root: Record<string, unknown>, media: "audio" | "imagen"): { wrong: number; n: number } | null {
  const all = obj(obj(root[media])?.sin_marca);
  if (!all) return null;
  let wrong = 0;
  let n = 0;
  for (const t of Object.values(all)) {
    const o = obj(t);
    const tn = num(o?.n);
    const r = num(o?.falsa_atribucion_con_regla);
    if (tn === null || r === null) return null;
    n += tn;
    wrong += Math.round(r * tn);
  }
  return n > 0 ? { wrong, n } : null;
}

/** Las transformaciones que se muestran, en este orden: lo que pasa en la vida real y los límites. */
const SHOWN: [media: "audio" | "imagen", key: string][] = [
  ["audio", "whatsapp_opus_16k"],
  ["imagen", "whatsapp"],
  ["imagen", "recorte_10_whatsapp"],
  ["imagen", "captura_png"],
  ["imagen", "captura_whatsapp"],
  ["audio", "fragmento_6s_opus_16k"],
  ["audio", "opus_8k"],
];

export function readWatermarkReport(): WatermarkReport | null {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(reportPath(), "utf8"));
  } catch {
    return null;
  }
  const root = obj(data);
  if (!root) return null;
  const rows = SHOWN.map(([m, k]) => marked(root, m, k)).filter((r): r is WatermarkRow => r !== null);
  if (rows.length === 0) return null;
  return {
    generatedAt: typeof root.generado === "string" ? root.generado : null,
    recipients: num(root.destinatarios_simulados),
    rows,
    falseAudio: falses(root, "audio"),
    falseImage: falses(root, "imagen"),
  };
}
