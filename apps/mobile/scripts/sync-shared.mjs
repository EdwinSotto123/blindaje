#!/usr/bin/env node
/**
 * Copia los contratos de packages/shared/src/*.ts a apps/mobile/src/shared/.
 *
 * apps/mobile es un proyecto npm independiente (fuera del workspace de pnpm: Metro con los
 * symlinks de pnpm da problemas en Windows), así que no puede depender de @blindaje/shared.
 * La copia se sube al repo. Uso: `npm run sync-shared` (o `node scripts/sync-shared.mjs --check`
 * para fallar si la copia está desactualizada).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../../packages/shared/src");
const dest = resolve(here, "../src/shared");
const check = process.argv.includes("--check");

const HEADER =
  "// ARCHIVO GENERADO, NO EDITAR.\n" +
  "// Copia de packages/shared/src hecha por apps/mobile/scripts/sync-shared.mjs.\n" +
  "// Para cambiar un contrato, edita packages/shared y corre `npm run sync-shared`.\n" +
  "/* eslint-disable */\n\n";

const files = readdirSync(src).filter((f) => f.endsWith(".ts"));
let stale = [];
if (!check) mkdirSync(dest, { recursive: true });

for (const f of files) {
  const out = HEADER + readFileSync(join(src, f), "utf8");
  const target = join(dest, f);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current !== out) {
    stale.push(f);
    if (!check) writeFileSync(target, out);
  }
}

// Borra copias de archivos que ya no existen en packages/shared.
if (existsSync(dest)) {
  for (const f of readdirSync(dest)) {
    if (f.endsWith(".ts") && !files.includes(f)) {
      stale.push(f);
      if (!check) rmSync(join(dest, f));
    }
  }
}

if (check) {
  if (stale.length) {
    console.error(`src/shared desactualizado: ${stale.join(", ")}. Corre npm run sync-shared.`);
    process.exit(1);
  }
  console.log("src/shared al día.");
} else {
  console.log(stale.length ? `Copiados: ${stale.join(", ")}` : "src/shared ya estaba al día.");
}
