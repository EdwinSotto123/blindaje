import { z } from "zod";

/**
 * Panel de monitoreo de la consola (solo admin): GET /v1/console/monitoreo. Una sola lectura con
 * el estado de los servicios (medido en vivo), las colas de trabajo del equipo, el presupuesto de
 * Meta, los agentes y la actividad reciente de la auditoría.
 *
 * Solo cifras y nombres de acciones: ningún texto de casos, identificadores ni detalles de la
 * auditoría (esos se ven en Auditoría, con su propio permiso).
 */

export const MonitorServiceName = z.enum(["d1", "chroma", "ml", "meta", "auditoria"]);
export type MonitorServiceName = z.infer<typeof MonitorServiceName>;

/** ok: respondió; lento: respondió sobre el umbral; caido: falló; apagado: no está configurado o desplegado. */
export const MonitorServiceState = z.enum(["ok", "lento", "caido", "apagado"]);
export type MonitorServiceState = z.infer<typeof MonitorServiceState>;

export const MonitorService = z.object({
  servicio: MonitorServiceName,
  estado: MonitorServiceState,
  /** Ida y vuelta medida en esta lectura; null si no se midió. */
  latencia_ms: z.number().nullable(),
  /** Una línea: dónde vive o por qué está apagado. */
  detalle: z.string(),
  /** Cuándo se midió. Meta y Chroma muestran la última medición guardada y la renuevan si tiene más de 30 s. */
  medido_en: z.string(),
});
export type MonitorService = z.infer<typeof MonitorService>;

export const MonitorAgent = z.object({
  agente: z.string(),
  ultima: z.string().nullable(),
  ok_7d: z.number().int(),
  error_7d: z.number().int(),
});
export type MonitorAgent = z.infer<typeof MonitorAgent>;

export const MonitorActivity = z.object({
  seq: z.number().int(),
  ts: z.string(),
  accion: z.string(),
  actor_tipo: z.string(),
});
export type MonitorActivity = z.infer<typeof MonitorActivity>;

export const ConsoleMonitor = z.object({
  generado_en: z.string(),
  /** Mundo de datos de la cuenta: las cuentas del demo ven los casos ficticios. */
  mundo: z.enum(["demo", "real"]),
  api: z.object({
    version: z.string(),
    entorno: z.string(),
    /** Centro de datos de Cloudflare donde corrió esta lectura (por ejemplo "ATL"). */
    colo: z.string().nullable(),
    /** Región fijada para el Worker, cerca de la base (wrangler.jsonc). */
    ubicacion: z.string().nullable(),
    ms: z.number(),
  }),
  servicios: z.array(MonitorService),
  casos: z.object({
    total: z.number().int(),
    nuevos_24h: z.number().int(),
    nuevos_7d: z.number().int(),
    procesando: z.number().int(),
    con_error: z.number().int(),
    indexados: z.number().int(),
  }),
  vinculos: z.object({
    probable: z.number().int(),
    por_revisar: z.number().int(),
    confirmado: z.number().int(),
    descartado: z.number().int(),
  }),
  redes: z.number().int(),
  pendientes: z.object({
    alertas: z.number().int(),
    recomendaciones: z.number().int(),
    hipotesis: z.number().int(),
  }),
  presupuesto: z.object({
    gastado_usd: z.number(),
    hoy_usd: z.number(),
    presupuesto_usd: z.number(),
    pct: z.number(),
  }),
  agentes: z.array(MonitorAgent),
  actividad: z.array(MonitorActivity),
});
export type ConsoleMonitor = z.infer<typeof ConsoleMonitor>;
