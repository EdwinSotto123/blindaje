import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz de eval/ y del repo, sin depender del directorio desde donde se corra. */
export const EVAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = resolve(EVAL_DIR, "..");
export const DATA_DIR = resolve(EVAL_DIR, "data");
export const CACHE_DIR = resolve(DATA_DIR, "cache");
export const RESULTS_DIR = resolve(CACHE_DIR, "results");
export const DEMO_DIR = resolve(EVAL_DIR, "demo");

let devVars: Record<string, string> | null = null;

/**
 * Lee una variable de services/api/.dev.vars (en .gitignore). Nunca imprime el valor.
 * El entorno tiene prioridad sobre el archivo.
 */
export function secret(name: string): string | undefined {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  if (devVars === null) {
    devVars = {};
    const path = resolve(REPO_DIR, "services/api/.dev.vars");
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2] ?? "";
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (v) devVars[m[1]!] = v;
      }
    }
  }
  return devVars[name];
}

export function requireSecret(name: string): string {
  const v = secret(name);
  if (!v) throw new Error(`Falta ${name} (variable de entorno o services/api/.dev.vars)`);
  return v;
}

/** URL de la API: variable API_URL, o la que el frente de API deja en services/api/README.md. */
export function apiUrl(): string | null {
  if (process.env.API_URL) return process.env.API_URL.replace(/\/+$/, "");
  const readme = resolve(REPO_DIR, "services/api/README.md");
  if (existsSync(readme)) {
    const m = readFileSync(readme, "utf8").match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
    if (m) return m[0];
  }
  return null;
}

export const ML_URL = (process.env.ML_URL ?? "http://localhost:8080").replace(/\/+$/, "");
