// ARCHIVO GENERADO, NO EDITAR.
// Copia de packages/shared/src hecha por apps/mobile/scripts/sync-shared.mjs.
// Para cambiar un contrato, edita packages/shared y corre `npm run sync-shared`.
/* eslint-disable */

import { z } from "zod";
import { IdentifierRole, IdentifierType, Sector } from "./enums";

/**
 * Ficha del caso (sección 7.3 del documento de diseño).
 *
 * Hay tres formas:
 *  - FichaExtraction: lo que devuelve Muse Spark con salida estructurada (strict).
 *    Todos los campos son obligatorios y usan null cuando no hay dato, porque el modo
 *    strict exige que `required` liste todas las propiedades.
 *  - FichaStored: lo que se guarda en D1. Los identificadores ya NO tienen el valor
 *    legible: solo la referencia HMAC y los últimos 3 dígitos.
 *  - La víctima ve su propia ficha con sus identificadores descifrados (son de su caso).
 *
 * La ficha nunca incluye datos personales de la víctima.
 */

export const TipoAmenaza = z.enum([
  "dano_local",
  "dano_fisico",
  "dano_familia",
  "dano_vehiculo",
  "difusion_informacion",
  "otro",
]);
export type TipoAmenaza = z.infer<typeof TipoAmenaza>;

export const CanalPago = z.enum(["yape", "plin", "transferencia", "efectivo", "otro"]);
export type CanalPago = z.infer<typeof CanalPago>;

export const Periodicidad = z.enum(["unico", "diario", "semanal", "mensual"]);
export type Periodicidad = z.infer<typeof Periodicidad>;

export const IdentificadorExtraido = z
  .object({
    tipo: IdentifierType,
    valor: z.string().describe("Tal como aparece en la evidencia: número, cuenta o placa"),
    rol: IdentifierRole,
    evidencia: z.array(z.string()).describe("Etiquetas EV-… donde aparece"),
  })
  .strict();
export type IdentificadorExtraido = z.infer<typeof IdentificadorExtraido>;

export const EventoEscalamiento = z
  .object({
    fecha: z.string().nullable().describe("YYYY-MM-DD si se conoce"),
    tipo: z.string().describe("Por ejemplo: foto del local con bala, disparo, visita"),
    evidencia: z.array(z.string()),
  })
  .strict();
export type EventoEscalamiento = z.infer<typeof EventoEscalamiento>;

export const FichaExtraction = z
  .object({
    sector: Sector.nullable(),
    primer_contacto: z.string().nullable().describe("ISO 8601 con zona horaria de Lima si se conoce"),
    tipo_amenaza: TipoAmenaza.nullable(),
    amenaza: z.string().nullable().describe("Descripción breve y general de la amenaza"),
    monto_soles: z.number().nullable(),
    periodicidad: Periodicidad.nullable(),
    plazo: z.string().nullable().describe("Texto del plazo, por ejemplo '48 horas'"),
    plazo_horas: z.number().nullable(),
    canal_pago: CanalPago.nullable(),
    identificadores: z.array(IdentificadorExtraido),
    grupo_que_dice_ser: z.string().nullable(),
    frases_firma: z.array(z.string()).describe("Frases casi literales que se repiten en el guion"),
    escalamiento: z.array(EventoEscalamiento),
    resumen_mo: z.string().describe("Modus operandi en una o dos frases, sin datos de la víctima"),
    fuentes: z.array(z.string()).describe("Todas las etiquetas EV-… usadas para la ficha"),
  })
  .strict();
export type FichaExtraction = z.infer<typeof FichaExtraction>;

export const IdentificadorRef = z.object({
  ref: z.string().describe("ID-xxxxxx"),
  tipo: IdentifierType,
  rol: IdentifierRole,
  ultimos_3: z.string(),
  evidencia: z.array(z.string()),
});
export type IdentificadorRef = z.infer<typeof IdentificadorRef>;

export const FichaStored = FichaExtraction.omit({ identificadores: true }).extend({
  caso: z.string(),
  zona: z.string().nullable(),
  identificadores: z.array(IdentificadorRef),
});
export type FichaStored = z.infer<typeof FichaStored>;

/** Chips de "Lo que encontramos" para la víctima. Se generan de la ficha, sin datos de otros casos. */
export function hallazgosParaVictima(f: Pick<FichaExtraction, "canal_pago" | "plazo" | "grupo_que_dice_ser" | "monto_soles" | "tipo_amenaza">): string[] {
  const out: string[] = [];
  const canal: Record<string, string> = {
    yape: "Yape",
    plin: "Plin",
    transferencia: "transferencia",
    efectivo: "efectivo",
    otro: "otro medio",
  };
  if (f.canal_pago) out.push(`Pide pago por ${canal[f.canal_pago] ?? f.canal_pago}`);
  if (f.monto_soles != null) out.push(`Monto: S/ ${f.monto_soles.toLocaleString("es-PE")}`);
  if (f.plazo) out.push(`Plazo de ${f.plazo}`);
  if (f.grupo_que_dice_ser) out.push(`Dice ser de “${f.grupo_que_dice_ser}”`);
  return out;
}
