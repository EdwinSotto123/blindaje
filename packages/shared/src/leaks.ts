import { z } from "zod";
import { ConsoleRole } from "./enums";

/**
 * Rastreo de filtraciones (PLAN D14). Cada audio o imagen de evidencia que sirve la consola lleva
 * una marca de agua invisible de quien la pidió:
 * - audio: AudioSeal con 16 bits, la marca fija de la cuenta (16 bits no alcanzan para más);
 * - imagen: Video Seal con un mensaje nuevo por entrega (cuenta + evidencia + hora, en D1).
 * Un admin sube una copia filtrada y ve desde qué cuenta salió. Son INDICIOS, no prueba: una
 * edición fuerte puede borrar la marca y que no aparezca no prueba que el archivo no salió de aquí.
 * Los videos todavía no se marcan.
 */

/** Header `x-blindaje-marca` de GET /v1/console/evidence/:id/media. */
export const MarcaCopia = z.enum(["aplicada", "no_aplicada"]);
export type MarcaCopia = z.infer<typeof MarcaCopia>;

/**
 * Header `x-blindaje-marca-motivo` (solo con `no_aplicada`):
 * - servicio_no_disponible: el contenedor ML no respondió a tiempo o falló (se sirve sin marca y queda auditado);
 * - tipo_no_soportado: video o texto (fuera de alcance);
 * - marcas_agotadas: no quedan marcas de audio a distancia suficiente de las demás;
 * - archivo_grande: el archivo supera el tamaño que se marca en línea.
 */
export const MotivoSinMarca = z.enum(["servicio_no_disponible", "tipo_no_soportado", "marcas_agotadas", "archivo_grande"]);
export type MotivoSinMarca = z.infer<typeof MotivoSinMarca>;

/** Distancia de Hamming mínima entre dos marcas de audio de 16 bits (corrige hasta 2 bits). */
export const LEAK_TAG_MIN_DISTANCE = 5;
/** Distancia máxima (bits duros) para atribuir un audio a una cuenta. */
export const LEAK_AUDIO_MAX_HAMMING = 2;
/** Exactitud de bits mínima para atribuir una imagen a una entrega. */
export const LEAK_IMAGE_MIN_ACCURACY = 0.85;
/** Ventaja mínima de la mejor entrega sobre la segunda para no declararla ambigua. */
export const LEAK_IMAGE_MIN_MARGIN = 0.1;

export const LeakTraceKind = z.enum(["audio", "imagen"]);
export type LeakTraceKind = z.infer<typeof LeakTraceKind>;

export const LeakTraceCandidate = z.object({
  user_id: z.string(),
  /** Correo de la cuenta (o su nombre si no tiene correo). */
  email_or_name: z.string(),
  /** Nombre visible de la cuenta. Aditivo. */
  display_name: z.string().nullable().optional(),
  role: ConsoleRole.nullable(),
  /** Imagen: la evidencia de esa entrega (null si el caso ya se borró). Audio: null (la marca es de la cuenta). */
  evidence_label: z.string().nullable(),
  case_id: z.string().nullable(),
  /** Imagen: hora de la entrega. Audio: última vez que la cuenta recibió un audio marcado (null si nunca). */
  issued_at: z.string().nullable(),
  /** Fracción de bits que coinciden (0 a 1). */
  bit_accuracy: z.number(),
});
export type LeakTraceCandidate = z.infer<typeof LeakTraceCandidate>;

/** POST /v1/console/leaks/trace (admin). El archivo subido nunca se guarda. */
export const LeakTraceResult = z.object({
  detected: z.boolean(),
  kind: LeakTraceKind,
  score: z.number(),
  candidates: z.array(LeakTraceCandidate),
  /** true si más de una cuenta o entrega podría explicar la marca. Aditivo. */
  ambiguo: z.boolean().default(false),
  nota: z.string(),
  /** Detector que usó el contenedor ML. Aditivo. */
  model: z.string().nullable().optional(),
});
export type LeakTraceResult = z.infer<typeof LeakTraceResult>;

/** Lo que la consola le dice a cada persona sobre sus copias (disuasión). */
export const TEXTO_COPIA_MARCADA =
  "Este archivo lleva una marca invisible con tu identidad. Si se filtra, se puede saber desde qué cuenta salió.";

/** Advertencia fija del rastreo. */
export const NOTA_RASTREO =
  "Son indicios, no prueba. Una edición fuerte (recortar mucho, volver a grabar, comprimir varias veces) puede borrar la marca, y que no aparezca no prueba que el archivo no salió de Blindaje.";
