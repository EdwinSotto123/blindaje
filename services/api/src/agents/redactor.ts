import type { Env } from "../env";
import { NotImplementedError } from "../lib/errors";
import type { Actor } from "../types";

export interface RedactorOptions {
  actor: Actor;
}

/**
 * Redactor de expedientes (10.5): crea la fila en `expedientes`, arma el contenido con el agente,
 * genera el PDF en el contenedor (/pdf/render "expediente"), lo guarda cifrado en R2
 * (`expedientes/<id>.pdf`, AAD = id) con su SHA-256 y devuelve el id. STUB.
 */
export async function runRedactor(_env: Env, _networkId: string, _opts: RedactorOptions): Promise<{ expediente_id: string }> {
  throw new NotImplementedError("Redactor de expedientes");
}
