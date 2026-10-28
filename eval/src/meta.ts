import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMetaClient, type MetaClient, type UsageEvent } from "@blindaje/meta-client";
import { CACHE_DIR, requireSecret } from "./env";

/**
 * Cliente de la Meta Model API para la evaluación. Usa @blindaje/meta-client (salida
 * estructurada strict, reintentos, guardas contra modelos contributor y búsqueda web) y registra
 * cada llamada facturable en eval/data/cache/costos.jsonl para reportar el gasto real.
 */

export const COSTS_LEDGER = resolve(CACHE_DIR, "costos.jsonl");

let client: MetaClient | null = null;

export function metaClient(): MetaClient {
  if (client) return client;
  mkdirSync(CACHE_DIR, { recursive: true });
  client = createMetaClient({
    apiKey: requireSecret("MODEL_API_KEY"),
    maxRetries: 3,
    hooks: {
      beforeCall: (info) => {
        if (/contributor/i.test(info.model)) throw new Error("Modelos contributor prohibidos con datos del proyecto");
      },
      onUsage: (e: UsageEvent) => {
        appendFileSync(
          COSTS_LEDGER,
          JSON.stringify({
            ts: new Date().toISOString(),
            model: e.model,
            operation: e.operation,
            status: e.status,
            cost_usd: e.cost_usd,
            units: e.units,
            duration_ms: e.duration_ms,
          }) + "\n",
        );
      },
    },
  });
  return client;
}

export interface CostSummary {
  total_usd: number;
  llamadas: number;
  por_modelo: Record<string, { llamadas: number; cost_usd: number }>;
}

/** Suma el registro de costos de la evaluación (todas las corridas). */
export function costSummary(): CostSummary {
  const out: CostSummary = { total_usd: 0, llamadas: 0, por_modelo: {} };
  if (!existsSync(COSTS_LEDGER)) return out;
  for (const line of readFileSync(COSTS_LEDGER, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as { model: string; cost_usd: number };
    out.total_usd += e.cost_usd;
    out.llamadas += 1;
    const m = (out.por_modelo[e.model] ??= { llamadas: 0, cost_usd: 0 });
    m.llamadas += 1;
    m.cost_usd += e.cost_usd;
  }
  return out;
}
