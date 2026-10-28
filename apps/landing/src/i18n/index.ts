import { es } from "./es";
import { en } from "./en";
import type { Dict, Lang } from "./types";

export const dicts: Record<Lang, Dict> = { es, en };

export function t(lang: Lang): Dict {
  return dicts[lang];
}

export type { Dict, Lang } from "./types";
