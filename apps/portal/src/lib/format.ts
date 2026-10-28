/** Formatos en español de Perú y hora de Lima. */

const TZ = "America/Lima";

const dateFmt = new Intl.DateTimeFormat("es-PE", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
const dayMonthFmt = new Intl.DateTimeFormat("es-PE", { timeZone: TZ, day: "numeric", month: "long" });
const shortFmt = new Intl.DateTimeFormat("es-PE", { timeZone: TZ, day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("es-PE", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

function toDate(iso: string): Date | null {
  // "YYYY-MM-DD" sin hora: mediodía de Lima, para no cambiar de día al convertir.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00-05:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "27 de octubre de 2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "sin fecha";
  const d = toDate(iso);
  return d ? dateFmt.format(d) : iso;
}

/** "27 de octubre". */
export function fmtDayMonth(iso: string | null | undefined): string {
  if (!iso) return "sin fecha";
  const d = toDate(iso);
  return d ? dayMonthFmt.format(d) : iso;
}

/** "27 oct." (ejes del gráfico). */
export function fmtShort(iso: string): string {
  const d = toDate(iso);
  return d ? shortFmt.format(d).replace(/\.$/, "") : iso;
}

/** "27 de octubre, 6:00 a. m." */
export function fmtUpdated(iso: string): string {
  const d = toDate(iso);
  return d ? `${dayMonthFmt.format(d)}, ${timeFmt.format(d)}` : iso;
}

/** "1 caso", "14 casos". */
export function casos(n: number): string {
  return `${n.toLocaleString("es-PE")} ${n === 1 ? "caso" : "casos"}`;
}

/** Sector en minúsculas para una frase ("bodegas"), con su primera letra en mayúscula para títulos. */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("es-PE") + s.slice(1) : s;
}
