import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { CanalPago, IdentifierRole, IdentifierType, Periodicidad, Sector, TipoAmenaza } from "@blindaje/shared";
import { DATA_DIR } from "./env";

/** Esquemas de los datos ficticios de evaluación (eval/data/*.json). */

export const Evidencia = z.object({
  label: z.string().regex(/^EV-[A-Z0-9]{1,6}-\d+$/),
  tipo: z.enum(["audio", "texto", "imagen", "relato"]),
  recibido: z.string().nullable(),
  origen: z.string().nullable(),
  contenido: z.string().min(1),
});
export type Evidencia = z.infer<typeof Evidencia>;

export const IdentificadorEtiqueta = z.object({ tipo: IdentifierType, valor: z.string(), rol: IdentifierRole });
export type IdentificadorEtiqueta = z.infer<typeof IdentificadorEtiqueta>;

export const Etiqueta = z.object({
  sector: Sector.nullable(),
  primer_contacto: z.string().nullable(),
  tipo_amenaza: TipoAmenaza.nullable(),
  monto_soles: z.number().nullable(),
  periodicidad: Periodicidad.nullable(),
  plazo_horas: z.number().nullable(),
  canal_pago: CanalPago.nullable(),
  identificadores: z.array(IdentificadorEtiqueta),
  grupo_que_dice_ser: z.string().nullable(),
  frases_firma: z.array(z.string()),
  escalamiento: z.array(z.object({ fecha: z.string().nullable(), tipo: z.string() })),
  fuentes: z.array(z.string()),
  datos_victima: z.array(z.string()),
  alternativas: z.record(z.string(), z.array(z.unknown())).optional(),
});
export type Etiqueta = z.infer<typeof Etiqueta>;

export const Guion = z.object({
  id: z.string().regex(/^G\d{2}$/),
  ficticio: z.literal(true),
  familia: z.string(),
  evidencia: z.array(Evidencia).min(1),
  etiqueta: Etiqueta,
});
export type Guion = z.infer<typeof Guion>;

export const GuionesFile = z.object({
  ficticio: z.literal(true),
  aviso: z.string(),
  version: z.string(),
  subconjunto_ficha: z.array(z.string()).length(20),
  guiones: z.array(Guion).min(30),
});
export type GuionesFile = z.infer<typeof GuionesFile>;

export const CasoEscenario = z.object({
  id: z.string(),
  guion: z.string(),
  voz: z.object({ hablante: z.string(), canal: z.union([z.literal(1), z.literal(2)]) }).nullable(),
  identificadores: z.array(IdentificadorEtiqueta),
  imagenes: z.array(z.object({ imagen: z.string(), transformacion: z.enum(["original", "whatsapp", "captura"]) })),
});
export type CasoEscenario = z.infer<typeof CasoEscenario>;

export const EscenariosFile = z.object({
  ficticio: z.literal(true),
  version: z.string(),
  casos: z.array(CasoEscenario),
  escenarios: z.array(z.object({ id: z.string(), tipo: z.string(), descripcion: z.string(), casos: z.array(z.string()) })),
  pares_vinculados: z.array(
    z.object({ a: z.string(), b: z.string(), por: z.array(z.enum(["voz", "identificador", "imagen"])), escenario: z.string() }),
  ),
});
export type EscenariosFile = z.infer<typeof EscenariosFile>;

export function loadGuiones(): GuionesFile {
  return GuionesFile.parse(JSON.parse(readFileSync(resolve(DATA_DIR, "guiones.json"), "utf8")));
}

export function loadEscenarios(): EscenariosFile {
  return EscenariosFile.parse(JSON.parse(readFileSync(resolve(DATA_DIR, "escenarios.json"), "utf8")));
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
