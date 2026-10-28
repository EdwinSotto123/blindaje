/**
 * Capturas reales tomadas en build de docs/screenshots/.
 *
 * 1. Capturas del celular (las genera el frente móvil). Se reconocen por el nombre del archivo, sin
 *    importar mayúsculas ni el resto del nombre:
 *      inside  → notas, privad, boveda, vault, private, dentro
 *      outside → cuaderno, disfraz, inicio, ventas, disguise, fuera
 *      report  → denuncia, report
 *    Si no hay ninguna, la landing muestra un diagrama rotulado como ilustración. Nunca una maqueta
 *    que se haga pasar por captura.
 *
 * 2. Capturas de la consola y del portal en modo simulado (datos ficticios), con nombre fijo:
 *    consola-*.png y portal-*.png, más su recorte para el celular (*-movil.png). Si falta una, su
 *    figura no se muestra.
 */
import type { ImageMetadata } from "astro";

const files = import.meta.glob<{ default: ImageMetadata }>(
  "../../../../docs/screenshots/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}",
  { eager: true },
);

export type ShotSlot = "inside" | "outside" | "report";

const PATTERNS: Record<ShotSlot, RegExp> = {
  inside: /(notas|privad|boveda|bóveda|vault|private|dentro)/i,
  outside: /(cuaderno|disfraz|inicio|ventas|disguise|fuera)/i,
  report: /(denuncia|report)/i,
};

/** Las capturas de la consola y del portal nunca cuentan como capturas del celular. */
const PRODUCT = /^(consola|portal)-/i;

const entries = Object.entries(files)
  .map(([file, mod]) => ({ name: file.split("/").pop() ?? file, image: mod.default }))
  .sort((a, b) => a.name.localeCompare(b.name));

const phone = entries.filter((e) => !PRODUCT.test(e.name));

export function findShot(slot: ShotSlot): { name: string; image: ImageMetadata } | null {
  return phone.find((e) => PATTERNS[slot].test(e.name)) ?? null;
}

type ProductBase =
  | "consola-vinculo-misma-voz"
  | "consola-red-grafo"
  | "consola-perfil-cartografo"
  | "consola-recomendaciones-asesor"
  | "consola-autenticidad-evidencia"
  | "consola-rastreo-filtracion"
  | "portal-negocios-panorama";

/** Cada captura puede tener su recorte para el celular, con el mismo nombre y "-movil". */
export type ProductShot = ProductBase | `${ProductBase}-movil`;

export function productShot(name: ProductShot): ImageMetadata | null {
  return entries.find((e) => e.name.replace(/\.[a-z]+$/i, "") === name)?.image ?? null;
}
