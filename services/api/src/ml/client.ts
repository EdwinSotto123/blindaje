import { PromptGuardLabel, SenalesTecnicas } from "@blindaje/shared";
import { z } from "zod";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { log } from "../lib/log";

/**
 * Cliente del contenedor ML (contrato en docs/ML_API.md). Dos implementaciones:
 *  - ContainerMlClient: binding de Containers `ML` (producción).
 *  - HttpMlClient: `ML_URL` (desarrollo local con docker/uvicorn y evaluación).
 * `getMlClient(env)` elige: ML_URL si tiene valor, si no el binding, si no lanza MlUnavailableError.
 */

export type MlIndexName = "voz" | "voz_segmento" | "texto" | "imagen";

export interface MlHealth {
  ok: boolean;
  models: { voice: boolean; text: boolean; image: boolean } | Record<string, unknown>;
  indices: Partial<Record<MlIndexName, number>>;
  index_version: string | null;
}

export interface VoiceEmbedRequest {
  wav_b64: string;
  turns: Array<{ speaker: string; start_ms: number; end_ms: number }> | null;
  exclude_vectors: number[][];
  exclude_threshold?: number;
}

export interface VoiceEmbedSpeaker {
  speaker: string;
  centroid: number[];
  segments: Array<{ start_ms: number; end_ms: number; vector: number[] }>;
  n_segments: number;
  duration_sec: number;
  victim_similarity: number | null;
  excluded: boolean;
}

export interface VoiceEmbedResponse {
  model: string;
  dim: number;
  speakers: VoiceEmbedSpeaker[];
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ImageCropsResponse {
  model: string;
  dim: number;
  full: { phash: string; vector: number[] };
  crops: Array<{ concept: string; box: Box; phash: string; vector: number[]; crop_jpeg_b64: string }>;
}

export interface GraphAnalyzeRequest {
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ source: string; target: string; weight?: number }>;
}

export interface GraphAnalyzeResponse {
  communities: string[][];
  centrality: Record<string, number>;
  degree: Record<string, number>;
}

export type BinaryBody = ArrayBuffer | Uint8Array<ArrayBuffer> | ReadableStream;

/** Tipo de medio de `/authenticity/{audio,image,video}`. */
export type AuthenticityMedia = "audio" | "image" | "video";

/** Opciones de las llamadas acotadas en tiempo (marcas de agua en la ruta de medios). */
export interface MlCallOptions {
  signal?: AbortSignal;
}

/** Copia marcada que devuelve `/watermark/{audio,image}/embed`. */
export interface WatermarkEmbedResult {
  bytes: ArrayBuffer;
  /** audio/wav (mono PCM16 de 16 kHz) o image/jpeg. */
  content_type: string;
  /** Header `x-watermark-model`. */
  model: string | null;
  /** Header `x-watermark-message` (lo que el contenedor dice que embebió), si viene. */
  message: string | null;
  /** Header `x-watermark-nbits` (imagen), si viene. */
  nbits: number | null;
}

/** `/watermark/audio/detect`: AudioSeal con mensaje de 16 bits. `bits[i]` es el bit (15 - i) del mensaje (MSB primero). */
export const AudioWatermarkDetection = z.object({
  detected: z.boolean(),
  score: z.number(),
  message: z.number().int().min(0).max(65535).nullable(),
  bits: z.array(z.number().min(0).max(1)).length(16),
  bit_confidence: z.number().nullable().optional(),
  model: z.string(),
});
export type AudioWatermarkDetection = z.infer<typeof AudioWatermarkDetection>;

/** `/watermark/image/detect`: Video Seal. `bits[i]` es el bit i del mensaje en hex, MSB primero en cada dígito. */
export const ImageWatermarkDetection = z.object({
  detected: z.boolean(),
  score: z.number(),
  bits: z.array(z.number().min(0).max(1)).min(1),
  message_hex: z.string().regex(/^[0-9a-fA-F]*$/),
  model: z.string(),
});
export type ImageWatermarkDetection = z.infer<typeof ImageWatermarkDetection>;

/** `/safety/prompt-guard`: Llama Prompt Guard 2, un resultado por texto (en el mismo orden). */
export const PromptGuardResponse = z.object({
  model: z.string(),
  threshold: z.number(),
  results: z.array(z.object({ score: z.number().min(0).max(1), label: PromptGuardLabel, chunks: z.number().int().optional() })),
});
export type PromptGuardResponse = z.infer<typeof PromptGuardResponse>;

/** Máximo de textos por llamada a `/safety/prompt-guard`. */
export const PROMPT_GUARD_MAX_TEXTS = 64;

export interface MlClient {
  readonly kind: "container" | "http";
  /** Petición cruda, para endpoints nuevos sin envoltorio tipado. */
  raw(path: string, init?: RequestInit): Promise<Response>;
  health(): Promise<MlHealth>;
  normalizeAudio(body: BinaryBody): Promise<{ wav: ArrayBuffer; duration_ms: number | null }>;
  voiceEnroll(body: BinaryBody): Promise<{ model: string; dim: number; vector: number[] }>;
  voiceEmbed(req: VoiceEmbedRequest): Promise<VoiceEmbedResponse>;
  voiceCompare(a: number[], b: number[]): Promise<{ cosine: number; snorm: number | null }>;
  textEmbed(texts: string[], kind: "query" | "passage"): Promise<{ model: string; dim: number; vectors: number[][] }>;
  imageCrops(req: { image_b64: string; boxes: Array<Box & { concept: string }> }): Promise<ImageCropsResponse>;
  imageRedact(req: { image_b64: string; regions: Box[] }): Promise<ArrayBuffer>;
  videoSample(
    body: BinaryBody,
    opts?: { fps?: number; max_frames?: number },
  ): Promise<{ mp4: ArrayBuffer; frames: number; fps: number; width: number; height: number }>;
  videoFrame(body: BinaryBody, opts: { index: number; fps?: number }): Promise<ArrayBuffer>;
  indexAdd(index: MlIndexName, ids: number[], vectors: number[][]): Promise<{ ok: boolean; size: number }>;
  indexSearch(
    index: MlIndexName,
    vector: number[],
    k: number,
    excludeIds?: number[],
  ): Promise<{ results: Array<{ id: number; score: number }> }>;
  indexRemove(index: MlIndexName, ids: number[]): Promise<{ ok: boolean; size: number }>;
  indexRebuild(index: MlIndexName, ids: number[], vectors: number[][]): Promise<{ ok: boolean; size: number }>;
  indexSnapshot(): Promise<ArrayBuffer>;
  indexLoad(zip: ArrayBuffer): Promise<{ ok: boolean; sizes: Record<string, number> }>;
  graphAnalyze(req: GraphAnalyzeRequest): Promise<GraphAnalyzeResponse>;
  pdfRender(template: "denuncia" | "expediente", data: unknown): Promise<ArrayBuffer>;
  /**
   * Señales técnicas de autenticidad (marca de agua de AudioSeal o Video Seal, C2PA, metadatos y,
   * si existe, detector de voz sintética) sobre el ORIGINAL (cuerpo crudo; `x-content-type` con el
   * MIME declarado). Lo que el contenedor no revisó llega en null.
   */
  authenticityAudio(body: BinaryBody, mime?: string): Promise<SenalesTecnicas>;
  authenticityImage(body: BinaryBody, mime?: string): Promise<SenalesTecnicas>;
  authenticityVideo(body: BinaryBody, mime?: string): Promise<SenalesTecnicas>;
  /** Marca de agua AudioSeal de 16 bits (`message` 0..65535). Devuelve WAV mono PCM16 de 16 kHz. */
  watermarkAudioEmbed(body: BinaryBody, message: number, opts?: MlCallOptions): Promise<WatermarkEmbedResult>;
  watermarkAudioDetect(body: BinaryBody, opts?: MlCallOptions): Promise<AudioWatermarkDetection>;
  /** Marca de agua Video Seal con un mensaje en hex de nbits/4 dígitos. Devuelve JPEG. */
  watermarkImageEmbed(body: BinaryBody, messageHex: string, opts?: MlCallOptions): Promise<WatermarkEmbedResult>;
  watermarkImageDetect(body: BinaryBody, opts?: MlCallOptions): Promise<ImageWatermarkDetection>;
  /** Llama Prompt Guard 2 sobre hasta 64 textos. 503 (`prompt_guard_unavailable`) si faltan los pesos. */
  promptGuard(texts: string[], opts?: MlCallOptions): Promise<PromptGuardResponse>;
}

/** Valida la respuesta del contenedor con un esquema; si no cumple el contrato, 502. */
function parseMl<S extends z.ZodType>(schema: S, raw: unknown, what: string): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("upstream_error", `El servicio de análisis devolvió ${what} con otra forma`, {
      status: 502,
      details: { service: "ml", issues: parsed.error.issues.length },
    });
  }
  return parsed.data;
}

/**
 * Lee la respuesta de `/authenticity/*`: las claves que falten cuentan como "no revisado" (null) y
 * las desconocidas se descartan. Si la forma no es la del contrato, lanza (el paso queda sin
 * señales técnicas).
 */
export function parseSenalesTecnicas(raw: unknown): SenalesTecnicas {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const parsed = SenalesTecnicas.safeParse({ watermark: null, c2pa: null, metadata: null, synthetic_speech: null, ...base });
  if (!parsed.success) {
    throw new ApiError("upstream_error", "El servicio de análisis devolvió señales de autenticidad con otra forma", {
      status: 502,
      details: { service: "ml", issues: parsed.error.issues.length },
    });
  }
  return parsed.data;
}

export class MlUnavailableError extends ApiError {
  constructor(reason: string) {
    super("upstream_error", "El servicio de análisis no está disponible en este momento. Intenta de nuevo en unos minutos.", {
      status: 503,
      details: { service: "ml", reason },
      headers: { "retry-after": "60" },
    });
    this.name = "MlUnavailableError";
  }
}

const JSON_HEADERS = { "content-type": "application/json" };
const DEFAULT_TIMEOUT_MS = 120_000;

abstract class BaseMlClient implements MlClient {
  abstract readonly kind: "container" | "http";
  protected abstract send(path: string, init: RequestInit): Promise<Response>;

  constructor(protected readonly token: string | undefined) {}

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set("x-ml-token", this.token);
    let res: Response;
    try {
      res = await this.send(path, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    } catch (err) {
      log("warn", "ml_unreachable", { path, kind: this.kind, error_name: (err as Error).name });
      throw new MlUnavailableError("unreachable");
    }
    if (res.status >= 500 || res.status === 404) {
      log("warn", "ml_error", { path, kind: this.kind, status: res.status });
      throw new MlUnavailableError(`status_${res.status}`);
    }
    if (!res.ok) {
      log("warn", "ml_bad_request", { path, kind: this.kind, status: res.status });
      throw new ApiError("upstream_error", "El servicio de análisis rechazó la petición", {
        status: 502,
        details: { service: "ml", status: res.status },
      });
    }
    return res;
  }

  private async json<T>(path: string, body: unknown, opts: MlCallOptions = {}): Promise<T> {
    const res = await this.raw(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body), ...(opts.signal ? { signal: opts.signal } : {}) });
    return (await res.json()) as T;
  }

  private async binary(path: string, body: BinaryBody, opts: MlCallOptions = {}): Promise<Response> {
    return this.raw(path, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  private async embedResult(res: Response, fallbackType: string): Promise<WatermarkEmbedResult> {
    const nbits = Number(res.headers.get("x-watermark-nbits"));
    return {
      bytes: await res.arrayBuffer(),
      content_type: res.headers.get("content-type")?.split(";")[0]?.trim() || fallbackType,
      model: res.headers.get("x-watermark-model"),
      message: res.headers.get("x-watermark-message"),
      nbits: Number.isInteger(nbits) && nbits > 0 ? nbits : null,
    };
  }

  async health(): Promise<MlHealth> {
    return (await (await this.raw("/health", { method: "GET" })).json()) as MlHealth;
  }

  async normalizeAudio(body: BinaryBody) {
    const res = await this.binary("/audio/normalize", body);
    const d = res.headers.get("x-duration-ms");
    return { wav: await res.arrayBuffer(), duration_ms: d ? Number(d) : null };
  }

  async voiceEnroll(body: BinaryBody) {
    return (await (await this.binary("/voice/enroll", body)).json()) as { model: string; dim: number; vector: number[] };
  }

  voiceEmbed(req: VoiceEmbedRequest) {
    return this.json<VoiceEmbedResponse>("/voice/embed", req);
  }

  voiceCompare(a: number[], b: number[]) {
    return this.json<{ cosine: number; snorm: number | null }>("/voice/compare", { a, b });
  }

  textEmbed(texts: string[], kind: "query" | "passage") {
    return this.json<{ model: string; dim: number; vectors: number[][] }>("/text/embed", { texts, kind });
  }

  imageCrops(req: { image_b64: string; boxes: Array<Box & { concept: string }> }) {
    return this.json<ImageCropsResponse>("/image/crops", req);
  }

  async imageRedact(req: { image_b64: string; regions: Box[] }) {
    const res = await this.raw("/image/redact", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(req) });
    return res.arrayBuffer();
  }

  async videoSample(body: BinaryBody, opts: { fps?: number; max_frames?: number } = {}) {
    const q = new URLSearchParams({ fps: String(opts.fps ?? 5), max_frames: String(opts.max_frames ?? 300) });
    const res = await this.binary(`/video/sample?${q}`, body);
    return {
      mp4: await res.arrayBuffer(),
      frames: Number(res.headers.get("x-frames") ?? 0),
      fps: Number(res.headers.get("x-fps") ?? opts.fps ?? 5),
      width: Number(res.headers.get("x-width") ?? 0),
      height: Number(res.headers.get("x-height") ?? 0),
    };
  }

  async videoFrame(body: BinaryBody, opts: { index: number; fps?: number }) {
    const q = new URLSearchParams({ index: String(opts.index), fps: String(opts.fps ?? 5) });
    return (await this.binary(`/video/frame?${q}`, body)).arrayBuffer();
  }

  indexAdd(index: MlIndexName, ids: number[], vectors: number[][]) {
    return this.json<{ ok: boolean; size: number }>("/index/add", { index, ids, vectors });
  }

  indexSearch(index: MlIndexName, vector: number[], k: number, excludeIds?: number[]) {
    return this.json<{ results: Array<{ id: number; score: number }> }>("/index/search", {
      index,
      vector,
      k,
      ...(excludeIds ? { exclude_ids: excludeIds } : {}),
    });
  }

  indexRemove(index: MlIndexName, ids: number[]) {
    return this.json<{ ok: boolean; size: number }>("/index/remove", { index, ids });
  }

  indexRebuild(index: MlIndexName, ids: number[], vectors: number[][]) {
    return this.json<{ ok: boolean; size: number }>("/index/rebuild", { index, ids, vectors });
  }

  async indexSnapshot() {
    return (await this.raw("/index/snapshot", { method: "GET" })).arrayBuffer();
  }

  async indexLoad(zip: ArrayBuffer) {
    return (await (await this.binary("/index/load", zip)).json()) as { ok: boolean; sizes: Record<string, number> };
  }

  graphAnalyze(req: GraphAnalyzeRequest) {
    return this.json<GraphAnalyzeResponse>("/graph/analyze", req);
  }

  async pdfRender(template: "denuncia" | "expediente", data: unknown) {
    const res = await this.raw("/pdf/render", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ template, data }) });
    return res.arrayBuffer();
  }

  private async authenticity(kind: AuthenticityMedia, body: BinaryBody, mime?: string): Promise<SenalesTecnicas> {
    const headers: Record<string, string> = { "content-type": "application/octet-stream" };
    if (mime) headers["x-content-type"] = mime;
    const res = await this.raw(`/authenticity/${kind}`, { method: "POST", headers, body });
    return parseSenalesTecnicas(await res.json());
  }

  authenticityAudio(body: BinaryBody, mime?: string) {
    return this.authenticity("audio", body, mime);
  }

  authenticityImage(body: BinaryBody, mime?: string) {
    return this.authenticity("image", body, mime);
  }

  authenticityVideo(body: BinaryBody, mime?: string) {
    return this.authenticity("video", body, mime);
  }

  async watermarkAudioEmbed(body: BinaryBody, message: number, opts: MlCallOptions = {}) {
    const res = await this.binary(`/watermark/audio/embed?${new URLSearchParams({ message: String(message) })}`, body, opts);
    return this.embedResult(res, "audio/wav");
  }

  async watermarkAudioDetect(body: BinaryBody, opts: MlCallOptions = {}) {
    const res = await this.binary("/watermark/audio/detect", body, opts);
    return parseMl(AudioWatermarkDetection, await res.json(), "una detección de marca de audio");
  }

  async watermarkImageEmbed(body: BinaryBody, messageHex: string, opts: MlCallOptions = {}) {
    const res = await this.binary(`/watermark/image/embed?${new URLSearchParams({ message: messageHex })}`, body, opts);
    return this.embedResult(res, "image/jpeg");
  }

  async watermarkImageDetect(body: BinaryBody, opts: MlCallOptions = {}) {
    const res = await this.binary("/watermark/image/detect", body, opts);
    return parseMl(ImageWatermarkDetection, await res.json(), "una detección de marca de imagen");
  }

  async promptGuard(texts: string[], opts: MlCallOptions = {}) {
    if (texts.length > PROMPT_GUARD_MAX_TEXTS) throw new ApiError("bad_request", `Prompt Guard acepta hasta ${PROMPT_GUARD_MAX_TEXTS} textos por llamada`);
    const out = parseMl(PromptGuardResponse, await this.json<unknown>("/safety/prompt-guard", { texts }, opts), "un resultado de Prompt Guard");
    if (out.results.length !== texts.length) {
      throw new ApiError("upstream_error", "Prompt Guard devolvió otra cantidad de resultados", { status: 502, details: { service: "ml" } });
    }
    return out;
  }
}

export class HttpMlClient extends BaseMlClient {
  readonly kind = "http" as const;
  private readonly base: string;

  constructor(baseUrl: string, token?: string) {
    super(token);
    this.base = baseUrl.replace(/\/+$/, "");
  }

  protected send(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.base}${path}`, init);
  }
}

export class ContainerMlClient extends BaseMlClient {
  readonly kind = "container" as const;

  constructor(
    private readonly ns: NonNullable<Env["ML"]>,
    token?: string,
    private readonly instance = "ml-0",
  ) {
    super(token);
  }

  protected send(path: string, init: RequestInit): Promise<Response> {
    const stub = this.ns.get(this.ns.idFromName(this.instance));
    return stub.fetch(new Request(`http://container${path}`, init));
  }
}

/** "not_configured" simula un despliegue sin ML (sin binding ni ML_URL): getMlClient lanza not_configured. */
let override: MlClient | "not_configured" | null = null;

/** Solo para pruebas: reemplaza el cliente que devuelve getMlClient. */
export function setMlClientForTests(client: MlClient | "not_configured" | null): void {
  override = client;
}

/** Solo para pruebas: el cliente instalado con setMlClientForTests, o null. */
export function mlClientForTests(): MlClient | "not_configured" | null {
  return override;
}

export function getMlClient(env: Env): MlClient {
  if (override === "not_configured") throw new MlUnavailableError("not_configured");
  if (override) return override;
  if (env.ML_URL && env.ML_URL.trim()) return new HttpMlClient(env.ML_URL.trim(), env.ML_TOKEN);
  if (env.ML) return new ContainerMlClient(env.ML, env.ML_TOKEN);
  throw new MlUnavailableError("not_configured");
}

/** Como getMlClient, pero devuelve null en vez de lanzar (para tareas de mejor esfuerzo). */
export function tryGetMlClient(env: Env): MlClient | null {
  try {
    return getMlClient(env);
  } catch {
    return null;
  }
}
