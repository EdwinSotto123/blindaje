import * as S from "@blindaje/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HttpClient, MemoryTokenStore } from "../api/client";
import { HttpVectorsApi } from "../api/vectors";
import { NAV } from "../components/Layout";
import { can } from "../lib/permissions";
import {
  aggregateNeighbors,
  buildSteps,
  combineFormula,
  divergingColor,
  DIVERGING,
  placeLabels,
  queriesOf,
  searchSummary,
  stepDescription,
} from "../lib/vectors";
import { mockVectorOverview, mockVectorTrace, MockVectorsApi } from "../mock/vectorsMock";
import { CollectionsTable, StoreStrip, syncText, WalkStage } from "./VectorsView";

const BASE = "https://api.blindaje.test";
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const ov = mockVectorOverview();
const caseOf = (code: string) => ov.casos.find((c) => c.caso === code)!;
const A = caseOf("A");
const traceA = mockVectorTrace(A.case_id);
const stepsA = buildSteps(A);
const at = (kind: string, indice?: string) => stepsA.findIndex((s) => s.kind === kind && (!indice || s.indice === indice));

function stage(stepIdx: number, trace: S.VectorTrace | null, loading = false) {
  return renderToStaticMarkup(<WalkStage overview={ov} c={A} steps={stepsA} stepIdx={stepIdx} trace={trace} loading={loading} />);
}

describe("datos simulados del motor vectorial", () => {
  it("cumplen el contrato: muestras de 32 números y puntos dentro del mapa", () => {
    expect(S.VectorOverview.safeParse(ov).success).toBe(true);
    for (const m of ov.mapas) {
      for (const p of m.puntos) {
        expect(p.muestra).toHaveLength(S.VECTOR_SAMPLE_BINS);
        expect(p.muestra.every((v) => v >= -1 && v <= 1)).toBe(true);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      }
    }
    // Los mismos conteos que los datos en vivo: 4 huellas, 13 segmentos, 7 fichas y 3 recortes.
    expect(Object.fromEntries(ov.colecciones.map((k) => [k.indice, k.en_d1]))).toEqual({ voz: 4, voz_segmento: 13, texto: 7, imagen: 3 });
    expect(A.vectores).toEqual({ voz: 2, voz_segmento: 7, texto: 1, imagen: 3 });
    expect(ov.mapas.flatMap((m) => m.puntos).filter((p) => p.caso === "A").map((p) => p.ref)).toContain("V-1 · 0:04–0:07");
  });

  it("cada recorrido es coherente: puntaje combinado, estado por umbral y sin vecinos del mismo caso", () => {
    for (const c of ov.casos) {
      const t = mockVectorTrace(c.case_id);
      expect(S.VectorTrace.safeParse(t).success).toBe(true);
      for (const q of t.consultas) expect(q.vecinos.every((n) => n.case_id !== c.case_id)).toBe(true);
      for (const k of t.candidatos) {
        const ps = Object.values(k.senales);
        expect(k.puntaje).toBeCloseTo(S.combineSignals(ps), 3);
        expect(k.estado).toBe(S.statusForScore(k.puntaje));
      }
    }
    // Como en vivo: A y B comparten la voz (0.85) y el modus operandi (0.40) y quedan en 0.91,
    // probable; los demás llegan por la ficha (todas se parecen) y se quedan en 0.40, descartados.
    expect(traceA.candidatos[0]).toMatchObject({ caso: "B", estado: "probable", puntaje: 0.91, senales: { voz: 0.85, modus_operandi: 0.4 } });
    expect(traceA.candidatos[0]!.fuentes).toEqual(expect.arrayContaining(["voz", "voz_segmento", "texto"]));
    expect(traceA.candidatos.slice(1).every((k) => k.estado === "descartado_auto")).toBe(true);
    expect(traceA.consultas.map((q) => q.indice)).toEqual([...Array(2).fill("voz"), ...Array(7).fill("voz_segmento"), "texto", ...Array(3).fill("imagen")]);
    expect(queriesOf(traceA, "texto")[0]!.vecinos.every((n) => n.score >= 0.93 && n.score <= 0.97)).toBe(true);
    expect(queriesOf(traceA, "voz_segmento").some((q) => q.vecinos.some((n) => !n.pasa && n.case_id === caseOf("B").case_id))).toBe(true);
    expect(queriesOf(traceA, "imagen").every((q) => q.vecinos.length === 0)).toBe(true);
  });

  it("solo la administración ve el motor vectorial (menú, ruta y API simulada)", async () => {
    expect(can("admin", "vectors.view")).toBe(true);
    for (const role of ["reviewer", "analyst"] as const) {
      expect(can(role, "vectors.view")).toBe(false);
      expect(NAV.filter((n) => can(role, n.cap)).map((n) => n.to)).not.toContain("/vectores");
      await expect(new MockVectorsApi({ id: "u", role }, { latency: 0 }).overview()).rejects.toMatchObject({ status: 403 });
    }
    expect(NAV.filter((n) => can("admin", n.cap)).map((n) => n.to)).toContain("/vectores");
    const admin = new MockVectorsApi({ id: "u", role: "admin" }, { latency: 0 });
    const sync = await admin.sync();
    expect(sync.sincronizados).toEqual({ voz: 4, voz_segmento: 13, texto: 7, imagen: 3 });
    expect(syncText(sync)).toBe(
      "Listo: 27 vectores copiados a Chroma Cloud (huellas de voz 4, segmentos de voz 13, fichas 7, recortes de imagen 3), 0 borrados, en 1.2 s.",
    );
    expect((await admin.overview()).almacen.sincronizado_en).not.toBe("2026-10-29T14:02:00Z");
  });

  it("con la API real pide el panorama, la consulta de un caso y la sincronización", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const path = new URL(url).pathname;
      const body = path.endsWith("/consulta") ? traceA : path.endsWith("/sincronizar") ? { proveedor: "chroma-cloud", sincronizados: { voz: 4 }, borrados: 0, ms: 900 } : ov;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new HttpClient({ baseUrl: BASE, store: new MemoryTokenStore({ accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 600_000 }), fetch: fetchImpl });
    const api = new HttpVectorsApi(client);
    expect((await api.overview()).almacen.base).toBe("blindaje");
    expect((await api.trace(A.case_id)).caso).toBe("A");
    expect((await api.sync()).sincronizados.voz).toBe(4);
    expect(calls).toEqual([
      { url: `${BASE}/v1/console/vectores`, method: "GET", body: undefined },
      { url: `${BASE}/v1/console/vectores/consulta`, method: "POST", body: { case_id: A.case_id } },
      { url: `${BASE}/v1/console/vectores/sincronizar`, method: "POST", body: undefined },
    ]);
  });
});

describe("piezas del recorrido", () => {
  it("arma un paso de búsqueda por cada colección con vectores del caso", () => {
    expect(stepsA.map((s) => s.titulo)).toEqual([
      "Evidencia",
      "Modelos",
      "Vectores",
      "Guardar",
      "Buscar voces",
      "Buscar segmentos",
      "Buscar fichas",
      "Buscar imágenes",
      "Señales",
      "Revisión humana",
    ]);
    expect(buildSteps(caseOf("D")).map((s) => s.kind)).toEqual(["evidencia", "modelos", "vectores", "base", "busqueda", "senales", "revision"]);
  });

  it("describe cada paso en palabras, con los tiempos reales de la base", () => {
    const d = (i: number, t: S.VectorTrace | null, loading = false) => stepDescription(stepsA[i]!, A, ov, t, loading);
    expect(d(at("evidencia"), null)).toBe("El caso A trae 5 evidencias: 2 audios, 2 textos y 1 imagen. Todo es ficticio.");
    expect(d(at("base"), null)).toContain("Chroma Cloud, base blindaje: 2 en blindaje-voz, 7 en blindaje-voz-segmento, 1 en blindaje-texto y 3 en blindaje-imagen");
    expect(d(at("busqueda", "voz"), null, true)).toMatch(/^Consultando Chroma Cloud/);
    const voz = d(at("busqueda", "voz"), traceA);
    expect(voz).toMatch(/^En blindaje-voz, Chroma respondió 2 consultas en (entre \d+ y )?\d+ ms\./);
    expect(voz).toContain("Los 2 vectores del mismo caso no cuentan.");
    expect(searchSummary("imagen", queriesOf(traceA, "imagen"), "chroma-cloud")).toContain("No hay vectores de otros casos en esta colección.");
    expect(d(at("revision"), traceA)).toContain("Ningún vínculo se crea solo");
  });

  it("la tira usa dos tonos y un centro neutro", () => {
    expect(divergingColor(-1)).toBe(DIVERGING.neg);
    expect(divergingColor(1)).toBe(DIVERGING.pos);
    expect(divergingColor(0)).toBe(DIVERGING.mid);
    expect(divergingColor(Number.NaN)).toBe(DIVERGING.mid);
  });

  it("las etiquetas de los vecinos no se pisan", () => {
    const placed = placeLabels([
      { id: 1, text: "B · 0.93", cx: 150, cy: 80 },
      { id: 2, text: "C · 0.91", cx: 152, cy: 82 },
      { id: 3, text: "D · 0.40", cx: 296, cy: 100 },
    ]);
    const box = (l: (typeof placed)[number]) => {
      const w = l.text.length * 6.2;
      return l.anchor === "start" ? [l.x, l.y - 10, l.x + w, l.y + 2] : [l.x - w, l.y - 10, l.x, l.y + 2];
    };
    const [a, b] = [box(placed[0]!), box(placed[1]!)];
    expect(a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!).toBe(false);
    expect(placed[2]!.anchor).toBe("end");
    // Nunca encima del punto del caso que consulta.
    const q = placeLabels([{ id: 9, text: "C · 0.97", cx: 100, cy: 100 }], 3, [{ cx: 120, cy: 104 }])[0]!;
    expect(q.anchor === "start" && q.y > 92 && q.y < 112 && q.x < 126).toBe(false);
  });

  it("la fórmula del puntaje usa las señales del candidato", () => {
    expect(combineFormula({ case_id: "x", caso: "B", fuentes: ["voz"], senales: { identificador: 0.95, voz: 0.85 }, puntaje: 0.9925, estado: "probable" })).toBe(
      "1 − (1 − 0.95) × (1 − 0.85) = 0.99",
    );
    const agg = aggregateNeighbors(queriesOf(traceA, "voz_segmento"));
    expect(new Set(agg.map((n) => n.id)).size).toBe(agg.length);
  });
});

describe("escenario del recorrido", () => {
  it("antes de empezar muestra el camino, sin evidencia ni vectores del caso", () => {
    const html = stage(-1, null);
    expect(html).toContain('data-phase="later"');
    expect(html).not.toContain("vx-pt-mine");
    // Los 14 vectores de otros casos; los 13 del caso A todavía no llegan.
    expect(html.match(/class="vx-pt-other"/g)).toHaveLength(14);
    expect(text(html)).toContain("ECAPA-TDNN");
    expect(text(html)).toContain("Muse Spark 1.3 escribe la ficha");
    expect(text(html)).toContain("SAM 3.1 · Meta recorta la imagen");
  });

  it("en el paso de la base, los vectores del caso caen en sus colecciones", () => {
    const html = stage(at("base"), null);
    expect(html.match(/class="vx-pt-mine"/g)).toHaveLength(13);
    expect(html).toContain('class="vx-mine vx-in"');
    expect(text(html)).toContain("32 de los 192 números de cada vector");
  });

  it("mientras la base responde, avisa que está consultando", () => {
    const html = stage(at("busqueda", "voz"), null, true);
    expect(text(html)).toContain("Consultando Chroma Cloud…");
    expect(html).toContain("vx-ring vx-ring-wait");
  });

  it("con la respuesta dibuja los vecinos, el tiempo de la consulta y los que no pasan el umbral", () => {
    const html = stage(at("busqueda", "voz_segmento"), traceA);
    const segs = aggregateNeighbors(queriesOf(traceA, "voz_segmento"));
    expect(html.match(/class="vx-line[^"]*"/g)!.length).toBeGreaterThanOrEqual(segs.length);
    expect(text(html)).toMatch(/7 consultas · entre \d+ y \d+ ms/);
    expect(text(html)).toMatch(/B · 0\.\d\d/);
    // Las colecciones de pasos posteriores todavía no muestran líneas.
    const img = stage(at("busqueda", "voz"), traceA);
    expect(img).not.toContain("vx-nb-no vx-in");
    expect(text(html)).toContain("Ver las");
  });

  it("al final muestra señales, puntaje y destino, y que ningún vínculo se crea solo", () => {
    const html = text(stage(at("revision"), traceA));
    expect(html).toContain("Caso B");
    expect(html).toContain("Probable");
    expect(html).toContain("Va a la cola de revisión, arriba");
    expect(html).toContain("Se guarda para recalibrar; no se muestra");
    expect(html).toContain("1 − (1 − 0.85) × (1 − 0.40) = 0.91");
    expect(html).toContain("Ningún vínculo se crea solo.");
    // En el paso de señales el puntaje todavía no aparece.
    expect(text(stage(at("senales"), traceA))).toContain("El puntaje sale en el paso siguiente");
  });
});

describe("estado y colecciones", () => {
  it("dice qué base es, si responde y qué datos guarda", () => {
    const html = text(renderToStaticMarkup(<StoreStrip store={ov.almacen} />));
    expect(html).toContain("Chroma Cloud · base blindaje");
    expect(html).toContain("Conectada · respondió en 132 ms · índice SPANN · coseno");
    expect(html).toContain("Solo casos ficticios del demo");
    const off = text(renderToStaticMarkup(<StoreStrip store={{ ...ov.almacen, conectado: false, latencia_ms: null }} />));
    expect(off).toContain("No responde");
  });

  it("marca las colecciones que no están al día con D1", () => {
    const stale: S.VectorOverview = { ...ov, colecciones: ov.colecciones.map((k) => (k.indice === "texto" ? { ...k, en_base: 6 } : k)) };
    const html = text(renderToStaticMarkup(<CollectionsTable overview={stale} />));
    expect(html).toContain("6 · faltan 1, sincroniza");
    expect(html).toContain("DINOv2 · Meta");
    expect(html).toContain("HMAC-SHA256");
  });
});
