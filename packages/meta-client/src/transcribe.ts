import { toUint8Array, type BinaryInput } from "./bytes";
import { MetaGuardError } from "./errors";

/**
 * Muse Voice Transcribe por archivo: `POST /v1/asr/transcribe` en multipart/form-data con las
 * partes `request` (JSON) y `audio` (WAV RIFF mono PCM16 a 16 o 24 kHz, máx. 32 MB y 10 min).
 */

export type TranscribeMode = "PUSH_TO_TALK" | "ENDPOINTING" | "DIARIZATION";

export interface TranscribeOptions {
  model?: string;
  /** Por defecto DIARIZATION (hablantes A, B…). */
  mode?: TranscribeMode;
  /** Idiomas esperados, por ejemplo ["Spanish"]. */
  languageBias?: string[];
  /** Vocabulario propio: Yape, Plin, cupo, derecho de piso… */
  keywords?: string[];
  /** Id de correlación para los logs del servidor; si falta, el servidor genera uno. */
  sessionId?: string;
}

export interface TranscriptTurn {
  turnId: number | null;
  speaker: string | null;
  startMs: number;
  endMs: number;
  transcript: string;
}

export interface TranscriptionResult {
  transcript: string;
  turns: TranscriptTurn[];
  audioDurationMs: number;
  sessionId: string | null;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  durationMs: number;
  dataBytes: number;
}

const ascii = (b: Uint8Array, offset: number, length: number) => String.fromCharCode(...b.subarray(offset, offset + length));

/** Lee el encabezado RIFF/WAVE. Devuelve null si no es un WAV. */
export function readWavInfo(input: BinaryInput): WavInfo | null {
  const b = toUint8Array(input);
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let offset = 12;
  let fmt: Omit<WavInfo, "durationMs" | "dataBytes"> | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= b.length) {
    const id = ascii(b, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 24 <= b.length) {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, b.length - offset - 8);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataBytes === null) return null;
  const bytesPerSecond = (fmt.sampleRate * fmt.channels * fmt.bitsPerSample) / 8;
  return { ...fmt, dataBytes, durationMs: bytesPerSecond > 0 ? Math.round((dataBytes / bytesPerSecond) * 1000) : 0 };
}

export const TRANSCRIBE_MAX_BYTES = 32 * 1024 * 1024;
export const TRANSCRIBE_MAX_MS = 10 * 60 * 1000;

/** Rechaza localmente lo que la API rechazaría con 400/413 (y que igual tardaría en subir). */
export function assertTranscribableWav(input: BinaryInput): WavInfo {
  const b = toUint8Array(input);
  if (b.byteLength > TRANSCRIBE_MAX_BYTES) {
    throw new MetaGuardError("invalid_input", `El audio pesa ${b.byteLength} bytes; el máximo es 32 MB`);
  }
  const info = readWavInfo(b);
  if (!info) throw new MetaGuardError("invalid_input", "El audio no es un WAV RIFF válido");
  if (info.audioFormat !== 1 || info.bitsPerSample !== 16 || info.channels !== 1 || ![16000, 24000].includes(info.sampleRate)) {
    throw new MetaGuardError(
      "invalid_input",
      `WAV no soportado (${info.channels} canal(es), ${info.bitsPerSample} bits, ${info.sampleRate} Hz, formato ${info.audioFormat}); ` +
        "convierte con: ffmpeg -i in -ac 1 -ar 24000 -c:a pcm_s16le -map_metadata -1 out.wav",
    );
  }
  if (info.durationMs > TRANSCRIBE_MAX_MS) {
    throw new MetaGuardError("invalid_input", `El audio dura ${Math.round(info.durationMs / 1000)} s; el máximo es 10 minutos`);
  }
  return info;
}

/** Normaliza la respuesta JSON de Voice Transcribe. */
export function normalizeTranscription(raw: unknown): TranscriptionResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const turns = Array.isArray(r.turns) ? r.turns : [];
  return {
    transcript: typeof r.transcript === "string" ? r.transcript : "",
    audioDurationMs: typeof r.audioDurationMs === "number" ? r.audioDurationMs : 0,
    sessionId: typeof r.sessionId === "string" ? r.sessionId : null,
    turns: turns.map((t) => {
      const turn = (t ?? {}) as Record<string, unknown>;
      return {
        turnId: typeof turn.turnId === "number" ? turn.turnId : null,
        speaker: typeof turn.speaker === "string" ? turn.speaker : null,
        startMs: typeof turn.startMs === "number" ? turn.startMs : 0,
        endMs: typeof turn.endMs === "number" ? turn.endMs : 0,
        transcript: typeof turn.transcript === "string" ? turn.transcript : "",
      };
    }),
  };
}
