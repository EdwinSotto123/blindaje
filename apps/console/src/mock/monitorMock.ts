import type { ConsoleMonitor, MonitorService } from "@blindaje/shared";
import type { BlindajeApi } from "../api/api";
import type { MonitorApi } from "../api/monitor";

/**
 * Monitoreo simulado: las colas salen del `MockApi` (los mismos vínculos, alertas y redes que se ven
 * en sus vistas); los servicios y las cifras de casos son fijos y ficticios.
 */
export class MockMonitorApi implements MonitorApi {
  constructor(private readonly api: BlindajeApi) {}

  async monitor(): Promise<ConsoleMonitor> {
    const started = Date.now();
    const [links, alerts, networks, costs, audit] = await Promise.all([
      this.api.listLinks(["probable", "por_revisar", "confirmado", "descartado"]),
      this.api.listAlerts(),
      this.api.listNetworks(),
      this.api.costs(),
      this.api.listAudit({ limit: 10 }),
    ]);
    const now = new Date().toISOString();
    const count = (s: string) => links.filter((l) => l.status === s).length;
    const service = (s: MonitorService["servicio"], estado: MonitorService["estado"], latencia_ms: number | null, detalle: string): MonitorService => ({
      servicio: s,
      estado,
      latencia_ms,
      detalle,
      medido_en: now,
    });
    const today = now.slice(0, 10);
    return {
      generado_en: now,
      mundo: "demo",
      api: { version: "simulado", entorno: "modo simulado", colo: null, ubicacion: null, ms: Date.now() - started },
      servicios: [
        service("d1", "ok", 21, "Base D1, primaria en Miami (ENAM)"),
        service("chroma", "ok", 182, 'Chroma Cloud, base "blindaje"'),
        service("ml", "apagado", null, "Contenedor no desplegado: los casos nuevos no generan voz, imagen ni marcas"),
        service("meta", "ok", 640, "API de Meta (Muse Spark, SAM 3.1, transcripción)"),
        service("auditoria", "ok", 28, `Cadena de auditoría al día hasta la entrada ${audit[0]?.seq ?? 0}`),
      ],
      casos: { total: 133, nuevos_24h: 4, nuevos_7d: 133, procesando: 0, con_error: 0, indexados: 7 },
      vinculos: { probable: count("probable"), por_revisar: count("por_revisar"), confirmado: count("confirmado"), descartado: count("descartado") },
      redes: networks.length,
      pendientes: { alertas: alerts.filter((a) => a.status === "borrador").length, recomendaciones: 0, hipotesis: 0 },
      presupuesto: {
        gastado_usd: costs.total_usd,
        hoy_usd: costs.by_day.find((d) => d.day === today)?.cost_usd ?? 0,
        presupuesto_usd: costs.budget_usd,
        pct: costs.total_usd / costs.budget_usd,
      },
      agentes: [
        { agente: "vigia", ultima: "2026-10-29T06:31:03Z", ok_7d: 3, error_7d: 0 },
        { agente: "vinculador", ultima: "2026-10-28T14:33:09Z", ok_7d: 36, error_7d: 0 },
        { agente: "ficha", ultima: "2026-10-28T14:32:22Z", ok_7d: 7, error_7d: 0 },
      ],
      actividad: audit.map((e) => ({ seq: e.seq, ts: e.ts, accion: e.action, actor_tipo: e.actor_type })),
    };
  }
}
