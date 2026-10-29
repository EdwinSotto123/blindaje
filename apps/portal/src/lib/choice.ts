import { DISTRICTS, districtById, districtOfZone, Sector, ZONE_AREAS, type District, type ZoneArea } from "@blindaje/shared";
import { useSearchParams } from "react-router";

/**
 * El distrito y el rubro elegidos viven solo en la URL (?distrito=ate&rubro=bodega): se pueden
 * compartir y volver a abrir, y el portal no guarda nada en el aparato. Sin rubro, el panorama es de
 * todos los rubros del distrito (lo que necesita un vecino sin negocio).
 */

export type Rubro = Sector;

export const RUBROS: readonly Rubro[] = Sector.options;

/** El rubro en singular, para el selector ("Bodega"). */
export const RUBRO_LABEL: Record<Rubro, string> = {
  bodega: "Bodega",
  mototaxi: "Mototaxi",
  transporte: "Transporte",
  mercado: "Mercado",
  restaurante: "Restaurante",
  construccion: "Construcción",
  otro: "Otro rubro",
};

export interface Choice {
  distrito: District | null;
  rubro: Rubro | null;
}

/** Lee la elección de la URL. Lo que no es un distrito o un rubro de la lista se ignora. */
export function readChoice(params: URLSearchParams): Choice {
  const rubro = params.get("rubro");
  return {
    distrito: districtById(params.get("distrito")),
    rubro: rubro && (RUBROS as readonly string[]).includes(rubro) ? (rubro as Rubro) : null,
  };
}

/** "?distrito=ate&rubro=bodega" (o "" sin elección), para enlazar sin perder la zona. */
export function choiceSearch(c: { distrito?: string | null | undefined; rubro?: string | null | undefined }): string {
  const p = new URLSearchParams();
  if (c.distrito && districtById(c.distrito)) p.set("distrito", c.distrito);
  if (c.rubro && (RUBROS as readonly string[]).includes(c.rubro)) p.set("rubro", c.rubro);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** La elección actual y su `search` listo para los enlaces internos. */
export function useChoice(): Choice & { search: string; params: URLSearchParams } {
  const [params] = useSearchParams();
  const choice = readChoice(params);
  return { ...choice, params, search: choiceSearch({ distrito: choice.distrito?.id, rubro: choice.rubro }) };
}

/** Minúsculas sin tildes ni signos, para buscar "San Martin" o "rimac". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const collator = new Intl.Collator("es-PE");

/** Los distritos que coinciden con la búsqueda, agrupados por área y en orden alfabético. */
export function filterDistricts(query: string): { area: ZoneArea; districts: District[] }[] {
  const q = fold(query);
  // Nombres de uso común que no están en la lista ("Surco", "Chosica", "Cercado de Lima").
  const alias = q ? districtOfZone(query) : null;
  const hit = (d: District) => !q || fold(d.name).includes(q) || fold(d.short).includes(q) || alias?.id === d.id;
  return ZONE_AREAS.map((area) => ({
    area,
    districts: DISTRICTS.filter((d) => d.area === area && hit(d)).sort((a, b) => collator.compare(a.name, b.name)),
  })).filter((g) => g.districts.length > 0);
}
