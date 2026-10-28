import type { AlertView, CitationCheck, ProfileView, VinculadorOutput } from "@blindaje/shared";
import type { Env } from "../env";
import { NotImplementedError } from "../lib/errors";
import { log } from "../lib/log";
import type { Actor } from "../types";
import type { CandidatePair } from "../linking";

/**
 * Agentes (sección 10): Vinculador, Cartógrafo, Vigía y Redactor. STUBS: los completa el frente
 * de agentes (M3–M4) con packages/meta-client (Responses API, tool calling, text.format strict).
 *
 * Reglas para implementarlos:
 * - Antes de cada llamada: createMetaHooks(env).beforeCall({ model, operation, essential }).
 *   Muse Wonder es no esencial: con el presupuesto al 80 % se bloquea (budget_exceeded).
 * - Validador de citas: cada afirmación cita etiquetas existentes; un reintento; si vuelve a
 *   fallar, la salida queda `invalido`. Registrar cada ejecución en `agent_runs`.
 * - Nada sale sin revisión humana: perfiles, hipótesis y alertas nacen en `borrador`.
 * - Auditar con `audit(env, { actor_type, actor_id, action: "agent.<nombre>", ... })`.
 */

export type CitationValidator = (output: unknown, knownLabels: Set<string>) => CitationCheck;

export interface VigiaRunOptions {
  trigger: "cron" | "manual";
  cron?: string;
  actor?: Actor;
}

/**
 * Vigía: detecta patrones (>= 5 casos, >= 3 víctimas, misma zona, 14 días) y crea borradores de
 * alerta. STUB: no hace nada y devuelve una lista vacía, para que el cron no falle.
 */
export async function runVigia(_env: Env, opts: VigiaRunOptions): Promise<AlertView[]> {
  log("info", "vigia_stub", { trigger: opts.trigger, cron: opts.cron ?? null });
  return [];
}

export interface CartografoOptions {
  model: "muse-spark-1.3" | "muse-wonder-1.0";
  actor: Actor;
}

/** Cartógrafo: perfil de red con hechos e hipótesis citados. STUB. */
export async function runCartografo(_env: Env, _networkId: string, _opts: CartografoOptions): Promise<ProfileView> {
  throw new NotImplementedError("Cartógrafo");
}

export interface RedactorOptions {
  actor: Actor;
}

/**
 * Redactor de expedientes: crea la fila en `expedientes`, arma el contenido con el agente, genera
 * el PDF en el contenedor (/pdf/render "expediente"), lo guarda cifrado en R2
 * (`expedientes/<id>.pdf`, AAD = id) con su SHA-256 y devuelve el id. STUB.
 */
export async function runRedactor(_env: Env, _networkId: string, _opts: RedactorOptions): Promise<{ expediente_id: string }> {
  throw new NotImplementedError("Redactor de expedientes");
}

/** Vinculador: ajusta el puntaje y explica un par candidato. STUB: devuelve null (sin ajuste). */
export async function runVinculador(_env: Env, _pair: CandidatePair): Promise<{ output: VinculadorOutput; valid: boolean } | null> {
  return null;
}
