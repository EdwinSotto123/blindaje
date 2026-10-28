/** Formatos en español de Perú y hora de Lima. */

const TZ = "America/Lima";

const dateTimeFmt = new Intl.DateTimeFormat("es-PE", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("es-PE", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("es-PE", { timeZone: TZ, day: "numeric", month: "short" });
const timeSecFmt = new Intl.DateTimeFormat("es-PE", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function toDate(iso: string): Date | null {
  // "YYYY-MM-DD" sin hora: mediodía de Lima, para no cambiar de día al convertir.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00-05:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = toDate(iso);
  return d ? dateTimeFmt.format(d) : iso;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = toDate(iso);
  return d ? dateFmt.format(d) : iso;
}

export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = toDate(iso);
  return d ? shortDateFmt.format(d) : iso;
}

/** dd/mm hh:mm:ss en hora de Lima (tabla de auditoría). */
export function fmtStamp(iso: string): string {
  const d = toDate(iso);
  return d ? timeSecFmt.format(d) : iso;
}

export function fmtUsd(n: number, digits = 2): string {
  return `US$ ${n.toLocaleString("es-PE", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPct(n: number, digits = 0): string {
  return `${n.toLocaleString("es-PE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

export function fmtScore(n: number): string {
  return n.toFixed(2);
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("es-PE");
}

/** 42000 → "0:42". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Hash abreviado: primeros 8 y últimos 4. */
export function shortHash(h: string | null | undefined, head = 8, tail = 4): string {
  if (!h) return "—";
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export const SECTOR_LABEL: Record<string, string> = {
  bodega: "Bodega",
  mototaxi: "Mototaxi",
  transporte: "Transporte",
  mercado: "Mercado",
  restaurante: "Restaurante",
  construccion: "Construcción",
  otro: "Otro",
};

export const CANAL_LABEL: Record<string, string> = {
  yape: "Yape",
  plin: "Plin",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  otro: "Otro",
};

export const ROLE_LABEL: Record<string, string> = {
  reviewer: "Revisor",
  analyst: "Analista",
  admin: "Administración",
  victim: "Víctima",
  system: "Sistema",
};

/** "2026-10-03 a 2026-10-19" → "3 oct. a 19 oct. de 2026". Si no tiene esa forma, se muestra tal cual. */
export function fmtPeriod(periodo: string | null | undefined): string {
  if (!periodo) return "—";
  const m = /^(\d{4}-\d{2}-\d{2}) a (\d{4}-\d{2}-\d{2})$/.exec(periodo.trim());
  if (!m) return periodo;
  const [, from, to] = m as unknown as [string, string, string];
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return sameYear ? `${fmtShortDate(from)} a ${fmtShortDate(to)} de ${to.slice(0, 4)}` : `${fmtDate(from)} a ${fmtDate(to)}`;
}
