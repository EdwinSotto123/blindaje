import { defineTool, type AgentTool } from "@blindaje/meta-client";
import { z } from "zod";
import { SESGO_TEXTO, zoneKey, type RiskAnalysis } from "../../business/risk";
import { hasLongDigits, sanitizeStoredText } from "../../business/safety";
import { CitationCollector, mapStrings } from "./safety";

/**
 * Herramientas del Asesor sobre datos AGREGADOS de una zona y un rubro (ya calculados con el
 * umbral de 5 casos y 3 víctimas en `analyzeRisk`).
 *
 * - Nunca devuelven casos sueltos, seudónimos, dispositivos, organizaciones, números, cuentas,
 *   placas ni referencias ID-…: solo conteos que cumplen el umbral, modalidades, el patrón de
 *   escalamiento y las alertas aprobadas, con sus citas internas (FICHA-…, VIN-…, R-…).
 * - Todo lo que devuelven pasa por el recolector de citas: el Asesor solo puede citar lo que vio.
 * - Solo responden por la zona que se está analizando.
 */
export class AsesorToolbox {
  readonly citations: CitationCollector;
  readonly outputs: Array<{ tool: string; output: unknown }> = [];

  constructor(
    readonly analysis: RiskAnalysis,
    readonly sectorLabel: string,
  ) {
    const real = new Set<string>([
      ...analysis.evidencia,
      ...analysis.escalamiento.evidencia,
      ...analysis.modalidades.flatMap((m) => m.evidencia),
      ...analysis.alertas.flatMap((a) => a.evidencia),
    ]);
    this.citations = new CitationCollector(real);
  }

  get known(): Set<string> {
    return this.citations.known;
  }

  private emit<T>(tool: string, raw: T): T {
    // Defensa en profundidad: ningún número largo ni ID-… llega al modelo, aunque venga de una alerta.
    const output = mapStrings(raw, (s) => sanitizeStoredText(s));
    const text = JSON.stringify(output);
    if (hasLongDigits(text) || /ID-/.test(text)) throw new Error("Salida de herramienta bloqueada: contenía un número o un identificador");
    this.citations.add(text);
    this.outputs.push({ tool, output });
    return output;
  }

  private assertZona(zona: string): void {
    if (zoneKey(zona) !== zoneKey(this.analysis.zona)) throw new Error(`Solo puedes consultar la zona ${this.analysis.zona}.`);
  }

  panoramaRiesgo(zona: string) {
    this.assertZona(zona);
    const a = this.analysis;
    return this.emit("panorama_riesgo", {
      zona: a.zona,
      rubro_pedido: this.sectorLabel,
      alcance_de_las_cifras: a.sector ? `rubro ${a.sector} en ${a.zona}` : `toda la zona ${a.zona}`,
      periodo_dias: a.periodo_dias,
      nivel_riesgo: a.nivel,
      casos_periodo: a.casos,
      tendencia_semanal: a.tendencia,
      rubros_afectados: a.sectores_afectados,
      aviso_umbral: a.aviso_umbral,
      sesgo: SESGO_TEXTO,
      evidencia: a.evidencia,
      nota: a.umbral
        ? "Conteos agregados de casos con consentimiento comunitario. null = el grupo no llega a 5 casos de 3 víctimas distintas: no lo reportes."
        : "Sin cifras: la zona no llega a 5 casos de 3 víctimas distintas en el periodo. El nivel de riesgo es sin_datos; no inventes cifras ni modalidades.",
    });
  }

  modalidadesActivas(zona: string) {
    this.assertZona(zona);
    return this.emit("modalidades_activas", {
      zona: this.analysis.zona,
      modalidades: this.analysis.modalidades.map((m) => ({
        descripcion: m.descripcion,
        senales_de_alerta: m.senales_de_alerta,
        desde: m.desde,
        origen: m.origen === "alerta" ? "alerta aprobada por el gremio" : "rasgos comunes de las fichas (cada uno en al menos 5 casos de 3 víctimas)",
        evidencia: m.evidencia,
      })),
      nota: this.analysis.modalidades.length ? "Cita en evidencia los identificadores de cada modalidad." : "No hay modalidades que cumplan el umbral en la zona.",
    });
  }

  escalamiento(zona: string) {
    this.assertZona(zona);
    const e = this.analysis.escalamiento;
    return this.emit("escalamiento", {
      zona: this.analysis.zona,
      patron: e.texto,
      dias_despues_del_plazo: e.dias,
      evidencia: e.evidencia,
      nota: e.texto ? "Patrón agregado de la zona." : "Sin patrón de escalamiento que mostrar (o la zona no llega al umbral).",
    });
  }

  alertasAprobadas(zona: string) {
    this.assertZona(zona);
    return this.emit("alertas_aprobadas", {
      zona: this.analysis.zona,
      alertas: this.analysis.alertas.map((a) => ({
        titulo: a.titulo,
        modalidad: a.modalidad,
        cuerpo: a.cuerpo,
        que_hacer: a.que_hacer,
        aprobada: a.approved_at.slice(0, 10),
        evidencia: a.evidencia,
      })),
    });
  }

  tools(): AgentTool[] {
    const zonaParam = z.object({ zona: z.string().describe(`Zona (distrito): ${this.analysis.zona}`) });
    return [
      defineTool({
        name: "panorama_riesgo",
        description: "Nivel de riesgo, casos del periodo, tendencia semanal y rubros afectados de la zona (agregados, con el umbral de 5 casos y 3 víctimas).",
        parameters: zonaParam,
        handler: ({ zona }) => this.panoramaRiesgo(zona),
      }),
      defineTool({
        name: "modalidades_activas",
        description: "Modalidades activas en la zona: cómo operan, señales de alerta para reconocerlas y sus citas internas.",
        parameters: zonaParam,
        handler: ({ zona }) => this.modalidadesActivas(zona),
      }),
      defineTool({
        name: "escalamiento",
        description: "Cuánto tarda en llegar la intimidación física después de vencido el plazo, agregado para la zona.",
        parameters: zonaParam,
        handler: ({ zona }) => this.escalamiento(zona),
      }),
      defineTool({
        name: "alertas_aprobadas",
        description: "Alertas de la zona que el gremio ya aprobó y envió a sus asociados.",
        parameters: zonaParam,
        handler: ({ zona }) => this.alertasAprobadas(zona),
      }),
    ];
  }
}
