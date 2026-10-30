/**
 * Registro de las últimas peticiones de esta pestaña a la API, para el panel de monitoreo:
 * cuánto tardó cada una desde el navegador y, con la cabecera Server-Timing de la API, cuánto fue
 * trabajo del servidor y cuánto consultas a D1. Solo métodos, rutas sin ids y tiempos.
 */

export interface RequestRecord {
  at: number;
  method: string;
  /** Ruta sin ids ni parámetros: /v1/console/links/:id. */
  ruta: string;
  status: number;
  /** Ida y vuelta completa desde el navegador. */
  ms: number;
  /** Lo que tardó el Worker (Server-Timing "app"); null si la API no lo mandó. */
  servidor_ms: number | null;
  db_ms: number | null;
  db_n: number | null;
}

export interface ServerTiming {
  app: number | null;
  db: number | null;
  dbN: number | null;
}

/** Lee `app;dur=72, db;dur=21;desc="1 consultas a D1", …`. */
export function parseServerTiming(header: string | null): ServerTiming {
  const out: ServerTiming = { app: null, db: null, dbN: null };
  if (!header) return out;
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().split(";");
    const dur = params.map((p) => /^dur=([\d.]+)$/.exec(p.trim())?.[1]).find(Boolean);
    if (name === "app" && dur) out.app = Number(dur);
    if (name === "db") {
      if (dur) out.db = Number(dur);
      const n = params.map((p) => /^desc="(\d+)/.exec(p.trim())?.[1]).find(Boolean);
      if (n) out.dbN = Number(n);
    }
  }
  return out;
}

/** Quita ids y parámetros: un segmento con dígitos y 8 o más caracteres es un id. */
export function routeOf(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0] ?? url;
  }
  return path
    .split("/")
    .map((seg) => (seg.length >= 8 && /\d/.test(seg) ? ":id" : seg))
    .join("/");
}

const MAX = 40;
// Cada cambio crea un arreglo nuevo: useSyncExternalStore compara por identidad.
let entries: readonly RequestRecord[] = [];
const listeners = new Set<() => void>();

export const requestLog = {
  /** De la más reciente a la más antigua. */
  entries(): readonly RequestRecord[] {
    return entries;
  },
  add(r: RequestRecord): void {
    entries = [r, ...entries].slice(0, MAX);
    for (const l of listeners) l();
  },
  clear(): void {
    entries = [];
    for (const l of listeners) l();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
