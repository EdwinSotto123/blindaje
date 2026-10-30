import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { evidenceLabel, VECTOR_SAMPLE_BINS, VectorOverview, VectorSyncResult, VectorTrace } from "@blindaje/shared";
import { deindexCase, encodeVector, findCandidates } from "../src/linking";
import { newId, nowIso } from "../src/lib/ids";
import { setChromaForTests } from "../src/vectors/chroma";
import { projectPca, vectorSample } from "../src/vectors/projection";
import { FAKE_CHROMA_CONFIG, FakeChroma } from "./fake-chroma";
import { fakeAudio, insertEvidence, normalize, randomUnit } from "./fakes";
import { apiJson, createCase, loginAs, registerDevice, seedOrg } from "./helpers";

/**
 * Motor vectorial con Chroma Cloud (falso, en memoria): sincronización desde D1, búsqueda de
 * candidatos sin contenedor ML, desindexado y la vista de la consola (solo administración).
 */

const MODEL_VOZ = "speechbrain/spkrec-ecapa-voxceleb";
const MODEL_TEXTO = "intfloat/multilingual-e5-small";

let chroma: FakeChroma;
let org: Awaited<ReturnType<typeof seedOrg>>;
let admin: Awaited<ReturnType<typeof loginAs>>;
let nextFaiss = 9001;
let nextPrint = 501;

interface Seeded {
  id: string;
  code: string;
  faiss: number[];
}
const cases: Record<string, Seeded> = {};

/** Voz parecida a `base` (coseno alto) o distinta, según el ruido. */
function near(base: number[], noise: string, scale: number): number[] {
  const n = randomUnit(noise, base.length);
  return normalize(base.map((x, i) => x + scale * n[i]!));
}

async function insertEmbedding(caseId: string, index: string, refType: string, refId: string, vector: number[], model: string): Promise<number> {
  const faissId = nextFaiss++;
  await env.DB.prepare(
    `INSERT INTO embeddings (faiss_id, index_name, case_id, ref_type, ref_id, dim, vector_b64, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(faissId, index, caseId, refType, refId, vector.length, encodeVector(vector), model, nowIso())
    .run();
  return faissId;
}

/** Un caso indexado con una huella de voz (centroide y dos segmentos) y, si se pide, el vector de su ficha. */
async function seedCase(key: string, opts: { demo: boolean; voice: number[]; text?: number[]; indexed?: boolean }): Promise<Seeded> {
  const device = await registerDevice(org.invite);
  const c = await createCase(device.access_token, "comunitario");
  await env.DB.prepare("UPDATE cases SET indexed = ?, is_demo = ?, estado = 'listo' WHERE id = ?")
    .bind(opts.indexed === false ? 0 : 1, opts.demo ? 1 : 0, c.id)
    .run();
  const ev = await insertEvidence(c, 1, "audio", fakeAudio(key, { A: key }));
  const printId = newId();
  const faiss: number[] = [];
  const centroid = await insertEmbedding(c.id, "voz", "voice_print", printId, opts.voice, MODEL_VOZ);
  faiss.push(centroid);
  const segments = [];
  for (let i = 0; i < 2; i++) {
    const v = near(opts.voice, `${key}-seg-${i}`, 0.05);
    const id = await insertEmbedding(c.id, "voz_segmento", "voice_segment", `${printId}:${i}`, v, MODEL_VOZ);
    faiss.push(id);
    segments.push({ start_ms: i * 4000, end_ms: i * 4000 + 3500, faiss_id: id });
  }
  await env.DB.prepare(
    `INSERT INTO voice_prints (id, num, case_id, evidence_id, speaker, faiss_id, segmentos, duracion_seg, segments_json, model, created_at)
     VALUES (?, ?, ?, ?, 'A', ?, 2, 7.5, ?, ?, ?)`,
  )
    .bind(printId, nextPrint++, c.id, ev.id, centroid, JSON.stringify(segments), MODEL_VOZ, nowIso())
    .run();
  if (opts.text) faiss.push(await insertEmbedding(c.id, "texto", "ficha", c.id, opts.text, MODEL_TEXTO));
  cases[key] = { id: c.id, code: c.code, faiss };
  return cases[key]!;
}

beforeAll(async () => {
  chroma = new FakeChroma();
  setChromaForTests({ cfg: FAKE_CHROMA_CONFIG, fetch: chroma.fetch });
  org = await seedOrg({ maxUses: 50 });
  admin = await loginAs("admin", org.orgId);
  const extorsionador = randomUnit("voz:extorsionador", 192);
  const texto = randomUnit("texto:cobro-yape", 384);
  await seedCase("A", { demo: true, voice: near(extorsionador, "A", 0.08), text: near(texto, "tA", 0.1) });
  await seedCase("B", { demo: true, voice: near(extorsionador, "B", 0.08), text: near(texto, "tB", 0.1) });
  await seedCase("C", { demo: true, voice: randomUnit("voz:otra-persona", 192) });
  // Un caso real (no demo): con CHROMA_SOLO_DEMO nunca llega a Chroma Cloud.
  await seedCase("R", { demo: false, voice: near(extorsionador, "R", 0.08) });
  // Un caso ficticio sin consentimiento comunitario: no está en los índices.
  await seedCase("N", { demo: true, voice: near(extorsionador, "N", 0.08), indexed: false });
});

afterAll(() => {
  setChromaForTests(null);
});

describe("proyección del mapa", () => {
  it("PCA separa dos grupos en el primer eje y normaliza a [-1, 1]", () => {
    const a = randomUnit("grupo-a", 64);
    const b = randomUnit("grupo-b", 64);
    const vecs = [...[1, 2, 3].map((i) => near(a, `a${i}`, 0.05)), ...[1, 2, 3].map((i) => near(b, `b${i}`, 0.05))];
    const { coords, variance } = projectPca(vecs);
    const xs = coords.map(([x]) => x);
    expect(Math.sign(xs[0]!)).toBe(Math.sign(xs[1]!));
    expect(Math.sign(xs[0]!)).not.toBe(Math.sign(xs[4]!));
    for (const [x, y] of coords) {
      expect(Math.abs(x)).toBeLessThanOrEqual(1);
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
    }
    expect(variance[0]).toBeGreaterThan(0.8);
    expect(variance[0] + variance[1]).toBeLessThanOrEqual(1.0001);
  });

  it("casos borde: sin vectores, uno solo y la muestra de números", () => {
    expect(projectPca([])).toEqual({ coords: [], variance: [0, 0] });
    expect(projectPca([randomUnit("solo", 8)]).coords).toEqual([[0, 0]]);
    const s = vectorSample(randomUnit("muestra", 384));
    expect(s).toHaveLength(VECTOR_SAMPLE_BINS);
    expect(Math.max(...s.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});

describe("Chroma Cloud como base vectorial", () => {
  it("la sincronización sube solo casos ficticios indexados y borra lo que sobra", async () => {
    // Un vector viejo que ya no está en D1.
    await chroma.fetch(`${FAKE_CHROMA_CONFIG.url}/api/v2/tenants/${FAKE_CHROMA_CONFIG.tenant}/databases/blindaje/collections`, {
      method: "POST",
      headers: { "x-chroma-token": FAKE_CHROMA_CONFIG.apiKey },
      body: JSON.stringify({ name: "blindaje-voz", get_or_create: true, configuration: { spann: { space: "cosine" } } }),
    });
    const col = chroma.byName("blindaje-voz")!;
    col.records.set("424242", { embedding: randomUnit("viejo", 192), metadata: {} });

    const res = await apiJson<VectorSyncResult>("/v1/console/vectores/sincronizar", { method: "POST", token: admin.token });
    expect(res.status).toBe(200);
    const body = VectorSyncResult.parse(res.body);
    expect(body.proveedor).toBe("chroma-cloud");
    expect(body.sincronizados).toMatchObject({ voz: 3, voz_segmento: 6, texto: 2, imagen: 0 });
    expect(body.borrados).toBe(1);

    const voz = chroma.ids("blindaje-voz").map(Number);
    expect(voz).toEqual([cases.A!.faiss[0], cases.B!.faiss[0], cases.C!.faiss[0]]);
    expect(voz).not.toContain(cases.R!.faiss[0]);
    expect(voz).not.toContain(cases.N!.faiss[0]);
    expect(col.space).toBe("cosine");
    // Sin texto ni datos del caso en los metadatos: solo tipo y modelo.
    expect(Object.keys(col.records.get(String(cases.A!.faiss[0]))!.metadata).sort()).toEqual(["modelo", "tipo"]);
  });

  it("findCandidates encuentra la misma voz en Chroma sin contenedor ML", async () => {
    const queries: string[] = [];
    let provider = "";
    const before = chroma.calls.filter((c) => c.endsWith("/query")).length;
    const pairs = await findCandidates(env, cases.A!.id, undefined, { provider: (p) => (provider = p), query: (q) => queries.push(q.index) });
    expect(provider).toBe("chroma-cloud");
    expect(queries).toEqual(["voz", "voz_segmento", "voz_segmento", "texto"]);
    // Una sola ida y vuelta por colección: los dos segmentos viajan en el mismo lote.
    expect(chroma.calls.filter((c) => c.endsWith("/query")).length - before).toBe(3);
    const b = pairs.find((p) => p.other_case_id === cases.B!.id);
    expect(b?.signals.voz?.similitud).toBeGreaterThan(0.9);
    expect(b?.signals.voz?.segmentos).toBe(2);
    // C tiene otra voz y el caso real no está en Chroma: ninguno sale como candidato por voz.
    expect(pairs.some((p) => p.other_case_id === cases.R!.id)).toBe(false);
    expect(pairs.find((p) => p.other_case_id === cases.C!.id)?.signals.voz?.similitud ?? 0).toBeLessThan(0.5);
  });

  it("un caso real no usa Chroma Cloud (CHROMA_SOLO_DEMO)", async () => {
    let provider = "";
    await findCandidates(env, cases.R!.id, undefined, { provider: (p) => (provider = p) });
    expect(provider).toBe("ninguno");
  });

  it("si Chroma falla, la búsqueda no lanza y sigue con D1", async () => {
    chroma.failQueries = true;
    try {
      await expect(findCandidates(env, cases.A!.id)).resolves.toEqual([]);
    } finally {
      chroma.failQueries = false;
    }
  });
});

describe("consola: motor vectorial", () => {
  it("GET /vectores muestra la base, las colecciones, los casos y el mapa", async () => {
    const res = await apiJson<VectorOverview>("/v1/console/vectores", { token: admin.token });
    expect(res.status).toBe(200);
    const o = VectorOverview.parse(res.body);
    expect(o.almacen).toMatchObject({ proveedor: "chroma-cloud", base: "blindaje", conectado: true, solo_demo: true });
    expect(o.almacen.sincronizado_en).not.toBeNull();
    const voz = o.colecciones.find((c) => c.indice === "voz")!;
    expect(voz).toMatchObject({ coleccion: "blindaje-voz", dim: 192, modelo: MODEL_VOZ, en_d1: 3, en_base: 3 });
    expect(o.casos.map((c) => c.caso)).toEqual(expect.arrayContaining([cases.A!.code, cases.B!.code]));
    expect(o.casos.find((c) => c.caso === cases.A!.code)).toMatchObject({ distrito: "San Juan de Lurigancho", vectores: { voz: 1, voz_segmento: 2, texto: 1 } });
    const mapa = o.mapas.find((m) => m.indice === "voz_segmento")!;
    const p = mapa.puntos.find((x) => x.case_id === cases.A!.id)!;
    expect(p.ref).toMatch(/^V-\d+ · 0:00–0:04$/);
    expect(p.evidencia).toBe(evidenceLabel(cases.A!.code, 1));
    expect(p.muestra).toHaveLength(VECTOR_SAMPLE_BINS);
    // El mapa de la consola es del equipo central: también muestra el caso real, nunca el no indexado.
    expect(o.mapas.find((m) => m.indice === "voz")!.puntos.map((x) => x.case_id)).not.toContain(cases.N!.id);
  });

  it("la consulta en vivo devuelve cada búsqueda con sus vecinos y los candidatos, sin crear vínculos", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>();
    const res = await apiJson<VectorTrace>("/v1/console/vectores/consulta", { token: admin.token, json: { case_id: cases.A!.id } });
    expect(res.status).toBe(200);
    const t = VectorTrace.parse(res.body);
    expect(t).toMatchObject({ caso: cases.A!.code, proveedor: "chroma-cloud", umbrales: { probable: 0.9, revisar: 0.6 } });
    const voz = t.consultas.find((q) => q.indice === "voz")!;
    expect(voz).toMatchObject({ consulta: cases.A!.faiss[0], ref: expect.stringMatching(/^V-\d+$/), k: 10, umbral: null, excluidos: 1 });
    expect(voz.vecinos[0]).toMatchObject({ caso: cases.B!.code, pasa: true });
    expect(voz.vecinos[0]!.score).toBeGreaterThan(0.9);
    expect(voz.vecinos.some((v) => v.case_id === cases.A!.id)).toBe(false);
    const seg = t.consultas.find((q) => q.indice === "voz_segmento")!;
    expect(seg.umbral).toBeGreaterThan(0);
    expect(seg.vecinos.find((v) => v.caso === cases.C!.code)?.pasa ?? false).toBe(false);
    const b = t.candidatos.find((c) => c.caso === cases.B!.code)!;
    expect(b.fuentes).toEqual(expect.arrayContaining(["voz", "voz_segmento", "texto"]));
    expect(b.senales.voz).toBeGreaterThan(0.5);
    expect(["probable", "por_revisar"]).toContain(b.estado);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
    const audit = await env.DB.prepare("SELECT actor_id, target_id, details_json FROM audit_log WHERE action = 'vectors.query' ORDER BY seq DESC LIMIT 1").first<{
      actor_id: string;
      target_id: string;
      details_json: string;
    }>();
    expect(audit).toMatchObject({ actor_id: admin.id, target_id: cases.A!.id });
  });

  it("solo administración; un caso sin indexar o inexistente no se consulta", async () => {
    for (const role of ["reviewer", "analyst"] as const) {
      const u = await loginAs(role, org.orgId);
      expect((await apiJson("/v1/console/vectores", { token: u.token })).status).toBe(403);
      expect((await apiJson("/v1/console/vectores/consulta", { token: u.token, json: { case_id: cases.A!.id } })).status).toBe(403);
    }
    expect((await apiJson("/v1/console/vectores/consulta", { token: admin.token, json: { case_id: cases.N!.id } })).status).toBe(409);
    expect((await apiJson("/v1/console/vectores/consulta", { token: admin.token, json: { case_id: "no-existe" } })).status).toBe(404);
  });

  it("sin base vectorial, el estado lo dice y sincronizar responde 409", async () => {
    setChromaForTests({ cfg: null });
    try {
      const o = VectorOverview.parse((await apiJson<VectorOverview>("/v1/console/vectores", { token: admin.token })).body);
      expect(o.almacen).toMatchObject({ proveedor: "ninguno", conectado: false });
      expect(o.colecciones.every((c) => c.en_base === null && c.coleccion === null)).toBe(true);
      expect((await apiJson("/v1/console/vectores/sincronizar", { method: "POST", token: admin.token })).status).toBe(409);
    } finally {
      setChromaForTests({ cfg: FAKE_CHROMA_CONFIG, fetch: chroma.fetch });
    }
  });

  it("desindexar un caso borra sus vectores de Chroma", async () => {
    await deindexCase(env, cases.B!.id, { recompute: false });
    for (const name of ["blindaje-voz", "blindaje-voz-segmento", "blindaje-texto"]) {
      for (const id of cases.B!.faiss) expect(chroma.ids(name)).not.toContain(String(id));
    }
    const pairs = await findCandidates(env, cases.A!.id);
    expect(pairs.some((p) => p.other_case_id === cases.B!.id)).toBe(false);
  });
});
