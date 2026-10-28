// ARCHIVO GENERADO, NO EDITAR.
// Copia de packages/shared/src hecha por apps/mobile/scripts/sync-shared.mjs.
// Para cambiar un contrato, edita packages/shared y corre `npm run sync-shared`.
/* eslint-disable */

import { z } from "zod";
import { Confidence } from "./enums";

/**
 * Esquemas de salida de los agentes (sección 10). Todos son strict: cada objeto tiene
 * additionalProperties false y todos sus campos en required. Toda afirmación cita
 * evidencia con los identificadores de labels.ts; el validador de citas del Worker
 * rechaza afirmaciones sin cita o con citas que no existen.
 */

export const Afirmacion = z
  .object({
    texto: z.string(),
    evidencia: z.array(z.string()).describe("Identificadores citables: EV-…, FICHA-…, VIN-…, V-…, ID-…, IMG-…"),
  })
  .strict();
export type Afirmacion = z.infer<typeof Afirmacion>;

export const Hipotesis = z
  .object({
    texto: z.string(),
    confianza: Confidence,
    evidencia: z.array(z.string()),
  })
  .strict();
export type Hipotesis = z.infer<typeof Hipotesis>;

/** Vinculador (10.2): evalúa un par candidato y explica el posible vínculo. */
export const VinculadorOutput = z
  .object({
    puntaje_ajustado: z.number().describe("Entre 0 y 1"),
    recomendacion: z.enum(["probable", "por_revisar", "descartar"]),
    explicacion: z.string().describe("Dos a cuatro frases en español, con citas entre paréntesis"),
    afirmaciones: z.array(Afirmacion),
    contradicciones: z.array(Afirmacion),
  })
  .strict();
export type VinculadorOutput = z.infer<typeof VinculadorOutput>;

/** Cartógrafo (10.3): perfil de red. */
export const PerfilRed = z
  .object({
    red: z.string(),
    casos: z.number(),
    periodo: z.string().nullable(),
    sectores: z.array(z.object({ sector: z.string(), casos: z.number() }).strict()),
    territorio: z
      .array(z.object({ zona: z.string(), casos: z.number() }).strict())
      .describe("Vacío si la red tiene menos de 5 casos o menos de 3 víctimas distintas"),
    modus_operandi: z.string(),
    hechos: z.array(Afirmacion),
    hipotesis: z.array(Hipotesis),
    escalamiento: z.string().nullable(),
    brechas: z.array(z.string()),
    recomendaciones_autoridad: z.array(z.string()),
  })
  .strict();
export type PerfilRed = z.infer<typeof PerfilRed>;

/** Vigía (10.4): borrador de alerta comunitaria. */
export const AlertaBorrador = z
  .object({
    titulo: z.string(),
    cuerpo: z.string().describe("Sin datos de víctimas, sin números completos, sin ubicaciones exactas"),
    zona: z.string(),
    modalidad: z.string(),
    que_hacer: z.array(z.string()),
    evidencia: z.array(z.string()),
  })
  .strict();
export type AlertaBorrador = z.infer<typeof AlertaBorrador>;

/** Redactor de expedientes (10.5). */
export const Expediente = z
  .object({
    red: z.string(),
    resumen: z.string(),
    cronologia: z.array(
      z.object({ fecha: z.string(), texto: z.string(), evidencia: z.array(z.string()) }).strict(),
    ),
    vinculos: z.array(z.object({ vinculo: z.string(), texto: z.string(), evidencia: z.array(z.string()) }).strict()),
    hechos: z.array(Afirmacion),
    hipotesis: z.array(Hipotesis),
    brechas: z.array(z.string()),
  })
  .strict();
export type Expediente = z.infer<typeof Expediente>;

export const CitationCheck = z.object({
  ok: z.boolean(),
  total_afirmaciones: z.number(),
  sin_cita: z.array(z.string()),
  citas_inexistentes: z.array(z.string()),
});
export type CitationCheck = z.infer<typeof CitationCheck>;
