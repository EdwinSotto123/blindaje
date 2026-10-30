/** Formatos en español de Perú, sin depender de Intl (no siempre completo en Hermes). */

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function group(n: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 12850 -> "S/ 128.50"; 200000 -> "S/ 2,000.00". */
export function soles(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `S/ ${group(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `- ${s}` : s;
}

/** "18.18", "18,18", "S/ 18.18", "18" -> céntimos. null si no es un monto válido. */
export function parseSoles(input: string): number | null {
  const clean = input.replace(/s\/|\s/gi, "").replace(",", ".");
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(clean)) return null;
  const [ent, dec = ""] = clean.split(".");
  return Number(ent) * 100 + Number(dec.padEnd(2, "0"));
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Martes 27 de octubre" */
export function longDate(d = new Date()): string {
  const s = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hour(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? "a. m." : "p. m."}`;
}

/** "3 oct, 7:40 p. m." (o "Hoy, 7:40 p. m.") */
export function shortDateTime(iso: string | number, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (dayKey(d) === dayKey(now)) return `Hoy, ${hour(d)}`;
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}, ${hour(d)}`;
}

/** "3 oct 2026" */
export function shortDate(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "3 oct 2026, 7:40 p. m." */
export function fullDateTime(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${shortDate(iso)}, ${hour(d)}`;
}

/** 42000 -> "0:42" */
export function duration(ms: number | null | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
