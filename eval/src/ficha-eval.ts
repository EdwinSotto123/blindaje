import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FICHA_SYSTEM, FichaExtraction, PROMPT_VERSION, identifierGroup, normalizeIdentifier, type IdentifierType } from "@blindaje/shared";
import { zodTextFormat } from "@blindaje/meta-client";
import { CACHE_DIR } from "./env";
import { loadGuiones, type Etiqueta, type Guion } from "./data";
import { buildFichaInput, type PiezaEvidencia } from "./ficha-input";
import { metaClient } from "./meta";

/**
 * Exactitud de la ficha (sección 16.2): Muse Spark 1.3 con FICHA_SYSTEM, salida estructurada
 * strict de FichaExtraction y reasoning.effort "low", sobre 20 guiones ficticios. Cada campo
 * estructurado se compara con la etiqueta manual. Los campos de texto libre (amenaza, plazo,
 * resumen_mo) no se puntúan. Las respuestas se cachean en eval/data/cache/ficha/ por hash del
 * modelo, el prompt, el esquema y la entrada: correr de nuevo no vuelve a pagar.
 */

export const FICHA_MODEL = "muse-spark-1.3";
export const FICHA_EFFORT = "low" as const;

export const CAMPOS = [
  "sector",
  "primer_contacto",
  "tipo_amenaza",
  "monto_soles",
  "periodicidad",
  "plazo_horas",
  "canal_pago",
  "identificadores",
  "grupo_que_dice_ser",
  "frases_firma",
  "escalamiento",
  "fuentes",
] as const;
export type Campo = (typeof CAMPOS)[number];

export interface FichaCaseResult {
  guion: string;
  cache: boolean;
  cost_usd: number;
  latency_ms: number | null;
  campos: Record<Campo, { ok: boolean; esperado: unknown; obtenido: unknown }>;
  frases_recall: number;
  identificadores: { esperados: number; obtenidos: number; correctos: number; tipo_exacto: boolean };
  privacidad_ok: boolean;
  privacidad_fugas: string[];
  error?: string;
}

export interface FichaReport {
  estado: "ok" | "error" | "pendiente";
  motivo?: string;
  modelo: string;
  reasoning_effort: string;
  prompt_version: string;
  guiones: number;
  campos_puntuados: readonly string[];
  campos_no_puntuados: string[];
  exactitud_global: number | null;
  exactitud_por_campo: Record<string, number>;
  fichas_perfectas: number;
  frases_firma_recall: number | null;
  identificadores: { precision: number | null; recall: number | null; tipo_exacto: number | null };
  privacidad: { fichas_sin_datos_victima: number; total: number };
  costo_usd_corrida: number;
  costo_usd_total_cacheado: number;
  llamadas_nuevas: number;
  casos: FichaCaseResult[];
}

// ---------------------------------------------------------------------------------------------
// Comparadores
// ---------------------------------------------------------------------------------------------

export function normText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normText(s).split(" ").filter(Boolean);
}

export function fraseCoincide(label: string, cand: string): boolean {
  const L = normText(label);
  const C = normText(cand);
  if (!L || !C) return false;
  if (C.includes(L)) return true;
  const lt = tokens(label);
  const ct = tokens(cand);
  if (L.includes(C) && ct.length >= Math.ceil(0.6 * lt.length)) return true;
  const inter = lt.filter((t) => ct.includes(t)).length;
  const union = new Set([...lt, ...ct]).size;
  return union > 0 && inter / union >= 0.6;
}

function parseLima(iso: string): number | null {
  const s = /([+-]\d{2}:?\d{2}|Z)$/.test(iso) ? iso : `${iso}-05:00`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function idKey(tipo: IdentifierType, valor: string, rol: string): string | null {
  const n = normalizeIdentifier(tipo, valor);
  return n ? `${identifierGroup(tipo)}:${n}:${rol}` : null;
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

export function scoreFicha(etq: Etiqueta, out: FichaExtraction) {
  const alt = etq.alternativas ?? {};
  const eqOrAlt = (campo: string, esperado: unknown, obtenido: unknown) =>
    obtenido === esperado || (alt[campo] ?? []).some((v) => v === obtenido);

  const campos = {} as FichaCaseResult["campos"];
  const set = (c: Campo, ok: boolean, esperado: unknown, obtenido: unknown) => (campos[c] = { ok, esperado, obtenido });

  set("sector", eqOrAlt("sector", etq.sector, out.sector), etq.sector, out.sector);
  {
    const e = etq.primer_contacto ? parseLima(etq.primer_contacto) : null;
    const o = out.primer_contacto ? parseLima(out.primer_contacto) : null;
    const ok = e === null ? o === null : o !== null && Math.abs(e - o) <= 30 * 60 * 1000;
    set("primer_contacto", ok, etq.primer_contacto, out.primer_contacto);
  }
  set("tipo_amenaza", eqOrAlt("tipo_amenaza", etq.tipo_amenaza, out.tipo_amenaza), etq.tipo_amenaza, out.tipo_amenaza);
  set("monto_soles", eqOrAlt("monto_soles", etq.monto_soles, out.monto_soles), etq.monto_soles, out.monto_soles);
  set("periodicidad", eqOrAlt("periodicidad", etq.periodicidad, out.periodicidad), etq.periodicidad, out.periodicidad);
  set("plazo_horas", eqOrAlt("plazo_horas", etq.plazo_horas, out.plazo_horas), etq.plazo_horas, out.plazo_horas);
  set("canal_pago", eqOrAlt("canal_pago", etq.canal_pago, out.canal_pago), etq.canal_pago, out.canal_pago);

  // Identificadores: mismo grupo (tel/banco/placa), mismo valor normalizado y mismo rol.
  const esperados = new Set(etq.identificadores.map((i) => idKey(i.tipo, i.valor, i.rol)).filter(Boolean) as string[]);
  const obtenidos = new Set(out.identificadores.map((i) => idKey(i.tipo, i.valor, i.rol) ?? `invalido:${i.valor}`));
  const correctos = [...obtenidos].filter((k) => esperados.has(k)).length;
  const strictE = new Set(etq.identificadores.map((i) => `${i.tipo}:${normalizeIdentifier(i.tipo, i.valor)}:${i.rol}`));
  const strictO = new Set(out.identificadores.map((i) => `${i.tipo}:${normalizeIdentifier(i.tipo, i.valor)}:${i.rol}`));
  const tipoExacto = strictE.size === strictO.size && [...strictE].every((k) => strictO.has(k));
  set(
    "identificadores",
    correctos === esperados.size && obtenidos.size === esperados.size,
    etq.identificadores.map((i) => `${i.tipo}:${i.valor}:${i.rol}`),
    out.identificadores.map((i) => `${i.tipo}:${i.valor}:${i.rol}`),
  );

  {
    const e = etq.grupo_que_dice_ser;
    const o = out.grupo_que_dice_ser;
    let ok: boolean;
    if (e === null) ok = o === null || normText(o) === "";
    else if (o === null) ok = false;
    else {
      const et = tokens(e);
      const ot = tokens(o);
      ok = normText(e) === normText(o) || (et.every((t) => ot.includes(t)) && ot.length <= et.length + 2);
    }
    set("grupo_que_dice_ser", ok, e, o);
  }

  const hallados = etq.frases_firma.filter((f) => out.frases_firma.some((c) => fraseCoincide(f, c)));
  const frasesRecall = etq.frases_firma.length ? hallados.length / etq.frases_firma.length : 1;
  set("frases_firma", hallados.length === etq.frases_firma.length, etq.frases_firma, out.frases_firma);

  {
    const ef = etq.escalamiento.map((e) => e.fecha ?? "").sort();
    const of = out.escalamiento.map((e) => e.fecha ?? "").sort();
    const ok = ef.length === of.length && ef.every((f, i) => f === "" || f === of[i]);
    set("escalamiento", ok, etq.escalamiento, out.escalamiento.map((e) => ({ fecha: e.fecha, tipo: e.tipo })));
  }
  {
    const e = new Set(etq.fuentes);
    const o = new Set(out.fuentes);
    set("fuentes", e.size === o.size && [...e].every((x) => o.has(x)), etq.fuentes, out.fuentes);
  }

  // Privacidad: ningún dato de la víctima en la ficha (nombres, su número, DNI, puesto).
  const blob = JSON.stringify(out);
  const blobNorm = normText(blob);
  const blobDigits = digits(blob);
  const fugas = etq.datos_victima.filter((d) => {
    const dd = digits(d);
    if (dd.length >= 6) return blobDigits.includes(dd);
    return blobNorm.includes(normText(d));
  });

  return {
    campos,
    frasesRecall,
    identificadores: { esperados: esperados.size, obtenidos: obtenidos.size, correctos, tipo_exacto: tipoExacto },
    privacidad_ok: fugas.length === 0,
    privacidad_fugas: fugas,
  };
}

// ---------------------------------------------------------------------------------------------
// Llamada con caché
// ---------------------------------------------------------------------------------------------

export interface CachedFicha {
  key: string;
  ts: string;
  model: string;
  output: FichaExtraction;
  cost_usd: number;
  latency_ms: number;
  usage: unknown;
  response_id: string | null;
}

const FICHA_CACHE = resolve(CACHE_DIR, "ficha");

function cacheKey(input: string): string {
  const schema = JSON.stringify(zodTextFormat(FichaExtraction, "ficha"));
  return createHash("sha256")
    .update([FICHA_MODEL, FICHA_EFFORT, PROMPT_VERSION, FICHA_SYSTEM, schema, input].join("\u0000"))
    .digest("hex");
}

export async function extractFicha(g: Pick<Guion, "id" | "evidencia">): Promise<{ data: CachedFicha; cache: boolean }> {
  return extractFichaPiezas(g.id, g.evidencia);
}

/** Ficha de cualquier conjunto de piezas etiquetadas (guiones o casos del demo), con caché. */
export async function extractFichaPiezas(id: string, piezas: PiezaEvidencia[]): Promise<{ data: CachedFicha; cache: boolean }> {
  const g = { id, evidencia: piezas };
  mkdirSync(FICHA_CACHE, { recursive: true });
  const input = buildFichaInput(g.id, g.evidencia);
  const key = cacheKey(input);
  const path = resolve(FICHA_CACHE, `${g.id}-${key.slice(0, 16)}.json`);
  if (existsSync(path)) return { data: JSON.parse(readFileSync(path, "utf8")) as CachedFicha, cache: true };
  const t0 = Date.now();
  const r = await metaClient().responses.parse(
    {
      model: FICHA_MODEL,
      instructions: FICHA_SYSTEM,
      input: [{ role: "user", content: input }],
      schema: FichaExtraction,
      schemaName: "ficha",
      reasoningEffort: FICHA_EFFORT,
      store: false,
    },
    { operation: "eval_ficha", context: { guion: g.id } },
  );
  const data: CachedFicha = {
    key,
    ts: new Date().toISOString(),
    model: r.response.model || FICHA_MODEL,
    output: r.output,
    cost_usd: r.costUsd,
    latency_ms: Date.now() - t0,
    usage: r.usage,
    response_id: r.response.id ?? null,
  };
  writeFileSync(path, JSON.stringify(data, null, 2));
  return { data, cache: false };
}

export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

export async function runFichaEval(opts: { all?: boolean; dryRun?: boolean } = {}): Promise<FichaReport> {
  const file = loadGuiones();
  const ids = opts.all ? file.guiones.map((g) => g.id) : file.subconjunto_ficha;
  const guiones = ids.map((id) => {
    const g = file.guiones.find((x) => x.id === id);
    if (!g) throw new Error(`Guion ${id} no existe`);
    return g;
  });
  const base: FichaReport = {
    estado: "pendiente",
    modelo: FICHA_MODEL,
    reasoning_effort: FICHA_EFFORT,
    prompt_version: PROMPT_VERSION,
    guiones: guiones.length,
    campos_puntuados: CAMPOS,
    campos_no_puntuados: ["amenaza", "plazo", "resumen_mo"],
    exactitud_global: null,
    exactitud_por_campo: {},
    fichas_perfectas: 0,
    frases_firma_recall: null,
    identificadores: { precision: null, recall: null, tipo_exacto: null },
    privacidad: { fichas_sin_datos_victima: 0, total: 0 },
    costo_usd_corrida: 0,
    costo_usd_total_cacheado: 0,
    llamadas_nuevas: 0,
    casos: [],
  };
  if (opts.dryRun) return { ...base, motivo: "dry-run" };

  const casos = await pool(guiones, 4, async (g): Promise<FichaCaseResult> => {
    try {
      const { data, cache } = await extractFicha(g);
      const s = scoreFicha(g.etiqueta, data.output);
      process.stdout.write(`  ficha ${g.id}${cache ? " (caché)" : ""}: ${Object.values(s.campos).filter((c) => c.ok).length}/${CAMPOS.length}\n`);
      return {
        guion: g.id,
        cache,
        cost_usd: data.cost_usd,
        latency_ms: cache ? null : data.latency_ms,
        campos: s.campos,
        frases_recall: s.frasesRecall,
        identificadores: s.identificadores,
        privacidad_ok: s.privacidad_ok,
        privacidad_fugas: s.privacidad_fugas,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`  ficha ${g.id}: ERROR ${msg}\n`);
      return {
        guion: g.id,
        cache: false,
        cost_usd: 0,
        latency_ms: null,
        campos: Object.fromEntries(CAMPOS.map((c) => [c, { ok: false, esperado: null, obtenido: null }])) as FichaCaseResult["campos"],
        frases_recall: 0,
        identificadores: { esperados: 0, obtenidos: 0, correctos: 0, tipo_exacto: false },
        privacidad_ok: true,
        privacidad_fugas: [],
        error: msg,
      };
    }
  });

  const ok = casos.filter((c) => !c.error);
  const porCampo: Record<string, number> = {};
  for (const c of CAMPOS) porCampo[c] = casos.filter((x) => x.campos[c].ok).length / casos.length;
  const totalCampos = casos.length * CAMPOS.length;
  const correctos = casos.reduce((n, c) => n + CAMPOS.filter((k) => c.campos[k].ok).length, 0);
  const idsE = ok.reduce((n, c) => n + c.identificadores.esperados, 0);
  const idsO = ok.reduce((n, c) => n + c.identificadores.obtenidos, 0);
  const idsC = ok.reduce((n, c) => n + c.identificadores.correctos, 0);
  return {
    ...base,
    estado: ok.length === casos.length ? "ok" : ok.length ? "ok" : "error",
    ...(ok.length < casos.length ? { motivo: `${casos.length - ok.length} guiones con error de la API` } : {}),
    exactitud_global: correctos / totalCampos,
    exactitud_por_campo: porCampo,
    fichas_perfectas: casos.filter((c) => CAMPOS.every((k) => c.campos[k].ok)).length,
    frases_firma_recall: ok.length ? ok.reduce((n, c) => n + c.frases_recall, 0) / ok.length : null,
    identificadores: {
      precision: idsO ? idsC / idsO : null,
      recall: idsE ? idsC / idsE : null,
      tipo_exacto: ok.length ? ok.filter((c) => c.identificadores.tipo_exacto).length / ok.length : null,
    },
    privacidad: { fichas_sin_datos_victima: ok.filter((c) => c.privacidad_ok).length, total: ok.length },
    costo_usd_corrida: casos.filter((c) => !c.cache).reduce((n, c) => n + c.cost_usd, 0),
    costo_usd_total_cacheado: casos.reduce((n, c) => n + c.cost_usd, 0),
    llamadas_nuevas: casos.filter((c) => !c.cache && !c.error).length,
    casos,
  };
}
