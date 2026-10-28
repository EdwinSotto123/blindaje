import { MetaError } from "@blindaje/meta-client";
import { extractCitations } from "@blindaje/shared";
import { ApiError } from "../../lib/errors";

/**
 * Salvaguardas comunes de los agentes de red (sección 10.1 y 10.4):
 * - recolector de etiquetas citables: un agente solo puede citar lo que devolvieron sus herramientas;
 * - redacción de números largos (teléfonos, cuentas) en cualquier texto que produzca un modelo;
 * - conversión de errores de la Meta API en errores claros de la API.
 */

/**
 * Junta las etiquetas citables (EV-…, FICHA-…, VIN-…, V-…, ID-…, IMG-…, R-…) que aparecen en las
 * salidas de las herramientas. Solo se aceptan etiquetas que existen de verdad en la red
 * (`real`): un texto de una ficha que mencione una etiqueta inexistente no la vuelve citable.
 */
export class CitationCollector {
  readonly known = new Set<string>();

  constructor(private readonly real: ReadonlySet<string>) {}

  add(value: unknown): void {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const c of extractCitations(text)) if (this.real.has(c)) this.known.add(c);
  }

  has(label: string): boolean {
    return this.known.has(label);
  }
}

/** Siete o más dígitos seguidos (con espacios, puntos o guiones sueltos): teléfonos y cuentas. */
const LONG_NUMBER_RE = /\+?\d(?:[\s.-]?\d){6,}/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const NUMBER_PLACEHOLDER = "[número omitido]";

/** Reemplaza fechas ISO por "12 de octubre" (para que no parezcan números largos). */
export function humanizeIsoDates(text: string): string {
  return text.replace(ISO_DATE_RE, (_m, _y: string, mo: string, d: string) => `${Number(d)} de ${MESES[Number(mo) - 1] ?? mo}`);
}

/** Reemplaza teléfonos y cuentas por un marcador. Las fechas ISO (2026-10-12) se respetan. */
export function redactLongNumbers(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(ISO_DATE_RE)) {
    out += text.slice(last, m.index).replace(LONG_NUMBER_RE, NUMBER_PLACEHOLDER) + m[0];
    last = m.index + m[0].length;
  }
  return out + text.slice(last).replace(LONG_NUMBER_RE, NUMBER_PLACEHOLDER);
}

export function hasLongNumber(text: string): boolean {
  LONG_NUMBER_RE.lastIndex = 0;
  const found = LONG_NUMBER_RE.test(text);
  LONG_NUMBER_RE.lastIndex = 0;
  return found;
}

/** Aplica `fn` a todos los strings de un objeto JSON (devuelve una copia). */
export function mapStrings<T>(value: T, fn: (s: string, key: string | null) => string, key: string | null = null): T {
  if (typeof value === "string") return fn(value, key) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn, key)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = mapStrings(v, fn, k);
    return out as T;
  }
  return value;
}

/** Quita etiquetas citables de un texto público (las citas de una alerta no se muestran). */
export function stripCitations(text: string): string {
  return text
    .replace(/\s*\(\s*(?:(?:EV|FICHA|VIN|V|ID|IMG|R)-[A-Za-z0-9-]+\s*[,;]?\s*)+\)/g, "")
    .replace(/\b(?:EV-[A-Z0-9]{1,6}(?:-\d+|\d+)|FICHA-[A-Z0-9]{1,6}|VIN-\d+|V-\d+|ID-[0-9a-f]{6}|IMG-\d+|R-\d{3,})\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** Errores de la Meta API → error claro de la API. `budget_exceeded` y demás ApiError pasan tal cual. */
export function toAgentError(err: unknown, agent: string): unknown {
  if (err instanceof ApiError) return err;
  if (err instanceof MetaError) {
    const code = (err as { code?: unknown }).code;
    const status = (err as { status?: unknown }).status;
    return new ApiError("upstream_error", `El agente ${agent} no pudo completar el análisis con la Meta Model API. Intenta de nuevo en unos minutos.`, {
      status: 502,
      details: { agent, error: err.name, ...(typeof code === "string" ? { code } : {}), ...(typeof status === "number" ? { status } : {}) },
    });
  }
  return err;
}
