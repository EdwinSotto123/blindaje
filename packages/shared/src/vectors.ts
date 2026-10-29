import { z } from "zod";

/**
 * Motor vectorial visto desde la consola (solo admin): GET /v1/console/vectores y
 * POST /v1/console/vectores/consulta. Muestra cómo cada evidencia se vuelve un vector, dónde se
 * guarda y qué vecinos devuelve la búsqueda, con los datos de verdad del motor de vinculación.
 *
 * - D1 es la fuente de verdad de los vectores (`embeddings`); la base vectorial (Chroma Cloud o
 *   FAISS en el contenedor ML) es la copia de búsqueda.
 * - Chroma Cloud solo recibe vectores de casos ficticios del demo (`is_demo = 1`) con
 *   consentimiento comunitario, sin texto ni metadatos personales: id numérico, tipo y modelo.
 * - El mapa es una proyección (PCA a dos ejes) de 192 o 384 dimensiones: ayuda a ver, no decide.
 *   La comparación real es el coseno en la dimensión completa.
 */

export const VectorIndexName = z.enum(["voz", "voz_segmento", "texto", "imagen"]);
export type VectorIndexName = z.infer<typeof VectorIndexName>;

export const VectorProvider = z.enum(["chroma-cloud", "faiss", "ninguno"]);
export type VectorProvider = z.infer<typeof VectorProvider>;

/** Cuántos números trae la muestra de cada vector: uno de cada dim/32, reescalados a [-1, 1]. */
export const VECTOR_SAMPLE_BINS = 32;

export const VectorStoreStatus = z.object({
  /** chroma-cloud: base vectorial administrada; faiss: índices del contenedor ML; ninguno: sin búsqueda vectorial. */
  proveedor: VectorProvider,
  /** Nombre de la base en Chroma Cloud ("blindaje"); null con FAISS o sin base. */
  base: z.string().nullable(),
  conectado: z.boolean(),
  /** Ida y vuelta del heartbeat, en ms. */
  latencia_ms: z.number().nullable(),
  /** Última sincronización completa desde D1 (ISO), si hubo. */
  sincronizado_en: z.string().nullable(),
  /** true: solo casos ficticios del demo llegan a la base en la nube. */
  solo_demo: z.boolean(),
});
export type VectorStoreStatus = z.infer<typeof VectorStoreStatus>;

export const VectorCollection = z.object({
  indice: VectorIndexName,
  /** Nombre de la colección en Chroma ("blindaje-voz"); null sin Chroma. */
  coleccion: z.string().nullable(),
  dim: z.number().int(),
  /** Modelo que produce los vectores, como está en D1 (p. ej. "facebook/dinov2-small"). */
  modelo: z.string(),
  /** Vectores de casos indexados en D1 (fuente de verdad). */
  en_d1: z.number().int(),
  /** Vectores en la base vectorial; null si no respondió. */
  en_base: z.number().int().nullable(),
});
export type VectorCollection = z.infer<typeof VectorCollection>;

export const VectorPoint = z.object({
  /** Id numérico del vector (el mismo en D1, FAISS y Chroma). */
  id: z.number().int(),
  case_id: z.string(),
  /** Código del caso ("A"). */
  caso: z.string(),
  /** Qué representa: "V-1", "V-1 · 0:04–0:07", "Ficha", "IMG-2 · placa de vehículo". */
  ref: z.string(),
  /** Etiqueta de la evidencia de origen ("EV-A1"); null para la ficha. */
  evidencia: z.string().nullable(),
  /** Proyección a dos ejes, normalizada a [-1, 1]. */
  x: z.number(),
  y: z.number(),
  /** VECTOR_SAMPLE_BINS valores en [-1, 1] para dibujar la tira de números. */
  muestra: z.array(z.number()),
});
export type VectorPoint = z.infer<typeof VectorPoint>;

export const VectorMap = z.object({
  indice: VectorIndexName,
  /** Fracción de la varianza que explica cada eje (0 a 1). */
  varianza: z.tuple([z.number(), z.number()]),
  puntos: z.array(VectorPoint),
});
export type VectorMap = z.infer<typeof VectorMap>;

export const VectorCaseSummary = z.object({
  case_id: z.string(),
  caso: z.string(),
  /** Nombre del distrito ("San Juan de Lurigancho"), si lo tiene. */
  distrito: z.string().nullable(),
  evidencia: z.array(z.object({ label: z.string(), tipo: z.enum(["audio", "imagen", "video", "texto"]) })),
  vectores: z.record(VectorIndexName, z.number().int()),
  /** Identificadores (HMAC) del caso: se comparan exactos en D1, sin vectores. */
  identificadores: z.number().int(),
});
export type VectorCaseSummary = z.infer<typeof VectorCaseSummary>;

export const VectorOverview = z.object({
  almacen: VectorStoreStatus,
  colecciones: z.array(VectorCollection),
  casos: z.array(VectorCaseSummary),
  mapas: z.array(VectorMap),
});
export type VectorOverview = z.infer<typeof VectorOverview>;

export const VectorNeighbor = z.object({
  id: z.number().int(),
  case_id: z.string(),
  caso: z.string(),
  ref: z.string(),
  /** Coseno (1 − distancia coseno de Chroma, o producto interno de FAISS). */
  score: z.number(),
  /** Supera el umbral de búsqueda del índice (si lo tiene) y cuenta como candidato. */
  pasa: z.boolean(),
});
export type VectorNeighbor = z.infer<typeof VectorNeighbor>;

export const VectorQuery = z.object({
  indice: VectorIndexName,
  /** Id del vector del caso que se usó como consulta. */
  consulta: z.number().int(),
  ref: z.string(),
  k: z.number().int(),
  /** Umbral de búsqueda del índice: segmentos de voz y recortes de imagen; null en los demás. */
  umbral: z.number().nullable(),
  latencia_ms: z.number(),
  /** Vectores del mismo caso que la búsqueda deja fuera. */
  excluidos: z.number().int(),
  vecinos: z.array(VectorNeighbor),
});
export type VectorQuery = z.infer<typeof VectorQuery>;

export const CandidateSource = z.enum(["voz", "voz_segmento", "texto", "imagen", "identificador", "hash_perceptual"]);
export type CandidateSource = z.infer<typeof CandidateSource>;

export const VectorCandidate = z.object({
  case_id: z.string(),
  caso: z.string(),
  /** Por qué entró como candidato. */
  fuentes: z.array(CandidateSource),
  /** p de cada señal calibrada (sección 9.2). */
  senales: z.object({
    identificador: z.number().optional(),
    voz: z.number().optional(),
    imagen: z.number().optional(),
    modus_operandi: z.number().optional(),
  }),
  /** 1 − ∏(1 − pᵢ), antes del Vinculador. */
  puntaje: z.number(),
  estado: z.enum(["probable", "por_revisar", "descartado_auto"]),
});
export type VectorCandidate = z.infer<typeof VectorCandidate>;

export const VectorTrace = z.object({
  case_id: z.string(),
  caso: z.string(),
  proveedor: VectorProvider,
  consultas: z.array(VectorQuery),
  candidatos: z.array(VectorCandidate),
  umbrales: z.object({ probable: z.number(), revisar: z.number() }),
  total_ms: z.number(),
});
export type VectorTrace = z.infer<typeof VectorTrace>;

export const VectorSyncResult = z.object({
  proveedor: VectorProvider,
  /** Vectores escritos por índice. */
  sincronizados: z.record(VectorIndexName, z.number().int()),
  /** Vectores borrados de la base porque ya no están en D1 (o su caso no está indexado). */
  borrados: z.number().int(),
  ms: z.number(),
});
export type VectorSyncResult = z.infer<typeof VectorSyncResult>;
