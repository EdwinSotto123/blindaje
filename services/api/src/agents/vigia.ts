import type { AlertView } from "@blindaje/shared";
import type { Env } from "../env";
import { log } from "../lib/log";
import type { Actor } from "../types";

export interface VigiaRunOptions {
  trigger: "cron" | "manual";
  cron?: string;
  actor?: Actor;
}

/**
 * Vigía (10.4): detecta patrones (>= 5 casos, >= 3 víctimas, misma zona, 14 días) y crea borradores
 * de alerta. STUB: no hace nada y devuelve una lista vacía, para que el cron no falle.
 */
export async function runVigia(_env: Env, opts: VigiaRunOptions): Promise<AlertView[]> {
  log("info", "vigia_stub", { trigger: opts.trigger, cron: opts.cron ?? null });
  return [];
}
