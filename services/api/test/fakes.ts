import { env } from "cloudflare:workers";
import type { FetchLike } from "@blindaje/meta-client";
import { evidenceLabel, type FichaExtraction } from "@blindaje/shared";
import { evidenceR2Key } from "../src/evidence";
import { putEncrypted } from "../src/lib/crypto";
import { b64ToBytes, bytesToB64, utf8 } from "../src/lib/encoding";
import { newId, nowIso } from "../src/lib/ids";
import { makeWav } from "../src/lib/wav";
import type { Box, MlClient, MlIndexName, VoiceEmbedRequest, VoiceEmbedResponse } from "../src/ml/client";

/**
 * Dobles de prueba del contenedor ML y de la Meta API. Todo es determinista y ficticio.
 *
 * Marcadores dentro de los archivos de prueba:
 *  - audio:  `AUDIO|guion=A1|hablantes=A:persona1,B:persona3|`  (quién habla en cada turno)
 *  - imagen: JPEG mágico + `img=foto1|`
 *  - muestra de voz de la víctima: `VOZ|persona3|`
 */

// ---------------------------------------------------------------------------
// Vectores deterministas
// ---------------------------------------------------------------------------

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function randomUnit(name: string, dim: number): number[] {
  const r = rng(seedOf(name));
  return normalize(Array.from({ length: dim }, () => r() * 2 - 1));
}

function mix(base: number[], noiseName: string, scale: number): number[] {
  const noise = randomUnit(noiseName, base.length);
  return normalize(base.map((x, i) => x + scale * noise[i]!));
}

export const voiceOf = (persona: string) => randomUnit(`voz:${persona}`, 192);

/** Embedding de texto tipo bolsa de palabras (sin tildes): textos parecidos dan coseno alto. */
export function bowVector(text: string): number[] {
  const v = new Array<number>(384).fill(0);
  const toks = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 2);
  for (const t of toks) {
    const i = seedOf(t) % 384;
    v[i] = (v[i] ?? 0) + 1;
  }
  return normalize(v);
}

function phashOf(name: string): string {
  const r = rng(seedOf(`phash:${name}`));
  return Array.from({ length: 16 }, () => Math.floor(r() * 16).toString(16)).join("");
}

function latin1(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return s;
}

export const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];

export function fakeImage(id: string): Uint8Array {
  return new Uint8Array([...JPEG_MAGIC, ...utf8(`img=${id}|`)]);
}

export function fakeAudio(guion: string, hablantes: Record<string, string>): Uint8Array {
  return utf8(`AUDIO|guion=${guion}|hablantes=${Object.entries(hablantes).map(([k, v]) => `${k}:${v}`).join(",")}|`);
}

function audioMarker(bytes: Uint8Array | ArrayBuffer) {
  const s = latin1(bytes);
  const guion = /guion=([A-Za-z0-9_-]+)\|/.exec(s)?.[1] ?? "desconocido";
  const hablantes: Record<string, string> = {};
  for (const pair of (/hablantes=([^|]*)\|/.exec(s)?.[1] ?? "").split(",")) {
    const [k, v] = pair.split(":");
    if (k && v) hablantes[k] = v;
  }
  return { guion, hablantes };
}

// ---------------------------------------------------------------------------
// ML falso
// ---------------------------------------------------------------------------

export const AUDIO_MS = 12_000;

export class FakeMl implements MlClient {
  readonly kind = "http" as const;
  readonly indices = new Map<MlIndexName, Map<number, number[]>>();
  readonly calls: string[] = [];
  cohortSize = 0;
  pdfData: unknown = null;

  private idx(name: MlIndexName) {
    let m = this.indices.get(name);
    if (!m) this.indices.set(name, (m = new Map()));
    return m;
  }

  async raw(): Promise<Response> {
    throw new Error("raw no simulado");
  }
  async health() {
    this.calls.push("health");
    const indices = Object.fromEntries((["voz", "voz_segmento", "texto", "imagen"] as const).map((n) => [n, this.idx(n).size]));
    return { ok: true, models: { voice: true, text: true, image: true }, indices, index_version: null, cohort: { size: this.cohortSize } };
  }
  async normalizeAudio(body: ArrayBuffer | Uint8Array | ReadableStream) {
    this.calls.push("normalize");
    const marker = new Uint8Array(body as ArrayBuffer);
    const wav = makeWav(AUDIO_MS);
    new Uint8Array(wav, 44).set(marker.slice(0, Math.min(marker.length, wav.byteLength - 44)));
    return { wav, duration_ms: AUDIO_MS };
  }
  async voiceEnroll(body: ArrayBuffer | Uint8Array | ReadableStream) {
    this.calls.push("enroll");
    const persona = /VOZ\|([^|]+)\|/.exec(latin1(body as ArrayBuffer))?.[1] ?? "desconocida";
    return { model: "ecapa-falso", dim: 192, vector: voiceOf(persona) };
  }
  async voiceEmbed(req: VoiceEmbedRequest): Promise<VoiceEmbedResponse> {
    this.calls.push("embed");
    const { guion, hablantes } = audioMarker(b64ToBytes(req.wav_b64));
    const turns = req.turns ?? [{ speaker: "A", start_ms: 0, end_ms: AUDIO_MS }];
    const speakers = [...new Set(turns.map((t) => t.speaker))];
    const threshold = req.exclude_threshold ?? 0.6;
    return {
      model: "ecapa-falso",
      dim: 192,
      speakers: speakers.flatMap((spk) => {
        const persona = hablantes[spk] ?? "desconocida";
        const base = mix(voiceOf(persona), `canal:${guion}`, 0.3);
        const segments: Array<{ start_ms: number; end_ms: number; vector: number[]; excluded: boolean; victim_similarity: number | null }> = [];
        for (const t of turns.filter((x) => x.speaker === spk)) {
          for (let s = t.start_ms; s + 3000 <= t.end_ms; s += 3000) {
            segments.push({ start_ms: s, end_ms: s + 3000, vector: mix(base, `seg:${guion}:${spk}:${s}`, 0.15), excluded: false, victim_similarity: null });
          }
        }
        if (!segments.length) return [];
        const centroid = normalize(base.map((_, i) => segments.reduce((sum, g) => sum + g.vector[i]!, 0)));
        const sim = req.exclude_vectors.length ? Math.max(...req.exclude_vectors.map((v) => v.reduce((a, x, i) => a + x * centroid[i]!, 0))) : null;
        const excluded = sim !== null && sim > threshold;
        return [{ speaker: spk, centroid, segments, n_segments: segments.length, duration_sec: segments.length * 3, victim_similarity: sim, excluded }];
      }),
    };
  }
  async voiceCompare(a: number[], b: number[]) {
    const cos = a.reduce((s, x, i) => s + x * b[i]!, 0);
    return { cosine: cos, snorm: this.cohortSize ? cos * 10 : null };
  }
  async textEmbed(texts: string[]) {
    this.calls.push("text");
    return { model: "e5-falso", dim: 384, vectors: texts.map(bowVector) };
  }
  async imageCrops(req: { image_b64: string; boxes: Array<Box & { concept: string }> }) {
    this.calls.push("crops");
    const img = /img=([A-Za-z0-9_-]+)\|/.exec(latin1(b64ToBytes(req.image_b64)))?.[1] ?? "x";
    return {
      model: "dinov2-falso",
      dim: 384,
      full: { phash: phashOf(img), vector: randomUnit(`img:${img}`, 384) },
      crops: req.boxes.map((b) => ({
        concept: b.concept,
        box: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
        phash: phashOf(`${img}:${b.concept}`),
        vector: randomUnit(`crop:${b.concept}:${img}`, 384),
        crop_jpeg_b64: bytesToB64(new Uint8Array([...JPEG_MAGIC, ...utf8(`crop|${b.concept}|img=${img}|`)])),
      })),
    };
  }
  async imageRedact(req: { image_b64: string; regions: Box[] }) {
    this.calls.push(`redact:${req.regions.length}`);
    const src = b64ToBytes(req.image_b64);
    const extra = req.regions.length ? utf8("|tapada") : new Uint8Array();
    const out = new Uint8Array(src.length + extra.length);
    out.set(src);
    out.set(extra, src.length);
    return out.buffer;
  }
  async videoSample(body: ArrayBuffer | Uint8Array | ReadableStream) {
    return { mp4: new Uint8Array(body as ArrayBuffer).slice().buffer, frames: 20, fps: 5, width: 640, height: 360 };
  }
  async videoFrame() {
    return fakeImage("cuadro").slice().buffer;
  }
  async indexAdd(index: MlIndexName, ids: number[], vectors: number[][]) {
    ids.forEach((id, i) => this.idx(index).set(id, vectors[i]!));
    return { ok: true, size: this.idx(index).size };
  }
  async indexSearch(index: MlIndexName, vector: number[], k: number, excludeIds: number[] = []) {
    const ex = new Set(excludeIds);
    const results = [...this.idx(index).entries()]
      .filter(([id]) => !ex.has(id))
      .map(([id, v]) => ({ id, score: v.reduce((s, x, i) => s + x * vector[i]!, 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return { results };
  }
  async indexRemove(index: MlIndexName, ids: number[]) {
    for (const id of ids) this.idx(index).delete(id);
    return { ok: true, size: this.idx(index).size };
  }
  async indexRebuild(index: MlIndexName, ids: number[], vectors: number[][]) {
    this.calls.push(`rebuild:${index}`);
    this.indices.set(index, new Map(ids.map((id, i) => [id, vectors[i]!])));
    return { ok: true, size: ids.length };
  }
  async indexSnapshot() {
    return utf8("zip-falso").buffer;
  }
  async indexLoad() {
    return { ok: true, sizes: {} };
  }
  async graphAnalyze(): Promise<never> {
    throw new Error("graph no simulado");
  }
  async pdfRender(_template: "denuncia" | "expediente", data: unknown) {
    this.pdfData = data;
    return utf8("%PDF-1.7 ficticio").buffer;
  }
}

// ---------------------------------------------------------------------------
// Meta API falsa (fetch de @blindaje/meta-client)
// ---------------------------------------------------------------------------

export interface FakeTurn {
  speaker: string | null;
  startMs: number;
  endMs: number;
  transcript: string;
}

export type VinculadorMode = "echo" | "invalido" | number;

export interface FakeMetaConfig {
  guiones: Record<string, FakeTurn[]>;
  /** Ficha por código de caso (lo que "devuelve" Muse Spark). */
  fichas: Record<string, FichaExtraction>;
  /** Cajas por imagen y concepto (en inglés: lo que entiende SAM 3.1). */
  sam: Record<string, Record<string, Array<Box & { c: number }>>>;
  lecturas: Record<string, { notas: string[]; placas: string[] }>;
  vinculador: VinculadorMode;
}

export interface FakeMetaLog {
  transcribe: Array<{ keywords: string[]; guion: string }>;
  sam: string[];
  ficha: string[];
  vinculador: string[];
  lectura: number;
}

function responseJson(model: string, output: unknown) {
  return Response.json(
    {
      id: `resp_${newId().slice(0, 8)}`,
      object: "response",
      model,
      status: "completed",
      output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 2000, output_tokens: 300, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 } },
    },
    { headers: { "x-request-id": "req-falso" } },
  );
}

function samSse(text: string): Response {
  const resp = (status: string, extra: Record<string, unknown> = {}) => ({ id: "resp_sam", object: "response", model: "sam-3.1", status, output: [], ...extra });
  const events: Array<[string, Record<string, unknown>]> = [
    ["response.created", { response: resp("in_progress") }],
    ["response.output_text.delta", { output_index: 0, content_index: 0, delta: text }],
    ["response.output_text.done", { output_index: 0, content_index: 0, text }],
    [
      "response.completed",
      {
        response: resp("completed", {
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
          usage: { images_processed: 1, input_tokens: 0, output_tokens: 0 },
        }),
      },
    ],
  ];
  const body = events.map(([type, data], i) => `event: ${type}\ndata: ${JSON.stringify({ ...data, type, sequence_number: i })}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream", "x-request-id": "req-sam" } });
}

export function samLine(boxes: Array<Box & { c: number }>, w = 1600, h = 1066): string {
  if (!boxes.length) return "";
  return `<0f>${boxes.map((b, i) => `${i}<|box;x1=${b.x1};y1=${b.y1};x2=${b.x2};y2=${b.y2};w=${w};h=${h};c=${b.c}|><|mask;x=0;y=0;c=${b.c};data=4,4,!abcd|>`).join(",")}\n`;
}

function textOfInput(input: unknown): string {
  if (typeof input === "string") return input;
  const parts: string[] = [];
  for (const item of (input as Array<{ content?: unknown }>) ?? []) {
    if (typeof item.content === "string") parts.push(item.content);
    else for (const p of (item.content as Array<{ type: string; text?: string }>) ?? []) if (p.type === "input_text" && p.text) parts.push(p.text);
  }
  return parts.join("\n");
}

function imagesOfInput(input: unknown): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const item of (input as Array<{ content?: unknown }>) ?? []) {
    if (!Array.isArray(item.content)) continue;
    for (const p of item.content as Array<{ type: string; image_url?: string }>) {
      if (p.type === "input_image" && p.image_url?.startsWith("data:")) out.push(b64ToBytes(p.image_url.split(",")[1]!));
    }
  }
  return out;
}

export function fakeMetaFetch(cfg: FakeMetaConfig, log: FakeMetaLog): FetchLike {
  return async (url, init) => {
    if (url.endsWith("/asr/transcribe")) {
      const raw = latin1(init.body as ArrayBuffer);
      const guion = /guion=([A-Za-z0-9_-]+)\|/.exec(raw)?.[1] ?? "desconocido";
      const req = JSON.parse(/\{"model":"muse-voice-transcribe[^\r\n]*\}/.exec(raw)?.[0] ?? "{}") as { keywords?: string[] };
      log.transcribe.push({ guion, keywords: req.keywords ?? [] });
      const turns = cfg.guiones[guion] ?? [];
      return Response.json({
        sessionId: `voyager/transcribe/${guion}`,
        transcript: turns.map((t) => t.transcript).join(" "),
        audioDurationMs: AUDIO_MS,
        turns: turns.map((t, i) => ({ turnId: i, ...t, speaker: t.speaker ?? undefined })),
      });
    }
    if (url.endsWith("/files") && init.method === "POST") {
      return Response.json({ id: `file-${newId().slice(0, 6)}`, object: "file", bytes: 1, created_at: 0, filename: "x", purpose: "user_data", status: "uploaded" });
    }
    if (url.includes("/files/") && init.method === "DELETE") return Response.json({ id: "file", object: "file", deleted: true });
    if (url.endsWith("/responses")) {
      const body = JSON.parse(String(init.body)) as { model: string; stream?: boolean; input: unknown; text?: { format?: { name?: string } } };
      if (body.stream) {
        const concept = textOfInput(body.input).trim();
        log.sam.push(concept);
        const img = imagesOfInput(body.input)[0];
        const id = img ? (/img=([A-Za-z0-9_-]+)\|/.exec(latin1(img))?.[1] ?? "x") : "x";
        return samSse(samLine(cfg.sam[id]?.[concept] ?? []));
      }
      const name = body.text?.format?.name;
      const text = textOfInput(body.input);
      if (name === "ficha") {
        log.ficha.push(text);
        const code = /^Caso ([A-Z0-9]+)\./m.exec(text)?.[1] ?? "";
        const f = cfg.fichas[code];
        if (!f) return Response.json({ error: { message: `sin ficha simulada para ${code}` } }, { status: 400 });
        return responseJson(body.model, f);
      }
      if (name === "lectura") {
        log.lectura++;
        const crop = imagesOfInput(body.input)[0];
        const id = crop ? (/img=([A-Za-z0-9_-]+)\|/.exec(latin1(crop))?.[1] ?? "x") : "x";
        return responseJson(body.model, cfg.lecturas[id] ?? { notas: [], placas: [] });
      }
      if (name === "vinculador") {
        log.vinculador.push(text);
        const fichas = [...new Set(text.match(/FICHA-[A-Z0-9]+/g) ?? [])].slice(0, 2);
        const raw = Number(/Puntaje combinado del motor: ([0-9.]+)/.exec(text)?.[1] ?? 0);
        if (cfg.vinculador === "invalido") {
          return responseJson(body.model, {
            puntaje_ajustado: 0.1,
            recomendacion: "descartar",
            explicacion: "Sin relación (EV-ZZZZ-99).",
            afirmaciones: [{ texto: "Afirmación sin respaldo", evidencia: ["EV-ZZZZ-99"] }],
            contradicciones: [],
          });
        }
        const puntaje = cfg.vinculador === "echo" ? raw : cfg.vinculador;
        return responseJson(body.model, {
          puntaje_ajustado: puntaje,
          recomendacion: puntaje >= 0.9 ? "probable" : puntaje >= 0.6 ? "por_revisar" : "descartar",
          explicacion: `Posible vínculo entre ${fichas.join(" y ")} (${fichas.join(", ")}).`,
          afirmaciones: [{ texto: "Las dos fichas comparten señales", evidencia: fichas }],
          contradicciones: [],
        });
      }
    }
    return Response.json({ error: { message: `ruta no simulada: ${url}` } }, { status: 404 });
  };
}

/** Lo que ve un test que no simula Meta: 401 (error permanente, la ficha queda pendiente). */
export const metaNoSimulada: FetchLike = async () =>
  Response.json({ error: { message: "Meta API no simulada en este test", type: "invalid_request_error", code: "unauthorized" } }, { status: 401 });

export function emptyMetaLog(): FakeMetaLog {
  return { transcribe: [], sam: [], ficha: [], vinculador: [], lectura: 0 };
}

// ---------------------------------------------------------------------------
// Evidencia directa (sin la cola: los tests llaman a los pasos del pipeline)
// ---------------------------------------------------------------------------

export async function insertEvidence(
  c: { id: string; code: string },
  n: number,
  tipo: "audio" | "imagen" | "video" | "texto",
  bytes: Uint8Array,
  opts: { mime?: string; source?: string; captured_at?: string } = {},
): Promise<{ id: string; label: string }> {
  const id = newId();
  const label = evidenceLabel(c.code, n);
  const key = evidenceR2Key(c.id, id);
  await putEncrypted(env.EVIDENCE, key, env.EVIDENCE_ENCRYPTION_KEY, bytes, id);
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    `INSERT INTO evidence (id, case_id, label, seq, tipo, mime, size_bytes, sha256, sha256_client, received_utc, captured_at, source, r2_key, uploader_pseudonym, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'V-TEST', 'recibido')`,
  )
    .bind(id, c.id, label, n, tipo, opts.mime ?? "application/octet-stream", bytes.byteLength, sha, sha, nowIso(), opts.captured_at ?? null, opts.source ?? null, key)
    .run();
  return { id, label };
}
