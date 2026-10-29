import {
  combineSignals,
  DEFAULT_CALIBRATION,
  logistic,
  statusForScore,
  VECTOR_SAMPLE_BINS,
  type VectorCandidate,
  type VectorCaseSummary,
  type VectorIndexName,
  type VectorOverview,
  type VectorPoint,
  type VectorQuery,
  type VectorSyncResult,
  type VectorTrace,
} from "@blindaje/shared";
import { ApiRequestError } from "../api/client";
import type { VectorsActor, VectorsApi } from "../api/vectors";

/**
 * Motor vectorial simulado: los siete casos ficticios indexados del demo (A a G) con la misma forma
 * que los datos en vivo. Cada vector tiene un "latente" pequeño (24 números) con el que se calculan
 * los cosenos de verdad; los puntos del mapa salen de grupos fijos (la misma voz en A, B y C; el
 * mismo modus operandi en A, B y C, parecido en D y E). Determinista: siempre los mismos números.
 */

const LATENT = 24;
/** La calibración que usa la API en vivo (umbral de segmentos de voz de la evaluación). */
const CAL = { ...DEFAULT_CALIBRATION, voz: { ...DEFAULT_CALIBRATION.voz, b: 0.6006 } };
const K: Record<VectorIndexName, number> = { voz: 10, voz_segmento: 20, texto: 10, imagen: 10 };
const UMBRAL: Record<VectorIndexName, number | null> = {
  voz: null,
  voz_segmento: CAL.voz.b,
  texto: null,
  imagen: 0.5,
};
const MODEL: Record<VectorIndexName, { modelo: string; dim: number }> = {
  voz: { modelo: "speechbrain/spkrec-ecapa-voxceleb", dim: 192 },
  voz_segmento: { modelo: "speechbrain/spkrec-ecapa-voxceleb", dim: 192 },
  texto: { modelo: "intfloat/multilingual-e5-small", dim: 384 },
  imagen: { modelo: "facebook/dinov2-small", dim: 384 },
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const unit = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number) => Math.max(-0.95, Math.min(0.95, n));

interface Cluster {
  center: number[];
  pattern: number[];
  /** Centro en el mapa de cada índice donde aparece. */
  at: { x: number; y: number; spread: number };
}

interface MockVec {
  point: VectorPoint;
  indice: VectorIndexName;
  cluster: string;
  latent: number[];
}

/** Coseno "como lo daría el modelo": con e5, todas las fichas ficticias se parecen (0.93 a 0.97). */
function scoreFor(indice: VectorIndexName, c: number): number {
  if (indice === "texto") return round(0.93 + 0.04 * ((Math.max(-1, Math.min(1, c)) + 1) / 2));
  return round(Math.max(-0.2, Math.min(0.99, c)));
}

const CASES: Array<Omit<VectorCaseSummary, "case_id" | "vectores"> & { code: string }> = [
  {
    code: "A",
    caso: "A",
    distrito: "San Juan de Lurigancho",
    identificadores: 3,
    evidencia: [
      { label: "EV-A1", tipo: "audio" },
      { label: "EV-A2", tipo: "audio" },
      { label: "EV-A3", tipo: "texto" },
      { label: "EV-A4", tipo: "imagen" },
      { label: "EV-A5", tipo: "texto" },
    ],
  },
  {
    code: "B",
    caso: "B",
    distrito: "Comas",
    identificadores: 2,
    evidencia: [
      { label: "EV-B1", tipo: "audio" },
      { label: "EV-B2", tipo: "texto" },
      { label: "EV-B3", tipo: "texto" },
    ],
  },
  {
    code: "C",
    caso: "C",
    distrito: "San Juan de Lurigancho",
    identificadores: 1,
    evidencia: [
      { label: "EV-C1", tipo: "audio" },
      { label: "EV-C2", tipo: "texto" },
      { label: "EV-C3", tipo: "texto" },
    ],
  },
  ...(["D", "E", "F", "G"] as const).map((code, i) => ({
    code,
    caso: code,
    distrito: "San Juan de Lurigancho",
    identificadores: i === 1 || i === 3 ? 0 : 1,
    evidencia: [
      { label: `EV-${code}1`, tipo: "texto" as const },
      { label: `EV-${code}2`, tipo: "texto" as const },
    ],
  })),
];

const caseId = (code: string) => `caso-demo-${code.toLowerCase()}`;

/** Casos que comparten un identificador (el mismo Yape en B y C). */
const SHARED_IDS = new Set(["B|C"]);

function buildData() {
  const r = rng(20261029);
  const clusters = new Map<string, Cluster>();
  const cluster = (name: string, at: Cluster["at"]) => {
    const c: Cluster = {
      center: unit(Array.from({ length: LATENT }, () => gauss(r))),
      pattern: Array.from({ length: VECTOR_SAMPLE_BINS }, () => gauss(r)),
      at,
    };
    clusters.set(name, c);
    return name;
  };

  const vecs: MockVec[] = [];
  let nextId = 101;
  const add = (indice: VectorIndexName, code: string, ref: string, evidencia: string | null, clusterName: string, noise = 0.11) => {
    const cl = clusters.get(clusterName)!;
    const latent = unit(cl.center.map((x) => x + gauss(r) * noise));
    const raw = cl.pattern.map((x) => x + gauss(r) * 0.45);
    const max = Math.max(...raw.map(Math.abs)) || 1;
    // Lugar en el mapa: dentro del grupo, lejos de los puntos ya puestos (que no se tapen).
    const near = vecs.filter((v) => v.indice === indice).map((v) => v.point);
    let best = { x: cl.at.x, y: cl.at.y, gap: -1 };
    for (let t = 0; t < 40 && best.gap < 0.15; t++) {
      const ang = r() * Math.PI * 2;
      const dist = Math.sqrt(r()) * cl.at.spread;
      const x = clamp(cl.at.x + Math.cos(ang) * dist);
      const y = clamp(cl.at.y + Math.sin(ang) * dist);
      const gap = near.length ? Math.min(...near.map((q) => Math.hypot(q.x - x, q.y - y))) : 1;
      if (gap > best.gap) best = { x, y, gap };
    }
    vecs.push({
      indice,
      cluster: clusterName,
      latent,
      point: {
        id: nextId++,
        case_id: caseId(code),
        caso: code,
        ref,
        evidencia,
        x: round(best.x, 3),
        y: round(best.y, 3),
        muestra: raw.map((x) => round(x / max, 3)),
      },
    });
  };

  // Voz: la misma voz en A (V-1) y B (V-3); C (V-4) es otra voz; A tiene una segunda voz (V-2).
  cluster("voz:ext1", { x: 0.45, y: 0.3, spread: 0.3 });
  cluster("voz:ext2", { x: -0.55, y: -0.48, spread: 0.08 });
  cluster("voz:ext3", { x: -0.1, y: 0.62, spread: 0.08 });
  add("voz", "A", "V-1", "EV-A1", "voz:ext1");
  add("voz", "A", "V-2", "EV-A2", "voz:ext2");
  add("voz", "B", "V-3", "EV-B1", "voz:ext1");
  add("voz", "C", "V-4", "EV-C1", "voz:ext3");

  // Segmentos de 3 s: sus centros caen cerca de la huella de la que salen, más dispersos.
  cluster("seg:ext1", { x: 0.36, y: 0.2, spread: 0.5 });
  cluster("seg:ext2", { x: -0.6, y: -0.55, spread: 0.25 });
  cluster("seg:ext3", { x: -0.25, y: 0.62, spread: 0.2 });
  const seg = (code: string, v: string, ev: string, cl: string, n: number, from: number) => {
    for (let i = 0; i < n; i++) {
      const s = from + i * 4;
      const fmt = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
      add("voz_segmento", code, `${v} · ${fmt(s)}–${fmt(s + 3)}`, ev, cl, 0.17);
    }
  };
  seg("A", "V-1", "EV-A1", "seg:ext1", 5, 4);
  seg("A", "V-2", "EV-A2", "seg:ext2", 2, 2);
  seg("B", "V-3", "EV-B1", "seg:ext1", 4, 3);
  seg("C", "V-4", "EV-C1", "seg:ext3", 2, 6);

  // Fichas: el mismo modus operandi en A, B y C; parecido en D y E; F y G aparte.
  cluster("mo:1", { x: 0.32, y: 0.36, spread: 0.45 });
  cluster("mo:2", { x: -0.3, y: -0.05, spread: 0.3 });
  cluster("mo:f", { x: -0.7, y: -0.6, spread: 0.05 });
  cluster("mo:g", { x: 0.74, y: -0.56, spread: 0.05 });
  for (const code of ["A", "B", "C"]) add("texto", code, "Ficha", null, "mo:1", 0.16);
  for (const code of ["D", "E"]) add("texto", code, "Ficha", null, "mo:2", 0.2);
  add("texto", "F", "Ficha", null, "mo:f");
  add("texto", "G", "Ficha", null, "mo:g");

  // Recortes de imagen: solo el caso A tiene imágenes.
  cluster("img:bala", { x: -0.6, y: 0.5, spread: 0.02 });
  cluster("img:nota", { x: 0.62, y: 0.22, spread: 0.02 });
  cluster("img:full", { x: 0.02, y: -0.62, spread: 0.02 });
  add("imagen", "A", "IMG-1 · bala", "EV-A4", "img:bala");
  add("imagen", "A", "IMG-2 · nota escrita a mano", "EV-A4", "img:nota");
  add("imagen", "A", "IMG-3 · imagen completa", "EV-A4", "img:full");

  return vecs;
}

const VECS = buildData();

const VARIANZA: Record<VectorIndexName, [number, number]> = {
  voz: [0.71, 0.21],
  voz_segmento: [0.31, 0.15],
  texto: [0.34, 0.23],
  imagen: [0.52, 0.48],
};

function summaries(): VectorCaseSummary[] {
  return CASES.map((c) => {
    const vectores = { voz: 0, voz_segmento: 0, texto: 0, imagen: 0 } as Record<VectorIndexName, number>;
    for (const v of VECS) if (v.point.caso === c.code) vectores[v.indice] += 1;
    return { case_id: caseId(c.code), caso: c.caso, distrito: c.distrito, evidencia: c.evidencia, vectores, identificadores: c.identificadores };
  });
}

/** Panorama simulado, con la base sincronizada. Exportado para los tests. */
export function mockVectorOverview(syncedAt = "2026-10-29T14:02:00Z"): VectorOverview {
  const indices: VectorIndexName[] = ["voz", "voz_segmento", "texto", "imagen"];
  return {
    almacen: { proveedor: "chroma-cloud", base: "blindaje", conectado: true, latencia_ms: 132, sincronizado_en: syncedAt, solo_demo: true },
    colecciones: indices.map((i) => {
      const n = VECS.filter((v) => v.indice === i).length;
      return {
        indice: i,
        coleccion: `blindaje-${i === "voz_segmento" ? "voz-segmento" : i}`,
        dim: MODEL[i].dim,
        modelo: MODEL[i].modelo,
        en_d1: n,
        en_base: n,
      };
    }),
    casos: summaries(),
    mapas: indices.map((i) => ({ indice: i, varianza: VARIANZA[i], puntos: VECS.filter((v) => v.indice === i).map((v) => v.point) })),
  };
}

/** Recorrido simulado de un caso: las mismas consultas y señales que haría el motor. Exportado para los tests. */
export function mockVectorTrace(id: string): VectorTrace {
  const me = CASES.find((c) => caseId(c.code) === id);
  if (!me) throw new ApiRequestError(404, "not_found", "El caso no existe o no está indexado");
  const r = rng(id.split("").reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7));
  const cal = CAL;
  const consultas: VectorQuery[] = [];
  const indices: VectorIndexName[] = ["voz", "voz_segmento", "texto", "imagen"];
  const fuentes = new Map<string, Set<VectorCandidate["fuentes"][number]>>();

  for (const indice of indices) {
    const own = VECS.filter((v) => v.indice === indice && v.point.case_id === id);
    const others = VECS.filter((v) => v.indice === indice && v.point.case_id !== id);
    for (const q of own) {
      const umbral = UMBRAL[indice];
      const vecinos = others
        .map((o) => {
          const score = scoreFor(indice, dot(q.latent, o.latent));
          return { id: o.point.id, case_id: o.point.case_id, caso: o.point.caso, ref: o.point.ref, score, pasa: umbral === null || score >= umbral };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, K[indice]);
      for (const n of vecinos) {
        if (!n.pasa) continue;
        if (!fuentes.has(n.case_id)) fuentes.set(n.case_id, new Set());
        fuentes.get(n.case_id)!.add(indice);
      }
      consultas.push({
        indice,
        consulta: q.point.id,
        ref: q.point.ref,
        k: K[indice],
        umbral,
        latencia_ms: Math.round(165 + r() * 30),
        excluidos: own.length,
        vecinos,
      });
    }
  }
  for (const other of CASES) {
    if (other.code === me.code) continue;
    const key = [me.code, other.code].sort().join("|");
    if (!SHARED_IDS.has(key)) continue;
    if (!fuentes.has(caseId(other.code))) fuentes.set(caseId(other.code), new Set());
    fuentes.get(caseId(other.code))!.add("identificador");
  }

  const candidatos: VectorCandidate[] = [...fuentes.entries()].map(([otherId, src]) => {
    const other = CASES.find((c) => caseId(c.code) === otherId)!;
    const mine = (i: VectorIndexName) => VECS.filter((v) => v.indice === i && v.point.case_id === id);
    const theirs = (i: VectorIndexName) => VECS.filter((v) => v.indice === i && v.point.case_id === otherId);
    const senales: VectorCandidate["senales"] = {};
    if (src.has("identificador")) senales.identificador = cal.identificador.p;
    let bestVoice = -1;
    for (const a of mine("voz")) for (const b of theirs("voz")) bestVoice = Math.max(bestVoice, dot(a.latent, b.latent));
    if (bestVoice > -1) {
      let matched = 0;
      for (const a of mine("voz_segmento")) if (theirs("voz_segmento").some((b) => dot(a.latent, b.latent) >= cal.voz.b)) matched++;
      const base = Math.min(logistic(bestVoice, cal.voz.a, cal.voz.b), cal.voz.p_max);
      senales.voz = round(matched >= cal.voz.min_segmentos ? base : base * 0.5 * (matched / cal.voz.min_segmentos));
    }
    const ta = mine("texto")[0];
    const tb = theirs("texto")[0];
    if (ta && tb) {
      const cos = scoreFor("texto", dot(ta.latent, tb.latent));
      const sameMo = ta.cluster === tb.cluster;
      const x = cos + (sameMo ? 0.05 : 0);
      senales.modus_operandi = round(Math.min(logistic(x, cal.mo.a, cal.mo.b), cal.mo.p_max));
    }
    const ps = [senales.identificador, senales.voz, senales.imagen, senales.modus_operandi].filter((p): p is number => typeof p === "number");
    const puntaje = round(combineSignals(ps));
    return { case_id: otherId, caso: other.caso, fuentes: [...src], senales, puntaje, estado: statusForScore(puntaje, cal) };
  });
  candidatos.sort((a, b) => b.puntaje - a.puntaje);

  return {
    case_id: id,
    caso: me.caso,
    proveedor: "chroma-cloud",
    consultas,
    candidatos,
    umbrales: { probable: cal.thresholds.probable, revisar: cal.thresholds.revisar },
    total_ms: consultas.reduce((s, q) => s + q.latencia_ms, 0) + 38,
  };
}

/**
 * La API simulada: aplica el mismo permiso que la real (solo admin) y espera lo que tardarían las
 * consultas a Chroma, para que el estado "Consultando…" se vea. `latency: 0` en los tests.
 */
export class MockVectorsApi implements VectorsApi {
  private syncedAt = "2026-10-29T14:02:00Z";
  private readonly latency: number;

  constructor(
    private readonly actor: VectorsActor,
    opts: { latency?: number } = {},
  ) {
    this.latency = opts.latency ?? 1;
  }

  private async wait(ms: number): Promise<void> {
    const t = ms * this.latency;
    if (t > 0) await new Promise((r) => setTimeout(r, t));
  }

  private check(): void {
    if (this.actor.role !== "admin") throw new ApiRequestError(403, "forbidden", "Tu rol no tiene permiso para esta acción.");
  }

  async overview(): Promise<VectorOverview> {
    this.check();
    await this.wait(350);
    return mockVectorOverview(this.syncedAt);
  }

  async trace(id: string): Promise<VectorTrace> {
    this.check();
    const t = mockVectorTrace(id);
    // La API en vivo tarda unos segundos (D1 y 13 consultas a Chroma en el caso A).
    await this.wait(Math.min(t.total_ms + 300, 3200));
    return t;
  }

  async sync(): Promise<VectorSyncResult> {
    this.check();
    await this.wait(1100);
    this.syncedAt = new Date().toISOString();
    const sincronizados = { voz: 0, voz_segmento: 0, texto: 0, imagen: 0 } as Record<VectorIndexName, number>;
    for (const v of VECS) sincronizados[v.indice] += 1;
    return { proveedor: "chroma-cloud", sincronizados, borrados: 0, ms: 1184 };
  }
}
