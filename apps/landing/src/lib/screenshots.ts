/**
 * Capturas reales de la app, tomadas en build de docs/screenshots/ (las genera el frente móvil).
 * Si no hay ninguna que calce con el hueco, el componente muestra "[captura de la app]".
 * Nunca se sustituyen por maquetas.
 *
 * Nombres que se reconocen (sin importar mayúsculas ni el resto del nombre):
 *   inside  → notas, privad, boveda, vault, private, dentro
 *   outside → cuaderno, disfraz, inicio, ventas, disguise, fuera
 *   report  → denuncia, report
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

const entries = Object.entries(files)
  .map(([file, mod]) => ({ name: file.split("/").pop() ?? file, image: mod.default }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function findShot(slot: ShotSlot): { name: string; image: ImageMetadata } | null {
  return entries.find((e) => PATTERNS[slot].test(e.name)) ?? null;
}

export function shotCount(): number {
  return entries.length;
}
