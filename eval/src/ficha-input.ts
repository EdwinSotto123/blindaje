/**
 * Arma el mensaje de usuario para la ficha (FICHA_SYSTEM) a partir de piezas de evidencia
 * etiquetadas. Formato propuesto para que la evaluación y el pipeline usen el mismo texto: cada
 * pieza va con su etiqueta EV-…, su tipo, la hora de recepción en hora de Lima y el número que la
 * envió (si se conoce). El número de origen es del extorsionador; el relato es de la víctima.
 * El contenido va delimitado como dato con `delimitarEvidencia`, igual que en la ficha de la API.
 */

import { delimitarEvidencia } from "@blindaje/shared";

export interface PiezaEvidencia {
  label: string;
  tipo: "audio" | "texto" | "imagen" | "relato";
  recibido: string | null;
  origen: string | null;
  contenido: string;
}

const TIPO: Record<PiezaEvidencia["tipo"], string> = {
  audio: "Transcripción de audio",
  texto: "Mensaje de texto",
  imagen: "Lectura de imagen",
  relato: "Relato de la persona afectada",
};

export function buildFichaInput(caso: string, piezas: PiezaEvidencia[]): string {
  const bloques = piezas.map((p) => {
    const meta: string[] = [];
    if (p.recibido) meta.push(`recibido ${p.recibido}`);
    if (p.origen) meta.push(`enviado desde ${p.origen}`);
    const head = `[${p.label}] ${TIPO[p.tipo]}${meta.length ? ` (${meta.join(", ")})` : ""}:`;
    return `${head}\n${delimitarEvidencia(p.label, p.contenido)}`;
  });
  return [
    `Caso ${caso}. Contenido ficticio de evaluación.`,
    `Evidencia (${piezas.length} piezas):`,
    "",
    bloques.join("\n\n"),
  ].join("\n");
}
