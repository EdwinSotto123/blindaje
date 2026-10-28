import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COSTS_LEDGER, metaClient } from "./meta";
import { DEMO_DIR } from "./env";

/**
 * Genera la foto ficticia del caso A con Muse Image (muse-image-1.0, 0.01 USD por imagen):
 * fachada de una bodega ficticia con una bala sobre el mostrador y una nota manuscrita ficticia.
 * Nada gráfico. Tope de este frente: 4 imágenes en total (se cuenta en el registro de costos).
 *
 *   pnpm --filter @blindaje/eval demo:images            # solo si faltan
 *   pnpm --filter @blindaje/eval demo:images --force    # vuelve a generar (respeta el tope)
 *
 * Salida: eval/demo/foto-A.jpg (la del demo) y eval/demo/foto-alternativa.jpg (otra toma parecida
 * que la evaluación usa como imagen distinta en el escenario de imágenes reutilizadas).
 */

const MAX_IMAGENES = 4;

export const PROMPT_FOTO = [
  "Fotografía realista tomada con un celular, de día, de una pequeña bodega de barrio ficticia en Lima, Perú.",
  "Se ve el mostrador de madera desde afuera, con rejas metálicas abiertas, estantes con abarrotes genéricos sin marcas",
  "y un letrero pintado a mano que dice solo 'BODEGA'.",
  "Sobre el mostrador hay una sola bala dorada sin disparar, pequeña, y al lado una hoja de cuaderno cuadriculado",
  "con una nota escrita a mano con plumón negro que dice 'LOS X. 48 HORAS'.",
  "Sin personas, sin rostros, sin sangre, sin armas, sin violencia. Estilo foto de evidencia, luz natural, encuadre horizontal.",
].join(" ");

function imagenesGeneradas(): number {
  if (!existsSync(COSTS_LEDGER)) return 0;
  return readFileSync(COSTS_LEDGER, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { model: string; status: string; units?: { images?: number } })
    .filter((e) => e.model === "muse-image-1.0" && e.status === "ok")
    .reduce((n, e) => n + (e.units?.images ?? 0), 0);
}

async function main() {
  const force = process.argv.includes("--force");
  mkdirSync(DEMO_DIR, { recursive: true });
  const a = resolve(DEMO_DIR, "foto-A.jpg");
  const b = resolve(DEMO_DIR, "foto-alternativa.jpg");
  if (!force && existsSync(a) && existsSync(b)) {
    console.log("Las fotos del demo ya existen (usa --force para regenerar).");
    return;
  }
  const usadas = imagenesGeneradas();
  const n = 2;
  if (usadas + n > MAX_IMAGENES) {
    throw new Error(`Tope de ${MAX_IMAGENES} imágenes: ya se generaron ${usadas}.`);
  }
  console.log(`Generando ${n} imágenes con muse-image-1.0 (llevamos ${usadas})…`);
  const r = await metaClient().images.generate(
    { prompt: PROMPT_FOTO, n, size: "1536x1024", outputFormat: "jpeg" },
    { operation: "eval_demo_foto" },
  );
  if (r.images.length < 2) throw new Error(`Muse Image devolvió ${r.images.length} imágenes`);
  writeFileSync(a, Buffer.from(r.images[0]!.b64, "base64"));
  writeFileSync(b, Buffer.from(r.images[1]!.b64, "base64"));
  writeFileSync(
    resolve(DEMO_DIR, "foto-A.meta.json"),
    JSON.stringify(
      {
        ficticio: true,
        modelo: "muse-image-1.0",
        prompt: PROMPT_FOTO,
        generado: new Date().toISOString(),
        archivos: ["foto-A.jpg", "foto-alternativa.jpg"],
        nota: "Imagen sintética generada para el demo de Blindaje. No retrata un lugar ni un hecho real.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Listo: ${a} y ${b}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
