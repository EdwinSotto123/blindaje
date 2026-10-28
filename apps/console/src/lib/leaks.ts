import { NOTA_RASTREO, TEXTO_COPIA_MARCADA } from "@blindaje/shared";
import type { MediaResult } from "../api/api";

/**
 * Textos del rastreo de filtraciones (PLAN D14). Disuadir importa tanto como detectar: cada persona
 * ve que sus copias llevan su marca. Son indicios, nunca una acusación.
 */

export { NOTA_RASTREO, TEXTO_COPIA_MARCADA };

/** Antes de descargar: lo que la persona tiene que saber de cada copia. */
export const AVISO_ANTES_DE_ABRIR = "Cada copia que abres lleva una marca invisible con tu identidad.";

export type MarkTone = "marcada" | "sin_marca";

export interface CopyMarkText {
  label: string;
  tone: MarkTone;
  detail: string;
}

const SIN_MARCA: Record<string, string> = {
  servicio_no_disponible: "El servicio de marcas no respondió a tiempo y esta copia salió sin tu marca invisible.",
  tipo_no_soportado: "Los videos todavía no llevan marca invisible.",
  marcas_agotadas: "No quedan marcas de audio libres para tu cuenta. Avisa a la administración.",
  archivo_grande: "El archivo es muy grande para marcarlo en línea.",
};

/** Lo que dice el indicador junto a un audio o una imagen ya descargados. null: la API no lo informó. */
export function copyMarkText(marca: MediaResult["marca"], motivo: string | null): CopyMarkText | null {
  if (marca === "aplicada") return { label: "Copia marcada para ti", tone: "marcada", detail: TEXTO_COPIA_MARCADA };
  if (marca === "no_aplicada") {
    const why = (motivo && SIN_MARCA[motivo]) ?? "Esta copia salió sin tu marca invisible.";
    return { label: "Copia sin marca", tone: "sin_marca", detail: `${why} Igual, este acceso quedó en la auditoría con tu cuenta.` };
  }
  return null;
}

export const ROL_CUENTA: Record<string, string> = { reviewer: "Revisión", analyst: "Análisis", admin: "Administración" };

/** Fracción de bits → porcentaje legible ("94 %"). */
export function pctBits(x: number): string {
  return `${Math.round(x * 100)} %`;
}
