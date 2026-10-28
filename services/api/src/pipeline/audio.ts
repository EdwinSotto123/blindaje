import type { TranscriptionResult, TranscriptTurn } from "@blindaje/meta-client";
import { TRANSCRIBE_KEYWORDS_BASE, voiceLabel } from "@blindaje/shared";
import type { Env } from "../env";
import { costCacheKey, withCostCache } from "../costs";
import { readDerivativePlain, readEvidencePlain } from "../evidence";
import { openString } from "../lib/crypto";
import { nextCounter, reserveCounter } from "../lib/db";
import { bytesToB64 } from "../lib/encoding";
import { ApiError } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { parseWav, wavDurationMs } from "../lib/wav";
import type { VoiceEmbedSpeaker } from "../ml/client";
import { requireMl, type EvidenceCtx } from "./context";
import { binaryDerivative, commitWrites, embeddingStatement, emptyWrites, jsonDerivative, previousOutputs } from "./store";
import type { TranscripcionContent, WavContent } from "./types";

/**
 * Audio (sección 7.2): ffmpeg en el contenedor → WAV mono de 16 kHz (derivado cifrado) → Voice
 * Transcribe con separación de hablantes y vocabulario propio → huella de voz por hablante, sin la
 * voz de la víctima (su muestra va como `exclude_vectors`) → `voice_prints` (V-n) y vectores en
 * `embeddings` (centroide en `voz`, segmentos en `voz_segmento`).
 */

export const TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";
/** Variante de la caché de transcripción. Cambiarla obliga a transcribir de nuevo. */
const TRANSCRIBE_VARIANT = "DIARIZATION:Spanish:v1";
const MAX_KEYWORDS = 40;

/** Vocabulario base + grupos que dicen ser en otros casos con consentimiento comunitario. */
export async function transcribeKeywords(env: Env, caseId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT json_extract(ficha_json, '$.grupo_que_dice_ser') AS g, MAX(updated_at) AS u FROM cases
     WHERE indexed = 1 AND id != ? AND ficha_json IS NOT NULL AND json_extract(ficha_json, '$.grupo_que_dice_ser') IS NOT NULL
     GROUP BY g ORDER BY u DESC LIMIT 20`,
  )
    .bind(caseId)
    .all<{ g: string }>();
  const out: string[] = [...TRANSCRIBE_KEYWORDS_BASE];
  const seen = new Set(out.map((k) => k.toLowerCase()));
  for (const r of results) {
    const g = String(r.g ?? "").trim();
    if (!g || g.length > 40 || seen.has(g.toLowerCase())) continue;
    seen.add(g.toLowerCase());
    out.push(g);
  }
  return out.slice(0, MAX_KEYWORDS);
}

/** Vector de la muestra de voz de la víctima (descifrado solo en memoria). */
export async function victimVoiceVector(env: Env, deviceId: string): Promise<number[] | null> {
  const row = await env.DB.prepare("SELECT vector_enc FROM victim_voice_samples WHERE device_id = ?").bind(deviceId).first<{ vector_enc: string }>();
  if (!row) return null;
  try {
    const v = JSON.parse(await openString(env.EVIDENCE_ENCRYPTION_KEY, row.vector_enc, `voice:${deviceId}`)) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "number") ? (v as number[]) : null;
  } catch (err) {
    log("error", "victim_voice_decrypt_failed", { device_id: deviceId, ...errorFields(err) });
    return null;
  }
}

type EmbedSegment = VoiceEmbedSpeaker["segments"][number] & { excluded?: boolean; victim_similarity?: number | null };

interface Span {
  start_ms: number;
  end_ms: number;
}

function overlap(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.end_ms, b.end_ms) - Math.max(a.start_ms, b.start_ms));
}

/**
 * Un turno es de la víctima si su hablante quedó excluido por la huella, o si al menos la mitad del
 * turno cae en segmentos excluidos (caso sin diarización, donde la víctima habla en el mismo audio).
 */
export function markVictimTurns(turns: TranscriptTurn[], speakers: VoiceEmbedSpeaker[]): TranscripcionContent["turns"] {
  const excludedSpeakers = new Set(speakers.filter((s) => s.excluded).map((s) => s.speaker));
  const excludedSpans: Span[] = speakers.flatMap((s) =>
    (s.segments as EmbedSegment[]).filter((g) => s.excluded || g.excluded).map((g) => ({ start_ms: g.start_ms, end_ms: g.end_ms })),
  );
  return turns.map((t) => {
    const span = { start_ms: t.startMs, end_ms: t.endMs };
    const dur = Math.max(1, t.endMs - t.startMs);
    const covered = excludedSpans.reduce((n, s) => n + overlap(span, s), 0);
    const esVictima = (t.speaker !== null && excludedSpeakers.has(t.speaker)) || covered >= dur * 0.5;
    return { speaker: t.speaker, start_ms: t.startMs, end_ms: t.endMs, text: t.transcript, es_victima: esVictima };
  });
}

export async function processAudio(ctx: EvidenceCtx): Promise<void> {
  const { env, ev, caso, meta } = ctx;
  const ml = requireMl(ctx);
  const w = emptyWrites();

  // 1. WAV normalizado (se reutiliza si una corrida anterior ya lo guardó).
  const prevWav = await env.DB.prepare("SELECT id, r2_key, content_json FROM derivatives WHERE evidence_id = ? AND tipo = 'wav' LIMIT 1")
    .bind(ev.id)
    .first<{ id: string; r2_key: string | null; content_json: string | null }>();
  let wav: ArrayBuffer | null = null;
  if (prevWav) wav = await readDerivativePlain(env, prevWav).catch(() => null);
  const keepWav = wav !== null;
  if (!wav) {
    const original = await readEvidencePlain(env, ev);
    if (!original) throw new ApiError("not_found", "No se encontró el archivo de la evidencia");
    const norm = await ml.normalizeAudio(original);
    wav = norm.wav;
    const info = parseWav(wav);
    const content: WavContent = {
      sample_rate: info?.sampleRate ?? 16000,
      channels: 1,
      bits_per_sample: 16,
      duration_ms: norm.duration_ms ?? (info ? wavDurationMs(info) : 0),
    };
    await binaryDerivative(env, w, ev, "wav", wav, content);
  }
  const info = parseWav(wav);
  const durationMs = info ? wavDurationMs(info) : null;

  // 2. Transcripción con hablantes (caché por SHA-256 del original: no se paga dos veces).
  const keywords = await transcribeKeywords(env, caso.id);
  const cacheKey = await costCacheKey(ev.sha256, "transcribe", TRANSCRIBE_VARIANT);
  const wavBytes = new Uint8Array(wav);
  const tr = await withCostCache<TranscriptionResult>(
    env,
    { cache_key: cacheKey, model: TRANSCRIBE_MODEL, operation: "transcribe", case_id: caso.id },
    () =>
      meta.transcribe(
        wavBytes,
        { mode: "DIARIZATION", languageBias: ["Spanish"], keywords },
        { operation: "transcribe", context: { case_id: caso.id, cache_key: cacheKey } },
      ),
  );
  let turns = tr.turns;
  if (!turns.length && tr.transcript.trim()) {
    turns = [{ turnId: null, speaker: null, startMs: 0, endMs: tr.audioDurationMs || durationMs || 0, transcript: tr.transcript }];
  }

  // 3. Huella de voz sin la víctima.
  const victim = await victimVoiceVector(env, caso.device_id);
  const diarized = turns.filter((t) => t.speaker && t.endMs > t.startMs).map((t) => ({ speaker: t.speaker!, start_ms: t.startMs, end_ms: t.endMs }));
  const emb = await ml.voiceEmbed({
    wav_b64: bytesToB64(wavBytes),
    turns: diarized.length ? diarized : null,
    exclude_vectors: victim ? [victim] : [],
  });
  const markedTurns = markVictimTurns(turns, emb.speakers);

  // 4. Huellas (V-n) y vectores. Los segmentos de la víctima nunca se guardan.
  const kept = emb.speakers
    .filter((s) => !s.excluded && Array.isArray(s.centroid) && s.centroid.length > 0)
    .map((s) => ({ s, segs: (s.segments as EmbedSegment[]).filter((g) => !g.excluded && Array.isArray(g.vector)) }))
    .filter((k) => k.segs.length > 0);
  const huellas: Record<string, string> = {};
  if (kept.length) {
    let nextFaiss = await reserveCounter(env, "faiss", kept.reduce((n, k) => n + 1 + k.segs.length, 0));
    for (const k of kept) {
      const num = await nextCounter(env, "voice");
      const printId = newId();
      const centroidId = nextFaiss++;
      const segRows = k.segs.map((g, i) => ({ i, faiss_id: nextFaiss++, start_ms: g.start_ms, end_ms: g.end_ms, vector: g.vector }));
      w.statements.push(
        env.DB.prepare(
          `INSERT INTO voice_prints (id, num, case_id, evidence_id, speaker, faiss_id, segmentos, duracion_seg, segments_json, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          printId,
          num,
          caso.id,
          ev.id,
          k.s.speaker,
          centroidId,
          segRows.length,
          k.s.duration_sec,
          JSON.stringify(segRows.map((r) => ({ start_ms: r.start_ms, end_ms: r.end_ms, faiss_id: r.faiss_id }))),
          emb.model,
          nowIso(),
        ),
      );
      w.statements.push(
        embeddingStatement(env, { faiss_id: centroidId, index_name: "voz", case_id: caso.id, ref_type: "voice_print", ref_id: printId, vector: k.s.centroid, model: emb.model }),
      );
      for (const r of segRows) {
        w.statements.push(
          embeddingStatement(env, {
            faiss_id: r.faiss_id,
            index_name: "voz_segmento",
            case_id: caso.id,
            ref_type: "voice_segment",
            ref_id: `${printId}:${r.i}`,
            vector: r.vector,
            model: emb.model,
          }),
        );
      }
      huellas[k.s.speaker] = voiceLabel(num);
    }
  }

  const victimaSeparada = markedTurns.some((t) => t.es_victima);
  const content: TranscripcionContent = {
    model: TRANSCRIBE_MODEL,
    turns: markedTurns,
    huellas,
    nota: victimaSeparada ? "Separamos tu voz de la voz de quien te habla" : null,
  };
  jsonDerivative(env, w, ev, "transcripcion", content);
  if (durationMs != null) {
    w.statements.push(env.DB.prepare("UPDATE evidence SET duration_ms = COALESCE(duration_ms, ?) WHERE id = ?").bind(durationMs, ev.id));
  }

  const prev = await previousOutputs(env, ev.id, keepWav ? ["wav"] : []);
  await commitWrites(env, prev, w);
  log("info", "audio_processed", {
    evidence_id: ev.id,
    turns: markedTurns.length,
    huellas: Object.keys(huellas).length,
    excluded_speakers: emb.speakers.filter((s) => s.excluded).length,
    victim_sample: Boolean(victim),
  });
}
