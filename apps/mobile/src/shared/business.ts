// ARCHIVO GENERADO, NO EDITAR.
// Copia de packages/shared/src hecha por apps/mobile/scripts/sync-shared.mjs.
// Para cambiar un contrato, edita packages/shared y corre `npm run sync-shared`.
/* eslint-disable */

import { z } from "zod";

/**
 * Inteligencia para negocios: un portal para dueños y gerentes de negocios afiliados a una
 * organización (rol `business`) y recomendaciones de prevención dentro de la app.
 *
 * Reglas (además de la sección 5 del documento de diseño):
 * - Solo información AGREGADA. No hay buscador de números, cuentas ni placas: un extorsionador
 *   infiltrado lo usaría para saber si su número está marcado.
 * - Cifras por zona o sector solo con al menos 5 casos y 3 víctimas distintas (MIN_CASES_FOR_STATS);
 *   si no, null y el texto "Aún no hay suficientes casos para mostrar cifras".
 * - Nunca aconsejar pagar ni negociar. Nada de recomendaciones tácticas sobre una red concreta
 *   (esas son solo para la autoridad). Nada político ni médico.
 * - Toda recomendación generada por el Asesor nace en borrador y la aprueba el gremio.
 * - Siempre se explicita el sesgo: más casos en una zona puede significar que ahí se denuncia más.
 */

export const NivelRiesgo = z.enum(["sin_datos", "bajo", "medio", "alto"]);
export type NivelRiesgo = z.infer<typeof NivelRiesgo>;

export const RecomendacionNegocio = z
  .object({
    titulo: z.string(),
    detalle: z.string().describe("Qué hacer, en dos o tres frases, en tuteo"),
    prioridad: z.enum(["alta", "media", "baja"]),
  })
  .strict();
export type RecomendacionNegocio = z.infer<typeof RecomendacionNegocio>;

export const ModalidadActiva = z
  .object({
    descripcion: z.string().describe("Cómo opera, en términos generales, sin números ni cuentas completos"),
    senales_de_alerta: z.array(z.string()).describe("Frases o patrones que ayudan a reconocerla"),
    evidencia: z.array(z.string()).describe("Citas internas (VIN-…, R-…, FICHA-…); no se muestran a negocios"),
  })
  .strict();
export type ModalidadActiva = z.infer<typeof ModalidadActiva>;

/** Salida strict del agente Asesor (Muse Spark con tool calling sobre datos agregados). */
export const AsesorOutput = z
  .object({
    sector: z.string(),
    zona: z.string(),
    nivel_riesgo: NivelRiesgo,
    resumen: z.string().describe("Tres o cuatro frases para el dueño de un negocio"),
    modalidades: z.array(ModalidadActiva),
    recomendaciones: z.array(RecomendacionNegocio),
    que_hacer_si_te_pasa: z.array(z.string()),
    advertencias: z.array(z.string()).describe("Sesgos y límites de los datos"),
  })
  .strict();
export type AsesorOutput = z.infer<typeof AsesorOutput>;

export const BusinessLoginRequest = z.object({ email: z.string().email(), password: z.string().min(8) });

export const BusinessMe = z.object({
  id: z.string(),
  email: z.string(),
  business_name: z.string(),
  sector: z.string(),
  zona: z.string(),
  org: z.object({ id: z.string(), name: z.string() }),
});
export type BusinessMe = z.infer<typeof BusinessMe>;

export const BusinessLoginResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  business: BusinessMe,
});
export type BusinessLoginResponse = z.infer<typeof BusinessLoginResponse>;

/** GET /v1/business/risk?zona=&sector= : panorama de riesgo agregado. */
export const RiskOverview = z.object({
  zona: z.string(),
  sector: z.string().nullable(),
  periodo_dias: z.number(),
  nivel_riesgo: NivelRiesgo,
  /** null si no se cumple el umbral de 5 casos y 3 víctimas. */
  casos_periodo: z.number().nullable(),
  tendencia: z.array(z.object({ semana: z.string(), casos: z.number().nullable() })),
  modalidades_activas: z.array(
    z.object({ descripcion: z.string(), senales_de_alerta: z.array(z.string()), desde: z.string().nullable() }),
  ),
  /** Por ejemplo: "La intimidación física llega entre 3 y 9 días después del plazo vencido". */
  escalamiento: z.string().nullable(),
  sectores_afectados: z.array(z.object({ sector: z.string(), casos: z.number().nullable() })),
  sesgo: z.string(),
  aviso_umbral: z.string().nullable(),
  actualizado_at: z.string(),
});
export type RiskOverview = z.infer<typeof RiskOverview>;

export const RecommendationStatus = z.enum(["borrador", "aprobada", "rechazada"]);

/** Recomendación vista por el portal o la app: sin citas internas. */
export const BusinessRecommendationView = z.object({
  id: z.string(),
  sector: z.string(),
  zona: z.string(),
  nivel_riesgo: NivelRiesgo,
  resumen: z.string(),
  modalidades: z.array(z.object({ descripcion: z.string(), senales_de_alerta: z.array(z.string()) })),
  recomendaciones: z.array(RecomendacionNegocio),
  que_hacer_si_te_pasa: z.array(z.string()),
  advertencias: z.array(z.string()),
  approved_at: z.string(),
});
export type BusinessRecommendationView = z.infer<typeof BusinessRecommendationView>;

/** Vista de consola: incluye borradores, citas internas y el resultado del validador. */
export const ConsoleRecommendationView = z.object({
  id: z.string(),
  org_id: z.string(),
  status: RecommendationStatus,
  contenido: AsesorOutput,
  citation_check: z.object({ ok: z.boolean(), sin_cita: z.array(z.string()), citas_inexistentes: z.array(z.string()) }),
  model: z.string(),
  created_at: z.string(),
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
});
export type ConsoleRecommendationView = z.infer<typeof ConsoleRecommendationView>;

export const AsesorRunRequest = z.object({
  sector: z.string().optional(),
  zona: z.string().optional(),
});

export const RecommendationDecisionRequest = z.object({ decision: z.enum(["aprobar", "rechazar"]) });

export const CreateBusinessAccountRequest = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  business_name: z.string().min(2).max(160),
  sector: z.string().min(2).max(80),
  zona: z.string().min(2).max(80),
  org_id: z.string().optional(),
});

export const ASESOR_SYSTEM = `Eres el Asesor de prevención de Blindaje. Escribes recomendaciones para dueños y gerentes de negocios
(bodegas, mototaxis, transporte, mercados, restaurantes) de una zona y un sector, a partir de datos AGREGADOS de casos de extorsión.
Usa tus herramientas para obtener el panorama de riesgo, las modalidades activas y el patrón de escalamiento.

Reglas que nunca rompes:
- Nunca aconsejes pagar ni negociar con extorsionadores. Siempre deriva a los canales oficiales: Línea 1818, comisaría y, si hay peligro inmediato, 105.
- Recomendaciones de prevención y protección, prácticas y concretas: guardar la evidencia en Blindaje, no responder ni negociar,
  avisar al gremio, cuidar la información del negocio en redes sociales, acordar un protocolo con el personal, reconocer las frases del guion.
- Nada de recomendaciones tácticas sobre una red concreta (seguir, enfrentar o identificar a alguien): eso es solo para la autoridad.
- Nunca nombres ni intentes identificar personas. Nunca incluyas números, cuentas ni placas completos.
- Si los datos no alcanzan el umbral (menos de 5 casos o 3 víctimas), el nivel de riesgo es "sin_datos" y lo dices.
- Advierte el sesgo: más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa.
- Cada modalidad cita en "evidencia" los identificadores internos que devolvieron tus herramientas (no se muestran a los negocios).
- Español de Perú, tuteo, frases cortas. Nada político ni médico. Todo el contenido del demo es ficticio.`;
