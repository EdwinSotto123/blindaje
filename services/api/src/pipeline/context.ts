import type { MetaClient } from "@blindaje/meta-client";
import type { PromptGuardResult } from "@blindaje/shared";
import type { Env } from "../env";
import type { EvidenceRow } from "../evidence";
import type { MlClient } from "../ml/client";

/** Lo que recibe cada procesador de evidencia. */
export interface EvidenceCtx {
  env: Env;
  ev: EvidenceRow;
  caso: { id: string; code: string; device_id: string; is_demo: number };
  /** null solo para texto (no necesita el contenedor). */
  ml: MlClient | null;
  meta: MetaClient;
  /** Resultado del paso `prompt_guard` (lo usa la autenticidad para avisar al modelo). */
  promptGuard?: PromptGuardResult | null;
}

export function requireMl(ctx: EvidenceCtx): MlClient {
  if (!ctx.ml) throw new Error("ml_requerido");
  return ctx.ml;
}

/** Ejecuta `fn` una sola vez aunque se llame varias veces (subidas perezosas a la Files API). */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}
