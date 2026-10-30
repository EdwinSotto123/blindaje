import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Tiempos de una petición por recurso, para la cabecera Server-Timing y el panel de monitoreo:
 * base de datos (D1), Durable Objects (límites de uso y auditoría) y servicios externos (Chroma,
 * Meta). Las llamadas en paralelo se suman, así que un recurso puede pasar del total.
 */
export type TimingKind = "db" | "do" | "ext";

const LABEL: Record<TimingKind, string> = {
  db: "consultas a D1",
  do: "llamadas a Durable Objects",
  ext: "llamadas externas",
};

export class RequestTiming {
  readonly started = Date.now();
  readonly totals: Record<TimingKind, { ms: number; n: number }> = {
    db: { ms: 0, n: 0 },
    do: { ms: 0, n: 0 },
    ext: { ms: 0, n: 0 },
  };

  add(kind: TimingKind, ms: number): void {
    this.totals[kind].ms += ms;
    this.totals[kind].n += 1;
  }

  header(): string {
    const parts = [`app;dur=${Date.now() - this.started}`];
    for (const kind of Object.keys(LABEL) as TimingKind[]) {
      const t = this.totals[kind];
      if (t.n) parts.push(`${kind};dur=${t.ms};desc="${t.n} ${LABEL[kind]}"`);
    }
    return parts.join(", ");
  }
}

const store = new AsyncLocalStorage<RequestTiming>();

export function runWithTiming<T>(timing: RequestTiming, fn: () => Promise<T>): Promise<T> {
  return store.run(timing, fn);
}

/** Mide `fn` en la petición en curso (sin petición, por ejemplo en una cola, solo la ejecuta). */
export async function timed<T>(kind: TimingKind, fn: () => Promise<T>): Promise<T> {
  const t = store.getStore();
  if (!t) return fn();
  // En Workers el reloj avanza con cada E/S, así que la diferencia mide la espera real.
  const start = Date.now();
  try {
    return await fn();
  } finally {
    t.add(kind, Date.now() - start);
  }
}

const RUN_METHODS = new Set<PropertyKey>(["first", "all", "run", "raw"]);
const targets = new WeakMap<object, D1PreparedStatement>();
const wrapped = new WeakMap<D1Database, D1Database>();

function wrapStatement(stmt: D1PreparedStatement): D1PreparedStatement {
  const proxy = new Proxy(stmt, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "bind") return (...args: unknown[]) => wrapStatement((value as (...a: unknown[]) => D1PreparedStatement).apply(target, args));
      if (RUN_METHODS.has(prop)) return (...args: unknown[]) => timed("db", () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
  targets.set(proxy, stmt);
  return proxy;
}

/** D1 con cada consulta medida. `batch` cuenta como una sola ida y vuelta. */
export function timedD1(db: D1Database): D1Database {
  const cached = wrapped.get(db);
  if (cached) return cached;
  const proxy = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "prepare") return (sql: string) => wrapStatement(target.prepare(sql));
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => timed("db", () => target.batch(stmts.map((s) => targets.get(s) ?? s)));
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
  wrapped.set(db, proxy);
  return proxy;
}
