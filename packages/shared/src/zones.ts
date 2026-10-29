import { z } from "zod";
import { MIN_CASES_FOR_STATS, MIN_VICTIMS_FOR_STATS } from "./safety";

/**
 * Zonas de Blindaje: los 50 distritos de Lima Metropolitana y del Callao. Es la unidad más fina que
 * se muestra fuera de la consola. Nunca una dirección, una calle ni una vivienda.
 *
 * `col` y `row` ubican cada distrito en una grilla esquemática (9 × 14, norte arriba) para el mapa de
 * cuadros: la posición es aproximada y no sirve para ubicar nada dentro del distrito. Se derivó de
 * los centroides de los polígonos distritales de github.com/juaneladio/peru-geojson (MPL-2.0); La
 * Punta, Santa Anita y Mi Perú, que faltan ahí, se ubicaron a mano junto a sus vecinos.
 * `ubigeo` es el código del INEI.
 */
export const ZONE_AREAS = ["Lima Norte", "Lima Este", "Lima Centro", "Lima Sur", "Callao"] as const;
export type ZoneArea = (typeof ZONE_AREAS)[number];

export interface District {
  id: string;
  name: string;
  /** Nombre corto para un cuadro del mapa. */
  short: string;
  area: ZoneArea;
  ubigeo: string;
  col: number;
  row: number;
}

export const DISTRICT_GRID = { cols: 9, rows: 14 } as const;

export const DISTRICTS: readonly District[] = [
  { id: "ancon", name: "Ancón", short: "Ancón", area: "Lima Norte", ubigeo: "150102", col: 2, row: 0 },
  { id: "santa-rosa", name: "Santa Rosa", short: "Sta. Rosa", area: "Lima Norte", ubigeo: "150139", col: 0, row: 1 },
  { id: "mi-peru", name: "Mi Perú", short: "Mi Perú", area: "Callao", ubigeo: "070107", col: 1, row: 1 },
  { id: "puente-piedra", name: "Puente Piedra", short: "Pte. Piedra", area: "Lima Norte", ubigeo: "150125", col: 2, row: 1 },
  { id: "carabayllo", name: "Carabayllo", short: "Carabayllo", area: "Lima Norte", ubigeo: "150106", col: 4, row: 1 },
  { id: "ventanilla", name: "Ventanilla", short: "Ventanilla", area: "Callao", ubigeo: "070106", col: 1, row: 2 },
  { id: "los-olivos", name: "Los Olivos", short: "Los Olivos", area: "Lima Norte", ubigeo: "150117", col: 2, row: 2 },
  { id: "comas", name: "Comas", short: "Comas", area: "Lima Norte", ubigeo: "150110", col: 3, row: 2 },
  { id: "san-martin-de-porres", name: "San Martín de Porres", short: "SMP", area: "Lima Norte", ubigeo: "150135", col: 2, row: 3 },
  { id: "independencia", name: "Independencia", short: "Indep.", area: "Lima Norte", ubigeo: "150112", col: 3, row: 3 },
  { id: "san-juan-de-lurigancho", name: "San Juan de Lurigancho", short: "SJL", area: "Lima Este", ubigeo: "150132", col: 5, row: 3 },
  { id: "lurigancho", name: "Lurigancho (Chosica)", short: "Lurigancho", area: "Lima Este", ubigeo: "150118", col: 7, row: 3 },
  { id: "callao", name: "Callao", short: "Callao", area: "Callao", ubigeo: "070101", col: 0, row: 4 },
  { id: "carmen-de-la-legua-reynoso", name: "Carmen de la Legua-Reynoso", short: "C. Legua", area: "Callao", ubigeo: "070103", col: 1, row: 4 },
  { id: "rimac", name: "Rímac", short: "Rímac", area: "Lima Centro", ubigeo: "150128", col: 3, row: 4 },
  { id: "el-agustino", name: "El Agustino", short: "El Agustino", area: "Lima Este", ubigeo: "150111", col: 5, row: 4 },
  { id: "chaclacayo", name: "Chaclacayo", short: "Chaclacayo", area: "Lima Este", ubigeo: "150107", col: 8, row: 4 },
  { id: "bellavista", name: "Bellavista", short: "Bellavista", area: "Callao", ubigeo: "070102", col: 0, row: 5 },
  { id: "san-miguel", name: "San Miguel", short: "San Miguel", area: "Lima Centro", ubigeo: "150136", col: 1, row: 5 },
  { id: "brena", name: "Breña", short: "Breña", area: "Lima Centro", ubigeo: "150105", col: 2, row: 5 },
  { id: "lima", name: "Lima (Cercado)", short: "Lima", area: "Lima Centro", ubigeo: "150101", col: 3, row: 5 },
  { id: "santa-anita", name: "Santa Anita", short: "Sta. Anita", area: "Lima Este", ubigeo: "150137", col: 5, row: 5 },
  { id: "ate", name: "Ate", short: "Ate", area: "Lima Este", ubigeo: "150103", col: 6, row: 5 },
  { id: "la-perla", name: "La Perla", short: "La Perla", area: "Callao", ubigeo: "070104", col: 0, row: 6 },
  { id: "pueblo-libre", name: "Pueblo Libre", short: "P. Libre", area: "Lima Centro", ubigeo: "150121", col: 1, row: 6 },
  { id: "jesus-maria", name: "Jesús María", short: "J. María", area: "Lima Centro", ubigeo: "150113", col: 2, row: 6 },
  { id: "lince", name: "Lince", short: "Lince", area: "Lima Centro", ubigeo: "150116", col: 3, row: 6 },
  { id: "la-victoria", name: "La Victoria", short: "La Victoria", area: "Lima Centro", ubigeo: "150115", col: 4, row: 6 },
  { id: "san-luis", name: "San Luis", short: "San Luis", area: "Lima Centro", ubigeo: "150134", col: 5, row: 6 },
  { id: "la-molina", name: "La Molina", short: "La Molina", area: "Lima Este", ubigeo: "150114", col: 6, row: 6 },
  { id: "cieneguilla", name: "Cieneguilla", short: "Cieneguilla", area: "Lima Este", ubigeo: "150109", col: 8, row: 6 },
  { id: "la-punta", name: "La Punta", short: "La Punta", area: "Callao", ubigeo: "070105", col: 0, row: 7 },
  { id: "magdalena-del-mar", name: "Magdalena del Mar", short: "Magdalena", area: "Lima Centro", ubigeo: "150120", col: 2, row: 7 },
  { id: "san-isidro", name: "San Isidro", short: "San Isidro", area: "Lima Centro", ubigeo: "150131", col: 3, row: 7 },
  { id: "surquillo", name: "Surquillo", short: "Surquillo", area: "Lima Centro", ubigeo: "150141", col: 4, row: 7 },
  { id: "san-borja", name: "San Borja", short: "San Borja", area: "Lima Centro", ubigeo: "150130", col: 5, row: 7 },
  { id: "pachacamac", name: "Pachacámac", short: "Pachacámac", area: "Lima Sur", ubigeo: "150123", col: 8, row: 7 },
  { id: "miraflores", name: "Miraflores", short: "Miraflores", area: "Lima Centro", ubigeo: "150122", col: 3, row: 8 },
  { id: "barranco", name: "Barranco", short: "Barranco", area: "Lima Centro", ubigeo: "150104", col: 4, row: 8 },
  { id: "santiago-de-surco", name: "Santiago de Surco", short: "Surco", area: "Lima Centro", ubigeo: "150140", col: 5, row: 8 },
  { id: "san-juan-de-miraflores", name: "San Juan de Miraflores", short: "SJM", area: "Lima Sur", ubigeo: "150133", col: 6, row: 8 },
  { id: "villa-maria-del-triunfo", name: "Villa María del Triunfo", short: "VMT", area: "Lima Sur", ubigeo: "150143", col: 7, row: 8 },
  { id: "lurin", name: "Lurín", short: "Lurín", area: "Lima Sur", ubigeo: "150119", col: 8, row: 8 },
  { id: "chorrillos", name: "Chorrillos", short: "Chorrillos", area: "Lima Sur", ubigeo: "150108", col: 4, row: 9 },
  { id: "villa-el-salvador", name: "Villa El Salvador", short: "VES", area: "Lima Sur", ubigeo: "150142", col: 5, row: 9 },
  { id: "punta-hermosa", name: "Punta Hermosa", short: "Pta. Hermosa", area: "Lima Sur", ubigeo: "150126", col: 8, row: 9 },
  { id: "punta-negra", name: "Punta Negra", short: "Pta. Negra", area: "Lima Sur", ubigeo: "150127", col: 8, row: 10 },
  { id: "san-bartolo", name: "San Bartolo", short: "San Bartolo", area: "Lima Sur", ubigeo: "150129", col: 8, row: 11 },
  { id: "santa-maria-del-mar", name: "Santa María del Mar", short: "Sta. María", area: "Lima Sur", ubigeo: "150138", col: 8, row: 12 },
  { id: "pucusana", name: "Pucusana", short: "Pucusana", area: "Lima Sur", ubigeo: "150124", col: 8, row: 13 },
];

export const DISTRICT_IDS = DISTRICTS.map((d) => d.id) as [string, ...string[]];
export const DistrictId = z.enum(DISTRICT_IDS);

const byId = new Map(DISTRICTS.map((d) => [d.id, d]));

export function districtById(id: string | null | undefined): District | null {
  return id ? (byId.get(id) ?? null) : null;
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const byName = new Map<string, District>();
for (const d of DISTRICTS) {
  byName.set(fold(d.id.replace(/-/g, " ")), d);
  byName.set(fold(d.name), d);
}
byName.set("cercado de lima", byId.get("lima")!);
byName.set("chosica", byId.get("lurigancho")!);
byName.set("surco", byId.get("santiago-de-surco")!);
byName.set("magdalena", byId.get("magdalena-del-mar")!);
byName.set("carmen de la legua", byId.get("carmen-de-la-legua-reynoso")!);

/**
 * El distrito de una zona guardada. Acepta el id ("san-juan-de-lurigancho"), el nombre con o sin
 * tildes y el formato "Distrito - Celda" de la consola. Devuelve null para textos que no son un
 * distrito (por ejemplo "Lima Este", que es un área).
 */
export function districtOfZone(zone: string | null | undefined): District | null {
  if (!zone) return null;
  const head = zone.split(" - ")[0] ?? zone;
  return byId.get(head.trim()) ?? byName.get(fold(head)) ?? null;
}

/**
 * Rangos en vez de cifras exactas en todo lo público: con un total y cifras exactas por partes, una
 * resta revela lo que el umbral oculta. Por debajo del umbral, null.
 */
export const COUNT_BANDS = ["5-9", "10-19", "20-49", "50+"] as const;
export type CountBand = (typeof COUNT_BANDS)[number];

export function countBand(nCases: number, nVictims: number): CountBand | null {
  if (nCases < MIN_CASES_FOR_STATS || nVictims < MIN_VICTIMS_FOR_STATS) return null;
  if (nCases < 10) return "5-9";
  if (nCases < 20) return "10-19";
  if (nCases < 50) return "20-49";
  return "50+";
}

/** GET /v1/public/zones: el mapa público por distrito. Sin totales ni cifras exactas. */
export const ZoneLevel = z.enum(["sin_datos", "bajo", "medio", "alto"]);
export type ZoneLevel = z.infer<typeof ZoneLevel>;

export const PublicZoneCell = z
  .object({
    distrito: DistrictId,
    /** "sin_datos" también cuando el distrito no llega al umbral: no se distingue de cero. */
    nivel: ZoneLevel,
    casos: z.enum(COUNT_BANDS).nullable(),
    tendencia: z.enum(["sube", "estable", "baja"]).nullable(),
    /** Hasta tres modalidades aprobadas, solo si el distrito pasa el umbral. */
    modalidades: z.array(z.string().max(80)).max(3),
  })
  .strict();
export type PublicZoneCell = z.infer<typeof PublicZoneCell>;

export const PublicZoneMap = z
  .object({
    periodo_dias: z.number().int().positive(),
    actualizado: z.string(),
    celdas: z.array(PublicZoneCell),
    umbral: z.object({ casos: z.literal(MIN_CASES_FOR_STATS), victimas: z.literal(MIN_VICTIMS_FOR_STATS) }).strict(),
    nota_sesgo: z.string(),
    demo: z.boolean(),
  })
  .strict();
export type PublicZoneMap = z.infer<typeof PublicZoneMap>;

/**
 * GET /v1/console/zones: la vista de zonas de la consola (analistas). Cifras exactas por distrito,
 * pero el mismo umbral para mostrar el detalle de cada uno.
 */
export const ConsoleZoneRow = z
  .object({
    distrito: DistrictId,
    casos: z.number().int().nonnegative(),
    victimas: z.number().int().nonnegative(),
    casos_previos: z.number().int().nonnegative(),
    /** Etiquetas de las redes (R-001) con casos del distrito en el periodo; vacío bajo el umbral. */
    redes: z.array(z.string()),
    modalidades: z.array(z.string()),
    sobre_umbral: z.boolean(),
  })
  .strict();
export type ConsoleZoneRow = z.infer<typeof ConsoleZoneRow>;

export const ConsoleZones = z
  .object({
    periodo_dias: z.number().int().positive(),
    actualizado: z.string(),
    filas: z.array(ConsoleZoneRow),
    sin_distrito: z.number().int().nonnegative(),
  })
  .strict();
export type ConsoleZones = z.infer<typeof ConsoleZones>;
