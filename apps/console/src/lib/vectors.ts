import type {
  VectorCandidate,
  VectorCaseSummary,
  VectorIndexName,
  VectorNeighbor,
  VectorOverview,
  VectorPoint,
  VectorProvider,
  VectorQuery,
  VectorTrace,
} from "@blindaje/shared";
import { fmtScore } from "./format";

/**
 * Piezas puras del Motor vectorial (vista de administración): nombres de índices y modelos, la
 * escala divergente de la tira de números, los pasos del recorrido animado y lo que dice cada uno.
 * La vista solo los dibuja; los tests las usan sin DOM.
 */

export const INDEX_ORDER: VectorIndexName[] = ["voz", "voz_segmento", "texto", "imagen"];

export const INDEX_META: Record<VectorIndexName, { label: string; corto: string; paso: string; coleccion: string; lane: Lane }> = {
  voz: { label: "Huellas de voz", corto: "huellas de voz", paso: "Voces", coleccion: "blindaje-voz", lane: "voz" },
  voz_segmento: { label: "Segmentos de voz", corto: "segmentos de voz", paso: "Segmentos", coleccion: "blindaje-voz-segmento", lane: "voz" },
  texto: { label: "Fichas", corto: "fichas", paso: "Fichas", coleccion: "blindaje-texto", lane: "texto" },
  imagen: { label: "Recortes de imagen", corto: "recortes de imagen", paso: "Imágenes", coleccion: "blindaje-imagen", lane: "imagen" },
};

/** Carriles del recorrido: cada tipo de evidencia con su modelo. */
export type Lane = "voz" | "texto" | "imagen" | "identificadores";

export interface ModelInfo {
  /** Nombre corto del modelo que produce el vector. */
  nombre: string;
  /** Quién lo hizo o qué hace. */
  detalle: string;
  /** Paso previo (otro modelo) cuando lo hay. */
  previo: string | null;
}

const KNOWN_MODELS: Array<{ test: RegExp; info: ModelInfo }> = [
  { test: /ecapa|speechbrain/i, info: { nombre: "ECAPA-TDNN", detalle: "SpeechBrain · huella de voz", previo: null } },
  { test: /e5/i, info: { nombre: "multilingual-e5-small", detalle: "vuelve la ficha números", previo: "Muse Spark 1.3 escribe la ficha" } },
  { test: /dinov2/i, info: { nombre: "DINOv2 · Meta", detalle: "describe cada recorte", previo: "SAM 3.1 · Meta recorta la imagen" } },
];

/** Nombre para mostrar del modelo que está en D1 ("facebook/dinov2-small" → "DINOv2 · Meta"). */
export function modelInfo(modelo: string | null | undefined, lane: Lane): ModelInfo {
  if (lane === "identificadores") return { nombre: "HMAC-SHA256", detalle: "cifra cada número o cuenta", previo: null };
  const hit = modelo ? KNOWN_MODELS.find((m) => m.test.test(modelo)) : undefined;
  if (hit) return hit.info;
  const fallback = KNOWN_MODELS[lane === "voz" ? 0 : lane === "texto" ? 1 : 2]!.info;
  return modelo ? { ...fallback, nombre: modelo } : fallback;
}

export const PROVIDER_LABEL: Record<VectorProvider, string> = {
  "chroma-cloud": "Chroma Cloud",
  faiss: "FAISS · Meta",
  ninguno: "Sin base vectorial",
};

/** Tipo de índice de la base, en palabras. */
export function indexKind(p: VectorProvider): string {
  if (p === "chroma-cloud") return "índice SPANN · coseno";
  if (p === "faiss") return "IndexFlatIP · coseno";
  return "sin índice";
}

// ---------------------------------------------------------------------------
// Escala divergente de la tira de números (validada con el script de dataviz: cada brazo es
// monótono en luminosidad, de un solo tono y su extremo claro se distingue del papel).
// ---------------------------------------------------------------------------

export const DIVERGING = { neg: "#105483", mid: "#ddd3c6", pos: "#9e3a1f" } as const;

type Lab = [number, number, number];

const toLin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLin = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

function hexToLab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLin);
  return `#${rgb.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

const LAB = { neg: hexToLab(DIVERGING.neg), mid: hexToLab(DIVERGING.mid), pos: hexToLab(DIVERGING.pos) };

/** Color de un valor en [-1, 1]: azul petróleo para los negativos, ladrillo para los positivos. */
export function divergingColor(value: number): string {
  const v = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  const end = v < 0 ? LAB.neg : LAB.pos;
  const t = Math.abs(v);
  return labToHex([0, 1, 2].map((i) => LAB.mid[i]! + (end[i]! - LAB.mid[i]!) * t) as Lab);
}

// ---------------------------------------------------------------------------
// Datos de un caso
// ---------------------------------------------------------------------------

export function pointsOf(overview: VectorOverview, indice: VectorIndexName): VectorPoint[] {
  return overview.mapas.find((m) => m.indice === indice)?.puntos ?? [];
}

export function casePoints(overview: VectorOverview, caseId: string, indice: VectorIndexName): VectorPoint[] {
  return pointsOf(overview, indice).filter((p) => p.case_id === caseId);
}

/** Índices con vectores del caso, en el orden del recorrido. */
export function caseIndices(c: VectorCaseSummary): VectorIndexName[] {
  return INDEX_ORDER.filter((i) => (c.vectores[i] ?? 0) > 0);
}

/** Carriles del caso: voz si tiene huellas, texto si tiene ficha, imagen si tiene recortes, identificadores si tiene. */
export function caseLanes(c: VectorCaseSummary): Lane[] {
  const out: Lane[] = [];
  if ((c.vectores.voz ?? 0) + (c.vectores.voz_segmento ?? 0) > 0) out.push("voz");
  if ((c.vectores.texto ?? 0) > 0) out.push("texto");
  if ((c.vectores.imagen ?? 0) > 0) out.push("imagen");
  if (c.identificadores > 0) out.push("identificadores");
  return out;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listEs(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function evidenceSummary(c: VectorCaseSummary): string {
  const n = (t: string) => c.evidencia.filter((e) => e.tipo === t).length;
  const parts = [
    n("audio") ? plural(n("audio"), "audio", "audios") : null,
    n("texto") ? plural(n("texto"), "texto", "textos") : null,
    n("imagen") ? plural(n("imagen"), "imagen", "imágenes") : null,
    n("video") ? plural(n("video"), "video", "videos") : null,
  ].filter((x): x is string => Boolean(x));
  return `${plural(c.evidencia.length, "evidencia", "evidencias")}: ${listEs(parts)}`;
}

// ---------------------------------------------------------------------------
// Vecinos de una búsqueda
// ---------------------------------------------------------------------------

export interface AggregatedNeighbor extends VectorNeighbor {
  /** Vector del caso cuya consulta dio el mejor coseno con este vecino. */
  desde: number;
}

/**
 * Mejor coseno por vecino entre todas las consultas de un índice: una línea por vecino en el mapa,
 * desde la consulta que más se le parece. `pasa` si alguna consulta lo dejó pasar.
 */
export function aggregateNeighbors(queries: VectorQuery[]): AggregatedNeighbor[] {
  const best = new Map<number, AggregatedNeighbor>();
  for (const q of queries) {
    for (const n of q.vecinos) {
      const cur = best.get(n.id);
      if (!cur || n.score > cur.score) best.set(n.id, { ...n, pasa: n.pasa || Boolean(cur?.pasa), desde: q.consulta });
      else if (n.pasa && !cur.pasa) cur.pasa = true;
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export function queriesOf(trace: VectorTrace | null | undefined, indice: VectorIndexName): VectorQuery[] {
  return trace?.consultas.filter((q) => q.indice === indice) ?? [];
}

export function fmtMs(ms: number): string {
  return `${Math.round(ms).toLocaleString("es-PE")} ms`;
}

/** "128 ms" o "entre 98 y 190 ms". */
export function latencyText(queries: VectorQuery[]): string {
  if (!queries.length) return "";
  const ls = queries.map((q) => q.latencia_ms);
  const lo = Math.min(...ls);
  const hi = Math.max(...ls);
  return Math.round(lo) === Math.round(hi) ? fmtMs(lo) : `entre ${Math.round(lo)} y ${fmtMs(hi)}`;
}

/** Lo que dice el paso de búsqueda de un índice, con el proveedor de verdad. */
export function searchSummary(indice: VectorIndexName, queries: VectorQuery[], provider: VectorProvider): string {
  const col = INDEX_META[indice].coleccion;
  const who = provider === "faiss" ? "FAISS" : "Chroma";
  if (!queries.length) return `En ${col} no hubo consultas.`;
  const vecinos = aggregateNeighbors(queries);
  const pasan = vecinos.filter((v) => v.pasa).length;
  const casos = new Set(vecinos.filter((v) => v.pasa).map((v) => v.caso));
  const excl = Math.max(...queries.map((q) => q.excluidos));
  const head = `En ${col}, ${who} respondió ${plural(queries.length, "consulta", "consultas")} en ${latencyText(queries)}.`;
  if (!vecinos.length) return `${head} No hay vectores de otros casos en esta colección.`;
  const umbral = queries.find((q) => q.umbral !== null)?.umbral ?? null;
  const pasanTxt =
    umbral === null
      ? `${plural(vecinos.length, "vecino", "vecinos")} de ${plural(casos.size, "caso", "casos")}`
      : `${plural(vecinos.length, "vecino", "vecinos")}; ${pasan === 1 ? "1 pasa" : `${pasan} pasan`} el umbral de ${fmtScore(umbral)}`;
  return `${head} ${pasanTxt[0]!.toUpperCase()}${pasanTxt.slice(1)}.${excl ? ` Los ${plural(excl, "vector", "vectores")} del mismo caso no cuentan.` : ""}`;
}

// ---------------------------------------------------------------------------
// Señales y puntaje
// ---------------------------------------------------------------------------

export type SignalKey = keyof VectorCandidate["senales"];

export const SIGNAL_ORDER: SignalKey[] = ["identificador", "voz", "imagen", "modus_operandi"];

/** Mismos colores y formas que la leyenda del grafo (DESIGN.md, Señales). */
export const SIGNAL_META: Record<SignalKey, { label: string; color: string; borde: string; forma: "rombo" | "circulo" | "hexagono" | "etiqueta" }> = {
  identificador: { label: "Identificador igual", color: "#21763c", borde: "#045725", forma: "rombo" },
  voz: { label: "Voz", color: "#c59711", borde: "#815d00", forma: "circulo" },
  imagen: { label: "Imagen", color: "#105483", borde: "#003860", forma: "hexagono" },
  modus_operandi: { label: "Modus operandi", color: "#bf71a6", borde: "#793d67", forma: "etiqueta" },
};

/** "1 − (1 − 0.95) × (1 − 0.85) = 0.99" con las señales que tiene el candidato. */
export function combineFormula(c: VectorCandidate): string {
  const ps = SIGNAL_ORDER.map((k) => c.senales[k]).filter((p): p is number => typeof p === "number");
  if (!ps.length) return `Sin señales: ${fmtScore(c.puntaje)}`;
  return `1 − ${ps.map((p) => `(1 − ${fmtScore(p)})`).join(" × ")} = ${fmtScore(c.puntaje)}`;
}

export const ESTADO_DESTINO: Record<VectorCandidate["estado"], string> = {
  probable: "Va a la cola de revisión, arriba",
  por_revisar: "Va a la cola de revisión",
  descartado_auto: "Se guarda para recalibrar; no se muestra",
};

export const SOURCE_LABEL: Record<VectorCandidate["fuentes"][number], string> = {
  voz: "huella de voz",
  voz_segmento: "segmentos de voz",
  texto: "ficha",
  imagen: "recorte de imagen",
  identificador: "identificador igual",
  hash_perceptual: "hash de imagen",
};

// ---------------------------------------------------------------------------
// Pasos del recorrido
// ---------------------------------------------------------------------------

export type StepKind = "evidencia" | "modelos" | "vectores" | "base" | "busqueda" | "senales" | "revision";

export interface Step {
  kind: StepKind;
  /** Solo en "busqueda": la colección que se consulta. */
  indice?: VectorIndexName;
  titulo: string;
  /** Título corto para la lista de pasos (las búsquedas llevan el ícono de buscar). */
  corto?: string;
}

/** Pasos del recorrido de un caso: una búsqueda por cada índice con vectores del caso. */
export function buildSteps(c: VectorCaseSummary): Step[] {
  const steps: Step[] = [
    { kind: "evidencia", titulo: "Evidencia" },
    { kind: "modelos", titulo: "Modelos" },
    { kind: "vectores", titulo: "Vectores" },
    { kind: "base", titulo: "Guardar" },
  ];
  for (const i of caseIndices(c)) steps.push({ kind: "busqueda", indice: i, titulo: `Buscar ${INDEX_META[i].paso.toLowerCase()}`, corto: INDEX_META[i].paso });
  steps.push({ kind: "senales", titulo: "Señales" }, { kind: "revision", titulo: "Revisión humana" });
  return steps;
}

/** Duración de cada paso a velocidad normal (ms). Las búsquedas crecen con los vecinos que dibujan. */
export function stepDuration(step: Step, trace: VectorTrace | null): number {
  switch (step.kind) {
    case "evidencia":
      return 2200;
    case "modelos":
      return 2600;
    case "vectores":
      return 3000;
    case "base":
      return 2800;
    case "busqueda": {
      const qs = queriesOf(trace, step.indice!);
      const n = aggregateNeighbors(qs).length;
      return Math.min(5200, 1800 + qs.length * 140 + n * 380);
    }
    case "senales":
      return 3200;
    case "revision":
      return 0;
  }
}

/** Texto del paso para la región que anuncian los lectores de pantalla (y la leyenda visible). */
export function stepDescription(step: Step, c: VectorCaseSummary, overview: VectorOverview, trace: VectorTrace | null, loading: boolean): string {
  const provider = trace?.proveedor ?? overview.almacen.proveedor;
  const who = PROVIDER_LABEL[provider];
  switch (step.kind) {
    case "evidencia":
      return `El caso ${c.caso} trae ${evidenceSummary(c)}. Todo es ficticio.`;
    case "modelos": {
      const lanes = caseLanes(c);
      const parts: string[] = [];
      if (lanes.includes("voz")) parts.push("los audios pasan por ECAPA-TDNN");
      if (lanes.includes("texto")) parts.push("Muse Spark 1.3 escribe la ficha y multilingual-e5-small la lee");
      if (lanes.includes("imagen")) parts.push("SAM 3.1 recorta las imágenes y DINOv2 describe cada recorte");
      if (lanes.includes("identificadores")) parts.push("los números y cuentas se cifran con HMAC");
      return `Cada evidencia pasa por su modelo: ${listEs(parts)}.`;
    }
    case "vectores": {
      const dims = caseIndices(c).map((i) => overview.colecciones.find((k) => k.indice === i)?.dim ?? 0);
      const uniq = [...new Set(dims.filter(Boolean))];
      const dimTxt = uniq.length ? listEs(uniq.map((d) => `${d}`)) : "cientos de";
      return `Cada modelo devuelve una lista de ${dimTxt} números: el vector. Mostramos 32 de esos números por vector, en color.`;
    }
    case "base": {
      const parts = caseIndices(c).map((i) => `${c.vectores[i]} en ${INDEX_META[i].coleccion}`);
      return `Los vectores se guardan en ${who}${overview.almacen.base ? `, base ${overview.almacen.base}` : ""}: ${listEs(parts)}. Los identificadores no: se comparan exactos en D1.`;
    }
    case "busqueda": {
      const i = step.indice!;
      if (loading || !trace) return `Consultando ${who}: buscando en ${INDEX_META[i].coleccion} los vectores más parecidos a los del caso ${c.caso}…`;
      return searchSummary(i, queriesOf(trace, i), provider);
    }
    case "senales": {
      if (!trace) return "Calculando las señales…";
      if (!trace.candidatos.length) return "Ningún caso parecido pasó los filtros: no hay señales que calcular.";
      return `Con ${plural(trace.candidatos.length, "caso candidato", "casos candidatos")} se calculan las señales calibradas: identificador, voz, imagen y modus operandi, cada una con su probabilidad.`;
    }
    case "revision": {
      if (!trace) return "";
      const toQueue = trace.candidatos.filter((x) => x.estado !== "descartado_auto").map((x) => x.caso);
      const head = "El puntaje combina las señales: 1 − ∏(1 − p).";
      const q = toQueue.length
        ? ` ${listEs(toQueue)} ${toQueue.length === 1 ? "va" : "van"} a la cola de revisión humana.`
        : " Ningún candidato llega al umbral de revisión.";
      return `${head}${q} Ningún vínculo se crea solo: lo decide una persona del equipo.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Mapa (proyección a dos ejes)
// ---------------------------------------------------------------------------

export const MAP = { w: 300, h: 210, pad: 16 } as const;

export function toSvg(p: { x: number; y: number }): { cx: number; cy: number } {
  const iw = MAP.w - 2 * MAP.pad;
  const ih = MAP.h - 2 * MAP.pad;
  return { cx: MAP.pad + ((p.x + 1) / 2) * iw, cy: MAP.pad + ((1 - p.y) / 2) * ih };
}

export interface PlacedLabel {
  id: number;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "end";
}

/**
 * Etiquetas directas de los vecinos (como máximo `max`): prueba a la derecha, a la izquierda, arriba
 * y abajo del punto, y se queda con el primer lugar que no pisa otra etiqueta ni un punto de
 * `obstacles` (los vectores del caso y los demás vecinos). Si ninguno sirve, la empuja hacia abajo.
 */
export function placeLabels(
  items: Array<{ id: number; text: string; cx: number; cy: number }>,
  max = 3,
  obstacles: Array<{ cx: number; cy: number }> = [],
): PlacedLabel[] {
  const placed: Array<PlacedLabel & { box: [number, number, number, number] }> = [];
  const H = 12;
  const R = 6.5;
  const boxOf = (x: number, y: number, w: number, anchor: "start" | "end"): [number, number, number, number] =>
    anchor === "start" ? [x, y - H + 2, x + w, y + 2] : [x - w, y - H + 2, x, y + 2];
  const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const inside = (b: [number, number, number, number]) => b[0] >= 2 && b[2] <= MAP.w - 2 && b[1] >= 2 && b[3] <= MAP.h - 2;
  for (const it of items.slice(0, max)) {
    const w = it.text.length * 6.2;
    const others = [...obstacles, ...items.filter((o) => o.id !== it.id)].filter((o) => o.cx !== it.cx || o.cy !== it.cy);
    const free = (b: [number, number, number, number]) =>
      inside(b) && !placed.some((p) => overlaps(p.box, b)) && !others.some((o) => overlaps(b, [o.cx - R, o.cy - R, o.cx + R, o.cy + R]));
    const tries: Array<{ x: number; y: number; anchor: "start" | "end" }> = [
      { x: it.cx + 9, y: it.cy + 4, anchor: "start" },
      { x: it.cx - 9, y: it.cy + 4, anchor: "end" },
      { x: it.cx - w / 2, y: it.cy - 9, anchor: "start" },
      { x: it.cx - w / 2, y: it.cy + 18, anchor: "start" },
      { x: it.cx + 7, y: it.cy - 8, anchor: "start" },
      { x: it.cx - 7, y: it.cy - 8, anchor: "end" },
      { x: it.cx + 7, y: it.cy + 16, anchor: "start" },
      { x: it.cx - 7, y: it.cy + 16, anchor: "end" },
    ];
    let pick = tries.find((t) => free(boxOf(t.x, t.y, w, t.anchor)));
    if (!pick) {
      const right = it.cx + 9 + w <= MAP.w - 2;
      pick = { x: right ? it.cx + 9 : it.cx - 9, y: it.cy + 4, anchor: right ? "start" : "end" };
      for (let guard = 0; guard < 8 && placed.some((p) => overlaps(p.box, boxOf(pick!.x, pick!.y, w, pick!.anchor))); guard++) pick.y += H + 2;
    }
    const y = Math.min(Math.max(pick.y, 12), MAP.h - 4);
    placed.push({ id: it.id, text: it.text, x: pick.x, y, anchor: pick.anchor, box: boxOf(pick.x, y, w, pick.anchor) });
  }
  return placed.map(({ box: _box, ...p }) => p);
}

/** Un vecino por caso (el de mejor coseno): la etiqueta dice el caso, no cada segmento. */
export function bestPerCase<T extends { caso: string; score: number }>(items: T[]): T[] {
  const best = new Map<string, T>();
  for (const it of items) {
    const cur = best.get(it.caso);
    if (!cur || it.score > cur.score) best.set(it.caso, it);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export function fmtVarianza(v: [number, number]): string {
  return `${Math.round(v[0] * 100)} % y ${Math.round(v[1] * 100)} %`;
}
