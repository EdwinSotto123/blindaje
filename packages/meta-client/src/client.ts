import type { z } from "zod";
import { runAgent as runAgentLoop, type AgentResult, type RunAgentParams } from "./agent";
import { bytesToDataUrl, buildMultipart, sniffImageMime, toUint8Array, type BinaryInput } from "./bytes";
import { ClientCore, type CallOptions, type MetaClientOptions } from "./core";
import { MetaApiError, MetaGuardError, MetaOutputError } from "./errors";
import { assertModelAllowed, assertNoWebSearch, assertToolChoice, assertToolName } from "./guards";
import { estimateCost, MODELS } from "./pricing";
import {
  assertCompleted,
  extractUsage,
  getOutputText,
  getRefusal,
  parseStructuredText,
  tokenUnits,
  zodTextFormat,
  type MetaResponse,
  type ReasoningEffort,
  type ResponseUsage,
  type ResponsesCreateParams,
  type TokenUsage,
} from "./responses";
import { parseSamOutput, type SamFrame, type SamObject } from "./sam";
import { readResponsesEvents } from "./sse";
import { assertTranscribableWav, normalizeTranscription, type TranscribeOptions, type TranscriptionResult } from "./transcribe";

export interface ResponsesParseParams<S extends z.ZodType> extends Omit<ResponsesCreateParams, "text"> {
  schema: S;
  /** Nombre del esquema en text.format ([a-zA-Z0-9_-], máx. 64). */
  schemaName: string;
  /** Por defecto true. */
  strict?: boolean;
  /** Atajo de `reasoning.effort`. */
  reasoningEffort?: ReasoningEffort;
}

export interface ParsedResponse<T> {
  output: T;
  response: MetaResponse;
  usage: TokenUsage;
  costUsd: number;
}

export type SamMaskEncoding = "lossless" | "one_bit";

export interface SegmentImageParams {
  /** Bytes de la imagen, una data URL (`data:image/png;base64,…`) o una URL pública. */
  image?: BinaryInput | string;
  /** Alternativa a `image`: una imagen ya subida con la Files API. */
  fileId?: string;
  /** Tipo MIME si `image` son bytes y no se puede detectar. */
  mimeType?: string;
  /** Frase nominal corta con un solo concepto ("rostro", "placa de vehículo"). */
  concept: string;
  includeConfidence?: boolean;
  maskEncoding?: SamMaskEncoding;
  model?: string;
}

export interface SegmentImageResult {
  objects: SamObject[];
  /** Tamaño de la imagen de origen según SAM (null si no hubo objetos). */
  width: number | null;
  height: number | null;
  rawText: string;
  problems: string[];
  responseId: string | null;
  requestId: string | null;
  usage: ResponseUsage | null;
}

export interface SegmentVideoParams {
  fileId?: string;
  videoUrl?: string;
  concept: string;
  includeConfidence?: boolean;
  /** Por defecto one_bit (cargas varias veces más chicas). */
  maskEncoding?: SamMaskEncoding;
  model?: string;
}

export interface SegmentVideoResult {
  /** Solo los frames con objetos, en orden ascendente. */
  frames: SamFrame[];
  /** Frames facturados según `usage.video_frames_processed` (incluye el mínimo de 50). */
  framesProcessed: number | null;
  rawText: string;
  problems: string[];
  responseId: string | null;
  requestId: string | null;
  usage: ResponseUsage | null;
}

export interface FileObject {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  status?: string;
  expires_at?: number;
  [key: string]: unknown;
}

export interface UploadFileOptions {
  filename: string;
  mimeType?: string;
  /** Por defecto `user_data` (archivos para inferencia). */
  purpose?: "user_data" | "batch";
  /** Expiración automática, entre 3600 (1 h) y 2592000 (30 días). Sin esto el archivo no expira. */
  expiresAfterSeconds?: number;
}

export interface GenerateImageParams {
  prompt: string;
  /** "WxH": fija la proporción, no el tamaño exacto. */
  size?: string;
  n?: number;
  outputFormat?: "webp" | "png" | "jpeg";
  reasoningStrength?: "low" | "high";
  model?: string;
}

export interface GeneratedImage {
  b64: string;
  mimeType: string;
}

export interface GenerateImageResult {
  images: GeneratedImage[];
  created: number | null;
  usage: Record<string, unknown> | null;
}

export class MetaClient {
  readonly core: ClientCore;

  constructor(options: MetaClientOptions) {
    this.core = new ClientCore(options);
  }

  readonly responses = {
    /** `POST /v1/responses` sin streaming, con salvaguardas y registro de costo. */
    create: async (params: ResponsesCreateParams, call: CallOptions = {}): Promise<MetaResponse> => {
      assertModelAllowed(params.model);
      assertNoWebSearch(params as unknown as Record<string, unknown>);
      assertToolChoice(params.tool_choice);
      for (const tool of params.tools ?? []) {
        if (tool.type === "function" && typeof tool.name === "string") assertToolName(tool.name);
      }
      if ((params as { stream?: unknown }).stream) {
        throw new MetaGuardError("invalid_input", "responses.create no admite stream; usa segmentImage/segmentVideo para SAM");
      }
      return this.core.metered(params.model, "responses", call, async () => {
        const { value, requestId } = await this.core.json<MetaResponse>({ method: "POST", path: "/responses", json: params }, call);
        return { value, units: tokenUnits(extractUsage(value)), requestId, responseId: value.id };
      });
    },

    /**
     * Salida estructurada: convierte el esquema Zod a `text.format` json_schema strict, parsea
     * `output_text` y lo valida con Zod. Por defecto `store: false` (la evidencia no queda guardada).
     */
    parse: async <S extends z.ZodType>(params: ResponsesParseParams<S>, call: CallOptions = {}): Promise<ParsedResponse<z.output<S>>> => {
      const { schema, schemaName, strict, reasoningEffort, ...rest } = params;
      const request: ResponsesCreateParams = {
        store: false,
        ...rest,
        ...(reasoningEffort ? { reasoning: { ...rest.reasoning, effort: reasoningEffort } } : {}),
        text: { format: zodTextFormat(schema, schemaName, strict === undefined ? {} : { strict }) },
      };
      const response = await this.responses.create(request, call);
      assertCompleted(response);
      const refusal = getRefusal(response);
      if (refusal) throw new MetaOutputError("failed", `El modelo rechazó la solicitud: ${refusal}`, { responseId: response.id });
      const output = parseStructuredText(getOutputText(response), schema, response.id);
      const usage = extractUsage(response);
      return { output, response, usage, costUsd: estimateCost(response.model || params.model, usage) };
    },
  };

  /** Bucle de agente con herramientas (ver agent.ts). */
  runAgent<S extends z.ZodType | undefined = undefined>(
    params: RunAgentParams<S>,
    call: CallOptions = {},
  ): Promise<AgentResult<S extends z.ZodType ? z.output<S> : string>> {
    return runAgentLoop((p, c) => this.responses.create(p, c), params, { operation: "agent", ...call });
  }

  /** Muse Voice Transcribe por archivo (WAV mono PCM16 de 16 o 24 kHz). */
  async transcribe(audio: BinaryInput | Blob, options: TranscribeOptions = {}, call: CallOptions = {}): Promise<TranscriptionResult> {
    const bytes = audio instanceof Blob ? new Uint8Array(await audio.arrayBuffer()) : toUint8Array(audio);
    const wav = assertTranscribableWav(bytes);
    const model = options.model ?? MODELS.transcribe;
    const request = {
      model,
      mode: options.mode ?? "DIARIZATION",
      audioEncoding: "WAV",
      ...(options.languageBias?.length ? { languageBias: options.languageBias } : {}),
      ...(options.keywords?.length ? { keywords: options.keywords } : {}),
    };
    const multipart = buildMultipart([
      { name: "request", value: JSON.stringify(request), contentType: "application/json" },
      { name: "audio", value: bytes, filename: "audio.wav", contentType: "audio/wav" },
    ]);
    const query = options.sessionId ? `?sessionId=${encodeURIComponent(options.sessionId)}` : "";
    return this.core.metered(model, "transcribe", call, async () => {
      const { value, requestId } = await this.core.send(
        { method: "POST", path: `/asr/transcribe${query}`, body: multipart.body, contentType: multipart.contentType, accept: "application/json" },
        { timeoutMs: 300_000, ...call },
        async (res) => normalizeTranscription(await res.json(), { keepEmptyTurns: options.keepEmptyTurns ?? false }),
      );
      const durationMs = value.audioDurationMs || wav.durationMs;
      return { value, units: { audio_seconds: Math.floor(durationMs / 1000) }, requestId, responseId: value.sessionId };
    });
  }

  /** SAM 3.1 sobre una imagen: un concepto por petición, por SSE. */
  async segmentImage(params: SegmentImageParams, call: CallOptions = {}): Promise<SegmentImageResult> {
    const concept = assertConcept(params.concept);
    const model = params.model ?? MODELS.sam;
    const imagePart = buildImagePart(params);
    return this.core.metered(model, "sam_image", call, async () => {
      const { value, requestId } = await this.#samStream(model, concept, imagePart, params.includeConfidence, params.maskEncoding, call);
      const parsed = parseSamOutput(value.text);
      const objects = parsed.frames.find((f) => f.frame === 0)?.objects ?? parsed.frames[0]?.objects ?? [];
      const first = objects[0];
      return {
        value: {
          objects,
          width: first?.box.w ?? null,
          height: first?.box.h ?? null,
          rawText: value.text,
          problems: parsed.problems,
          responseId: value.responseId,
          requestId,
          usage: value.usage,
        },
        units: { images: 1 },
        requestId,
        responseId: value.responseId,
      };
    });
  }

  /** SAM 3.1 sobre un video (subido con la Files API o por URL): una línea por frame. */
  async segmentVideo(params: SegmentVideoParams, call: CallOptions = {}): Promise<SegmentVideoResult> {
    const concept = assertConcept(params.concept);
    const model = params.model ?? MODELS.sam;
    if (!params.fileId === !params.videoUrl) {
      throw new MetaGuardError("invalid_input", "segmentVideo necesita exactamente uno de fileId o videoUrl");
    }
    const videoPart = params.fileId
      ? { type: "input_video" as const, file_id: params.fileId }
      : { type: "input_video" as const, video_url: params.videoUrl as string };
    return this.core.metered(model, "sam_video", call, async () => {
      const { value, requestId } = await this.#samStream(
        model,
        concept,
        videoPart,
        params.includeConfidence,
        params.maskEncoding ?? "one_bit",
        { timeoutMs: 600_000, ...call },
      );
      const parsed = parseSamOutput(value.text);
      const reported = typeof value.usage?.video_frames_processed === "number" ? value.usage.video_frames_processed : null;
      const lastFrame = parsed.frames.at(-1)?.frame ?? -1;
      return {
        value: {
          frames: parsed.frames,
          framesProcessed: reported,
          rawText: value.text,
          problems: parsed.problems,
          responseId: value.responseId,
          requestId,
          usage: value.usage,
        },
        units: { frames: reported ?? Math.max(lastFrame + 1, 50) },
        requestId,
        responseId: value.responseId,
      };
    });
  }

  async #samStream(
    model: string,
    concept: string,
    mediaPart: Record<string, unknown>,
    includeConfidence: boolean | undefined,
    maskEncoding: SamMaskEncoding | undefined,
    call: CallOptions,
  ) {
    const metadata: Record<string, string> = {};
    if (includeConfidence) metadata.include_confidence = "true";
    if (maskEncoding) metadata.mask_encoding = maskEncoding;
    const body = {
      model,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, mediaPart] }],
      stream: true,
      store: false,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
    return this.core.send({ method: "POST", path: "/responses", json: body, accept: "text/event-stream" }, call, async (res, requestId) => {
      if (!res.body) throw new MetaApiError({ status: res.status, message: "respuesta SSE sin cuerpo", requestId });
      return collectSamStream(res.body, requestId);
    });
  }

  readonly files = {
    /** `POST /v1/files` (purpose=user_data por defecto). La subida es síncrona: 200 = listo. */
    upload: async (data: BinaryInput | Blob, options: UploadFileOptions, call: CallOptions = {}): Promise<FileObject> => {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : toUint8Array(data);
      const parts: Parameters<typeof buildMultipart>[0] = [{ name: "purpose", value: options.purpose ?? "user_data" }];
      if (options.expiresAfterSeconds !== undefined) {
        parts.push({ name: "expires_after[anchor]", value: "created_at" });
        parts.push({ name: "expires_after[seconds]", value: String(options.expiresAfterSeconds) });
      }
      parts.push({ name: "file", value: bytes, filename: options.filename, contentType: options.mimeType ?? guessMime(options.filename) });
      const multipart = buildMultipart(parts);
      const { value } = await this.core.json<FileObject>(
        { method: "POST", path: "/files", body: multipart.body, contentType: multipart.contentType },
        { timeoutMs: 300_000, ...call },
      );
      return value;
    },

    /** `DELETE /v1/files/{id}`. */
    delete: async (fileId: string, call: CallOptions = {}): Promise<{ id: string; object: string; deleted: boolean }> => {
      const { value } = await this.core.json<{ id: string; object: string; deleted: boolean }>(
        { method: "DELETE", path: `/files/${encodeURIComponent(fileId)}` },
        call,
      );
      return value;
    },
  };

  readonly images = {
    /**
     * Muse Image por `/v1/images/generations` (no esencial: se bloquea con el presupuesto al 80%).
     * Se apagan la búsqueda web y de imágenes integradas del modelo.
     */
    generate: async (params: GenerateImageParams, call: CallOptions = {}): Promise<GenerateImageResult> => {
      const model = params.model ?? MODELS.image;
      const outputFormat = params.outputFormat ?? "png";
      const body = {
        model,
        prompt: params.prompt,
        n: params.n ?? 1,
        response_format: "b64_json",
        output_format: outputFormat,
        tool_enablement: { enable_web_search: false, enable_image_search: false },
        ...(params.size ? { size: params.size } : {}),
        ...(params.reasoningStrength ? { reasoning_strength: params.reasoningStrength } : {}),
      };
      return this.core.metered(model, "image", call, async () => {
        const { value, requestId } = await this.core.json<{ created?: number; data?: Array<{ b64_json?: string }>; output_format?: string; usage?: Record<string, unknown> }>(
          { method: "POST", path: "/images/generations", json: body },
          { timeoutMs: 180_000, ...call },
        );
        const format = value.output_format ?? outputFormat;
        const images = (value.data ?? [])
          .filter((d): d is { b64_json: string } => typeof d.b64_json === "string")
          .map((d) => ({ b64: d.b64_json, mimeType: `image/${format === "jpeg" ? "jpeg" : format}` }));
        return {
          value: { images, created: value.created ?? null, usage: value.usage ?? null },
          units: { images: images.length },
          requestId,
        };
      });
    },
  };

  /** `GET /v1/models` (gratis): útil para verificar la llave. */
  async listModels(call: CallOptions = {}): Promise<string[]> {
    const { value } = await this.core.json<{ data?: Array<{ id: string }> }>({ method: "GET", path: "/models" }, call);
    return (value.data ?? []).map((m) => m.id);
  }
}

export function createMetaClient(options: MetaClientOptions): MetaClient {
  return new MetaClient(options);
}

// ---------------------------------------------------------------------------------------------

function assertConcept(concept: string): string {
  const trimmed = typeof concept === "string" ? concept.trim() : "";
  if (!trimmed) throw new MetaGuardError("invalid_input", "SAM necesita un concepto (frase nominal corta)");
  if (trimmed.length > 200) throw new MetaGuardError("invalid_input", "El concepto de SAM debe ser una frase corta");
  return trimmed;
}

function buildImagePart(params: SegmentImageParams): Record<string, unknown> {
  if (params.fileId && params.image === undefined) return { type: "input_image", file_id: params.fileId };
  const image = params.image;
  if (image === undefined) throw new MetaGuardError("invalid_input", "segmentImage necesita image o fileId");
  if (typeof image === "string") {
    if (/^data:image\//.test(image) || /^https?:\/\//.test(image)) return { type: "input_image", image_url: image };
    throw new MetaGuardError("invalid_input", "image debe ser bytes, una data URL de imagen o una URL http(s)");
  }
  const mime = params.mimeType ?? sniffImageMime(image);
  if (!mime) throw new MetaGuardError("invalid_input", "No se pudo detectar el tipo de imagen; pasa mimeType");
  return { type: "input_image", image_url: bytesToDataUrl(image, mime) };
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    json: "application/json",
    jsonl: "application/jsonl",
    txt: "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}

export interface SamStreamResult {
  text: string;
  responseId: string | null;
  usage: ResponseUsage | null;
  response: MetaResponse | null;
}

/**
 * Lee el SSE de una respuesta SAM: acumula `response.output_text.delta` por carril, usa
 * `output_text.done` como texto definitivo, y exige un evento terminal. Sin coincidencias, el
 * stream completa con texto vacío (resultado válido, no error).
 */
export async function collectSamStream(body: ReadableStream<Uint8Array>, requestId: string | null): Promise<SamStreamResult> {
  const lanes = new Map<string, string>();
  const laneKey = (e: Record<string, unknown>) => `${String(e.output_index ?? 0)}:${String(e.content_index ?? 0)}`;
  let responseId: string | null = null;
  let final: MetaResponse | null = null;
  for await (const evt of readResponsesEvents(body, requestId)) {
    const response = (evt.response ?? null) as MetaResponse | null;
    if (response?.id) responseId = response.id;
    switch (evt.type) {
      case "response.output_text.delta":
        lanes.set(laneKey(evt), (lanes.get(laneKey(evt)) ?? "") + String(evt.delta ?? ""));
        break;
      case "response.output_text.done":
        if (typeof evt.text === "string") lanes.set(laneKey(evt), evt.text);
        break;
      case "response.refusal.done":
        throw new MetaOutputError("failed", `SAM rechazó la solicitud: ${String(evt.refusal ?? "")}`, { responseId });
      case "response.failed": {
        const err = response?.error ?? {};
        throw new MetaApiError({
          status: 200,
          inStream: true,
          message: err.message ?? "la respuesta falló",
          code: err.code ?? "server_error",
          requestId,
        });
      }
      case "response.incomplete":
        throw new MetaOutputError("incomplete", `La segmentación quedó incompleta (${response?.incomplete_details?.reason ?? "sin motivo"})`, {
          responseId,
          rawText: [...lanes.values()].join(""),
        });
      case "response.completed":
        final = response;
        break;
    }
  }
  if (!final) {
    // El stream se cortó sin evento terminal: se trata como error transitorio del servidor.
    throw new MetaApiError({ status: 200, inStream: true, code: "server_error", message: "el stream terminó sin response.completed", requestId });
  }
  const keys = [...lanes.keys()].sort();
  let text = keys.map((k) => lanes.get(k) ?? "").join("\n");
  if (!text && final.output) text = getOutputText(final);
  return { text, responseId, usage: final.usage ?? null, response: final };
}
