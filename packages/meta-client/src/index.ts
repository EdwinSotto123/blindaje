/**
 * @blindaje/meta-client: cliente tipado de la Meta Model API basado en `fetch`.
 * Corre en Cloudflare Workers (services/api) y en Node 22 (eval/).
 */
export { MetaClient, createMetaClient, collectSamStream } from "./client";
export type {
  FileObject,
  GenerateImageParams,
  GenerateImageResult,
  GeneratedImage,
  ParsedResponse,
  ResponsesParseParams,
  SamMaskEncoding,
  SamStreamResult,
  SegmentImageParams,
  SegmentImageResult,
  SegmentVideoParams,
  SegmentVideoResult,
  UploadFileOptions,
} from "./client";

export { ClientCore, DEFAULT_BASE_URL, parseRetryAfter, toApiError } from "./core";
export type { CallInfo, CallOptions, FetchInit, FetchLike, MetaClientOptions, MetaHooks, UsageEvent, UsageStatus } from "./core";

export {
  MetaAgentError,
  MetaApiError,
  MetaError,
  MetaGuardError,
  MetaNetworkError,
  MetaOutputError,
  MetaTimeoutError,
  RETRYABLE_ERROR_CODES,
} from "./errors";
export type { MetaAgentCode, MetaApiErrorInit, MetaGuardCode, MetaOutputCode } from "./errors";

export { assertModelAllowed, assertNoWebSearch, assertToolChoice, assertToolName } from "./guards";

export { MODELS, NON_ESSENTIAL_MODELS, PRICING, estimateCost, isEssentialModel, priceFor } from "./pricing";
export type { ModelPrice, UsageUnits } from "./pricing";

export {
  addTokenUsage,
  assertCompleted,
  emptyTokenUsage,
  extractUsage,
  getFunctionCalls,
  getOutputText,
  getRefusal,
  parseStructuredText,
  strictSubsetProblems,
  tokenUnits,
  zodTextFormat,
  zodToJsonSchema,
} from "./responses";
export type {
  ContentPart,
  FunctionCallItem,
  FunctionCallOutputInput,
  FunctionToolDefinition,
  InputItem,
  JsonSchemaTextFormat,
  MessageInput,
  MetaResponse,
  OutputItem,
  ReasoningEffort,
  ReasoningItem,
  ResponseUsage,
  ResponsesCreateParams,
  TextFormatOptions,
  TokenUsage,
  ToolDefinition,
} from "./responses";

export { defineTool, runAgent } from "./agent";
export type { AgentResult, AgentTool, AggregatedUsage, CreateResponse, RunAgentParams, ToolCallTrace, ToolContext } from "./agent";

export { assertTranscribableWav, normalizeTranscription, readWavInfo, TRANSCRIBE_MAX_BYTES, TRANSCRIBE_MAX_MS } from "./transcribe";
export type { TranscribeMode, TranscribeOptions, TranscriptionResult, TranscriptTurn, WavInfo } from "./transcribe";

export { decodeMask, expandBox, maskToBox, parseMaskToken, parseSamOutput, pixelateRGBA } from "./sam";
export type { DecodedMask, ParsedMaskToken, PixelBox, SamBox, SamFrame, SamObject, SamParseResult } from "./sam";

export { readResponsesEvents, readSse } from "./sse";
export type { ResponsesStreamEvent, SseMessage } from "./sse";

export { base64ToBytes, buildMultipart, bytesToBase64, bytesToDataUrl, sniffImageMime } from "./bytes";
export type { BinaryInput, MultipartPart } from "./bytes";
