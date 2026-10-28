import { MetaApiError, MetaGuardError } from "@blindaje/meta-client";
import { ApiError } from "../lib/errors";

/**
 * Errores que no vale la pena reintentar: stubs, presupuesto agotado, datos inválidos, el
 * contenedor ML rechazó el archivo (502: por ejemplo un audio que ffmpeg no puede leer) o la Meta
 * API respondió con un error no transitorio (4xx salvo 429, salvaguardas locales).
 */
export function isPermanentPipelineError(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (["not_implemented", "budget_exceeded", "bad_request", "not_found", "forbidden"].includes(err.code)) return true;
    return err.code === "upstream_error" && err.status === 502;
  }
  if (err instanceof MetaApiError) return !err.retryable;
  return err instanceof MetaGuardError;
}

export function errorCode(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  if (err instanceof MetaApiError) return `meta_${err.status}`;
  if (err instanceof Error) return err.name.slice(0, 60);
  return "error";
}
