import type { CaseSide, LinkView, NivelAutenticidad, ResultadoAutenticidad } from "../api/types";

/**
 * Lectura del análisis de autenticidad (packages/shared/src/authenticity.ts) para la consola. Son
 * indicios, no prueba: solo "generado_ia_confirmado" viene de una marca de agua o de C2PA.
 */

/** Nota que acompaña siempre al indicador. */
export const NOTA_AUSENCIA = "La ausencia de marca de agua no prueba que sea real.";

export type AuthTone = "sin" | "debil" | "fuerte" | "confirmado";

export const NIVEL_META: Record<NivelAutenticidad, { label: string; tone: AuthTone; sentence: string }> = {
  sin_senales: {
    label: "Sin señales de IA",
    tone: "sin",
    sentence: "No encontramos señales de que esté generado con IA o manipulado.",
  },
  indicios_debiles: {
    label: "Indicios débiles de IA",
    tone: "debil",
    sentence: "Hay detalles que podrían indicar edición o generación con IA. Míralos junto con el resto de la evidencia.",
  },
  indicios_fuertes: {
    label: "Indicios fuertes de IA",
    tone: "fuerte",
    sentence: "Hay indicios fuertes de que podría estar generado con IA o manipulado. Son indicios, no prueba.",
  },
  generado_ia_confirmado: {
    label: "Generado con IA",
    tone: "confirmado",
    sentence: "Una marca de agua o una credencial C2PA declaran que fue generado con IA. Igual es evidencia: alguien lo usó para extorsionar.",
  },
};

export function isStrong(nivel: NivelAutenticidad | null | undefined): boolean {
  return nivel === "indicios_fuertes" || nivel === "generado_ia_confirmado";
}

export interface FlaggedEvidence {
  label: string;
  tipo: string;
  caseCode: string;
  nivel: NivelAutenticidad;
}

/** Evidencia de un caso con indicios fuertes o marca de IA. */
export function flaggedInCase(side: CaseSide): FlaggedEvidence[] {
  return side.evidencia.flatMap((e) =>
    e.autenticidad && isStrong(e.autenticidad.nivel) ? [{ label: e.label, tipo: e.tipo, caseCode: side.code, nivel: e.autenticidad.nivel }] : [],
  );
}

/** Evidencia del par con indicios fuertes o marca de IA (para la advertencia de la cola). */
export function flaggedInLink(link: LinkView): FlaggedEvidence[] {
  return [...flaggedInCase(link.case_a), ...flaggedInCase(link.case_b)];
}

export interface SourceLine {
  fuente: string;
  estado: string;
  /** true: esta fuente apunta a IA o manipulación. */
  alerta: boolean;
}

const pct = (n: number) => n.toFixed(2);

/** Una línea por fuente técnica, en palabras. Lo que no se revisó se dice. */
export function sourceLines(r: ResultadoAutenticidad): SourceLine[] {
  const t = r.tecnicas;
  const out: SourceLine[] = [];
  const marca = r.tipo === "audio" ? "AudioSeal" : r.tipo === "video" ? "Video Seal" : "marca de agua";
  out.push(
    t.watermark
      ? {
          fuente: `Marca de agua (${t.watermark.detector})`,
          estado: t.watermark.detected ? `Detectada (puntaje ${pct(t.watermark.score)})` : "No detectada",
          alerta: t.watermark.detected,
        }
      : { fuente: `Marca de agua (${marca})`, estado: "No se pudo revisar", alerta: false },
  );
  if (!t.c2pa) out.push({ fuente: "Credenciales C2PA", estado: "No se pudieron revisar", alerta: false });
  else if (!t.c2pa.present) out.push({ fuente: "Credenciales C2PA", estado: "El archivo no trae", alerta: false });
  else
    out.push({
      fuente: "Credenciales C2PA",
      estado:
        (t.c2pa.ai_generated ? "Declaran contenido generado con IA" : t.c2pa.ai_generated === false ? "Presentes; no declaran IA" : "Presentes; no dicen si es IA") +
        (t.c2pa.generator ? ` (${t.c2pa.generator})` : ""),
      alerta: t.c2pa.ai_generated === true,
    });
  if (!t.metadata) out.push({ fuente: "Metadatos", estado: "No se pudieron revisar", alerta: false });
  else if (t.metadata.suspicious.length) out.push({ fuente: "Metadatos", estado: t.metadata.suspicious.join("; "), alerta: true });
  else if (!t.metadata.present) out.push({ fuente: "Metadatos", estado: "El archivo no trae (común al reenviar por WhatsApp)", alerta: false });
  else out.push({ fuente: "Metadatos", estado: t.metadata.software ? `Sin alertas (software: ${t.metadata.software})` : "Sin alertas", alerta: false });
  if (r.tipo === "audio") {
    out.push(
      t.synthetic_speech?.available
        ? { fuente: "Detector de voz sintética", estado: `Puntaje ${pct(t.synthetic_speech.score)} (1 = sintética)`, alerta: t.synthetic_speech.score >= 0.5 }
        : { fuente: "Detector de voz sintética", estado: "No disponible", alerta: false },
    );
  }
  out.push(
    r.forense
      ? { fuente: `Análisis forense (${r.model ?? "Muse Spark"})`, estado: NIVEL_META[r.forense.nivel].label, alerta: r.forense.nivel !== "sin_senales" }
      : { fuente: "Análisis forense (Muse Spark)", estado: "No disponible", alerta: false },
  );
  return out;
}

export const FUENTE_LABEL: Record<string, string> = {
  marca_de_agua: "Marca de agua",
  c2pa: "C2PA",
  metadatos: "Metadatos",
  voz_sintetica: "Voz sintética",
  analisis_visual: "Visual",
  analisis_audio: "Audio",
};
