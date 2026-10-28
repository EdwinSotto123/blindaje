import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lee MODEL_API_KEY de la variable de entorno o de services/api/.dev.vars, sin imprimirla.
 * Devuelve null si no está.
 */
export function loadModelApiKey(): string | null {
  const fromEnv = process.env.MODEL_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  const devVars = resolve(here, "../../../../services/api/.dev.vars");
  if (!existsSync(devVars)) return null;
  for (const line of readFileSync(devVars, "utf8").split(/\r?\n/)) {
    const match = /^\s*MODEL_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1]) return match[1].replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}

export const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
