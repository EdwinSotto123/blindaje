import {
  LEAK_AUDIO_MAX_HAMMING,
  LEAK_TAG_MIN_DISTANCE,
  NOTA_RASTREO,
  type ConsoleRole,
  type EvidenceType,
  type LeakTraceCandidate,
  type LeakTraceKind,
  type LeakTraceResult,
  type MarcaCopia,
  type MotivoSinMarca,
} from "@blindaje/shared";
import type { Env } from "../env";
import { getDecrypted, putEncrypted } from "../lib/crypto";
import { isUniqueViolation } from "../lib/db";
import { ApiError } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { getMlClient, tryGetMlClient, type WatermarkEmbedResult } from "../ml/client";
import { matchAudio, matchImage, pickTag, randomHex } from "./match";

/**
 * Rastreo de filtraciones (PLAN D14).
 *
 * Marcado (GET /v1/console/evidence/:id/media): cada audio o imagen que sale de la consola lleva una
 * marca de agua invisible de quien la pidió.
 * - Audio: AudioSeal con la marca de 16 bits de la cuenta (`user_leak_tags`).
 * - Imagen: Video Seal con un mensaje aleatorio nuevo (nbits del contenedor) por entrega.
 * - Cada entrega queda en `watermark_issues`, y la copia marcada se guarda cifrada en R2 bajo el
 *   prefijo del caso (se borra con el caso) para no volver a marcar cada vez que se reproduce.
 * - Falla abierta: si el contenedor no responde a tiempo, se sirve la copia sin marca con
 *   `no_aplicada`, y la auditoría lo dice. Bloquear a quien revisa por una caída del ML sería peor
 *   (la revisión humana es obligatoria) y el acceso igual queda en la auditoría con su cuenta.
 * - Videos y textos: fuera de alcance (`tipo_no_soportado`).
 *
 * Rastreo (POST /v1/console/leaks/trace, admin): detecta la marca en la copia subida y la compara
 * con las cuentas (audio) o con las entregas (imagen). El archivo subido nunca se guarda.
 */

/** Cuánto espera la ruta de medios al contenedor antes de servir sin marca. */
export const MARK_TIMEOUT_MS = 20_000;
/** Más grande que esto no se marca en línea (se sirve sin marca y queda auditado). */
export const MAX_MARK_BYTES = 30 * 1024 * 1024;
/** Bits del mensaje de Video Seal si el contenedor todavía no lo informó (`x-watermark-nbits`). */
export const DEFAULT_IMAGE_NBITS = 256;
/** Entregas de imagen que se comparan en un rastreo (las más recientes). */
const MAX_IMAGE_ISSUES = 50_000;

let imageNbits = DEFAULT_IMAGE_NBITS;
let markTimeoutMs = MARK_TIMEOUT_MS;

/** Solo para pruebas: vuelve a los bits por defecto y fija la espera al contenedor (null = la de producción). */
export function resetLeaksForTests(timeoutMs: number | null = null): void {
  imageNbits = DEFAULT_IMAGE_NBITS;
  markTimeoutMs = timeoutMs ?? MARK_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Marca de audio de cada cuenta
// ---------------------------------------------------------------------------

export class TagSpaceExhaustedError extends ApiError {
  constructor(assigned: number) {
    super("internal", "No quedan marcas de audio libres para nuevas cuentas: hay que ampliar el esquema de marcas.", {
      details: { assigned, min_distance: LEAK_TAG_MIN_DISTANCE },
    });
    this.name = "TagSpaceExhaustedError";
  }
}

/** Distancia de Hamming de 16 bits en SQL (SQLite no tiene XOR ni popcount): a ^ b = (a | b) - (a & b). */
function hammingSql(column: string, param: string): string {
  const x = `((${column} | ${param}) - (${column} & ${param}))`;
  return Array.from({ length: 16 }, (_, i) => `((${x} >> ${i}) & 1)`).join(" + ");
}

const INSERT_TAG_SQL = `INSERT INTO user_leak_tags (user_id, audio_tag, created_at)
   SELECT ?2, ?1, ?3 WHERE NOT EXISTS (SELECT 1 FROM user_leak_tags WHERE (${hammingSql("audio_tag", "?1")}) < ?4)`;

/**
 * Inserta la marca solo si queda a distancia >= 5 de todas las de D1, en una sola sentencia (atómica:
 * dos cuentas nuevas a la vez nunca quedan demasiado cerca). false si otra marca está cerca.
 */
export async function insertTagIfFar(env: Env, userId: string, tag: number): Promise<boolean> {
  const res = await env.DB.prepare(INSERT_TAG_SQL).bind(tag, userId, nowIso(), LEAK_TAG_MIN_DISTANCE).run();
  return Boolean(res.meta.changes);
}

/**
 * Marca de audio de la cuenta: la existente o una nueva a distancia >= 5 de todas las demás. Lanza
 * `TagSpaceExhaustedError` si ya no hay espacio (nunca asigna una marca más cercana).
 */
export async function ensureUserTag(env: Env, userId: string, random?: () => number): Promise<number> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const mine = await env.DB.prepare("SELECT audio_tag FROM user_leak_tags WHERE user_id = ?").bind(userId).first<{ audio_tag: number }>();
    if (mine) return mine.audio_tag;
    const { results } = await env.DB.prepare("SELECT audio_tag FROM user_leak_tags").all<{ audio_tag: number }>();
    const tag = pickTag(
      results.map((r) => r.audio_tag),
      random,
    );
    if (tag === null) {
      log("error", "leak_tag_space_exhausted", { assigned: results.length });
      throw new TagSpaceExhaustedError(results.length);
    }
    try {
      if (await insertTagIfFar(env, userId, tag)) {
        log("info", "leak_tag_assigned", { assigned: results.length + 1 });
        return tag;
      }
      // Otra cuenta tomó una marca cercana en este instante: volver a elegir.
    } catch (err) {
      // La misma cuenta en otra petición (user_id) o la misma marca (audio_tag): volver a mirar.
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new ApiError("conflict", "No se pudo asignar la marca de audio de tu cuenta. Intenta de nuevo.");
}

// ---------------------------------------------------------------------------
// Marcado en la ruta de medios
// ---------------------------------------------------------------------------

export interface MarkCopyInput {
  ev: { id: string; case_id: string; tipo: EvidenceType };
  userId: string;
  /** Variante servida y rango, por ejemplo "wav_recortado:3200-9800" o "redactada". */
  variant: string;
  body: ArrayBuffer;
  contentType: string;
}

export interface MarkOutcome {
  marca: MarcaCopia;
  motivo: MotivoSinMarca | null;
  kind: LeakTraceKind | null;
  issue_id: string | null;
  /** "hit": la copia marcada salió de R2; "miss": se marcó ahora. */
  cache: "hit" | "miss" | null;
  model: string | null;
  ms: number;
  /** Nombre del error si el contenedor falló (para la auditoría; nunca el contenido). */
  error: string | null;
}

export interface MarkedCopy {
  body: ArrayBuffer;
  contentType: string;
  outcome: MarkOutcome;
}

const KIND_OF: Partial<Record<EvidenceType, LeakTraceKind>> = { audio: "audio", imagen: "imagen" };

function markedAad(issueId: string): string {
  return `marked:${issueId}`;
}

export function markedR2Key(caseId: string, issueId: string): string {
  return `cases/${caseId}/marked/${issueId}`;
}

interface IssueLookup {
  id: string;
  r2_key: string | null;
  model: string | null;
}

/**
 * Marca la copia para quien la pide. Nunca lanza: si no se pudo marcar, devuelve la copia original
 * con `no_aplicada` y el motivo.
 */
export async function markCopy(env: Env, input: MarkCopyInput): Promise<MarkedCopy> {
  const started = Date.now();
  const kind = KIND_OF[input.ev.tipo] ?? null;
  const unmarked = (motivo: MotivoSinMarca, error: string | null = null): MarkedCopy => ({
    body: input.body,
    contentType: input.contentType,
    outcome: { marca: "no_aplicada", motivo, kind, issue_id: null, cache: null, model: null, ms: Date.now() - started, error },
  });
  if (!kind) return unmarked("tipo_no_soportado");
  if (input.body.byteLength > MAX_MARK_BYTES) return unmarked("archivo_grande");
  const contentTypeOut = kind === "audio" ? "audio/wav" : "image/jpeg";

  try {
    // 1. Copia ya marcada para esta persona, esta evidencia y esta variante.
    const prev = await env.DB.prepare(
      `SELECT id, r2_key, model FROM watermark_issues WHERE evidence_id = ? AND user_id = ? AND variant = ? AND kind = ? AND r2_key IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(input.ev.id, input.userId, input.variant, kind)
      .first<IssueLookup>();
    if (prev?.r2_key) {
      const cached = await getDecrypted(env.EVIDENCE, prev.r2_key, env.EVIDENCE_ENCRYPTION_KEY, markedAad(prev.id)).catch(() => null);
      if (cached) {
        return {
          body: cached,
          contentType: contentTypeOut,
          outcome: { marca: "aplicada", motivo: null, kind, issue_id: prev.id, cache: "hit", model: prev.model, ms: Date.now() - started, error: null },
        };
      }
    }

    // 2. Marcar ahora, con tiempo acotado.
    const ml = tryGetMlClient(env);
    if (!ml) return unmarked("servicio_no_disponible", "not_configured");
    const signal = AbortSignal.timeout(markTimeoutMs);
    let res: WatermarkEmbedResult;
    let message: string;
    let nbits: number;
    if (kind === "audio") {
      let tag: number;
      try {
        tag = await ensureUserTag(env, input.userId);
      } catch (err) {
        if (err instanceof TagSpaceExhaustedError) return unmarked("marcas_agotadas", err.name);
        throw err;
      }
      res = await ml.watermarkAudioEmbed(input.body, tag, { signal });
      message = tag.toString(16).padStart(4, "0");
      nbits = 16;
    } else {
      const wanted = imageNbits;
      const hex = randomHex(wanted);
      res = await ml.watermarkImageEmbed(input.body, hex, { signal });
      nbits = res.nbits ?? wanted;
      // El contenedor dice cuántos bits lleva su modelo: es dato, no una constante.
      if (res.nbits && res.nbits !== imageNbits) imageNbits = res.nbits;
      const informed = res.message?.trim().toLowerCase();
      message = informed && /^[0-9a-f]+$/.test(informed) ? informed : hex;
      if (message.length * 4 !== nbits) log("warn", "watermark_nbits_mismatch", { sent_bits: wanted, nbits, message_bits: message.length * 4 });
    }
    if (!res.bytes.byteLength) throw new Error("copia_vacia");

    // 3. Registro de la entrega y copia cifrada para reproducirla de nuevo sin volver a marcar.
    const issueId = newId();
    const r2Key = markedR2Key(input.ev.case_id, issueId);
    let stored = true;
    try {
      await putEncrypted(env.EVIDENCE, r2Key, env.EVIDENCE_ENCRYPTION_KEY, res.bytes, markedAad(issueId), { issue_id: issueId, kind });
    } catch (err) {
      stored = false;
      log("warn", "watermark_cache_put_failed", { issue_id: issueId, ...errorFields(err) });
    }
    await env.DB.prepare(
      `INSERT INTO watermark_issues (id, evidence_id, user_id, kind, message, nbits, variant, model, r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(issueId, input.ev.id, input.userId, kind, message, nbits, input.variant, res.model, stored ? r2Key : null, nowIso())
      .run();
    return {
      body: res.bytes,
      contentType: kind === "audio" ? res.content_type || contentTypeOut : contentTypeOut,
      outcome: { marca: "aplicada", motivo: null, kind, issue_id: issueId, cache: "miss", model: res.model, ms: Date.now() - started, error: null },
    };
  } catch (err) {
    log("warn", "watermark_failed_open", { evidence_id: input.ev.id, kind, ms: Date.now() - started, ...errorFields(err) });
    // El contenedor rechazó el cuerpo por tamaño (413): no es una caída del servicio.
    const status = err instanceof ApiError ? (err.details as { status?: unknown } | undefined)?.status : undefined;
    return unmarked(status === 413 ? "archivo_grande" : "servicio_no_disponible", err instanceof Error ? err.name.slice(0, 60) : "error");
  }
}

// ---------------------------------------------------------------------------
// Rastreo
// ---------------------------------------------------------------------------

function startsWith(u8: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((b, i) => u8[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * Tipo de la copia subida: `kind` explícito, si no el content-type, si no los primeros bytes.
 * Videos: 400 (todavía no se marcan).
 */
export function detectLeakKind(declared: string | null | undefined, contentType: string | null | undefined, bytes: ArrayBuffer): LeakTraceKind {
  if (declared === "audio" || declared === "imagen") return declared;
  if (declared) throw new ApiError("bad_request", "kind debe ser audio o imagen");
  const ct = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (ct.startsWith("video/")) throw new ApiError("bad_request", "Los videos todavía no llevan marca: solo se rastrean audios e imágenes.");
  if (ct.startsWith("audio/")) return "audio";
  if (ct.startsWith("image/")) return "imagen";
  const u8 = new Uint8Array(bytes.slice(0, 16));
  const isRiff = startsWith(u8, ascii("RIFF"));
  if (isRiff && startsWith(u8, ascii("WAVE"), 8)) return "audio";
  if (isRiff && startsWith(u8, ascii("WEBP"), 8)) return "imagen";
  if (startsWith(u8, ascii("OggS")) || startsWith(u8, ascii("fLaC")) || startsWith(u8, ascii("ID3"))) return "audio";
  if (u8[0] === 0xff && ((u8[1] ?? 0) & 0xe0) === 0xe0 && u8[1] !== 0xd8) return "audio";
  if (startsWith(u8, [0xff, 0xd8, 0xff]) || startsWith(u8, [0x89, 0x50, 0x4e, 0x47]) || startsWith(u8, ascii("GIF8"))) return "imagen";
  if (startsWith(u8, ascii("ftyp"), 4)) {
    const brand = String.fromCharCode(...u8.slice(8, 12));
    if (/^(M4A |M4B )$/.test(brand)) return "audio";
    if (/^(heic|heix|mif1|avif)$/.test(brand)) return "imagen";
    throw new ApiError("bad_request", "Parece un video: solo se rastrean audios e imágenes. Si es un audio, indica kind=audio.");
  }
  throw new ApiError("bad_request", "No reconocemos el tipo de archivo. Indica kind=audio o kind=imagen.");
}

interface UserInfo {
  email: string | null;
  display_name: string | null;
  role: ConsoleRole | null;
}

function candidateBase(u: UserInfo, userId: string): Pick<LeakTraceCandidate, "user_id" | "email_or_name" | "display_name" | "role"> {
  return { user_id: userId, email_or_name: u.email ?? u.display_name ?? userId, display_name: u.display_name, role: u.role };
}

export interface TraceOutcome {
  result: LeakTraceResult;
  /** Para la auditoría. */
  audit: Record<string, unknown>;
}

/** Detecta la marca y la atribuye. Lanza 503 si el contenedor no está disponible (sin él no hay rastreo). */
export async function traceLeak(env: Env, bytes: ArrayBuffer, kind: LeakTraceKind): Promise<TraceOutcome> {
  const ml = getMlClient(env);
  if (kind === "audio") {
    const det = await ml.watermarkAudioDetect(bytes);
    const { results } = await env.DB.prepare(
      `SELECT t.user_id, t.audio_tag, u.email, u.display_name, u.role,
         (SELECT MAX(w.created_at) FROM watermark_issues w WHERE w.user_id = t.user_id AND w.kind = 'audio') AS last_audio
       FROM user_leak_tags t JOIN users u ON u.id = t.user_id`,
    ).all<{ user_id: string; audio_tag: number } & UserInfo & { last_audio: string | null }>();
    // Con 16 bits, una marca ajena (por ejemplo de un generador de voz) puede caer cerca de una cuenta
    // por azar: solo se atribuye si el detector dice que hay marca.
    const m = det.detected ? matchAudio(det.bits, results) : null;
    const candidates: LeakTraceCandidate[] = (m?.matches ?? []).map((x) => ({
      ...candidateBase(x, x.user_id),
      evidence_label: null,
      case_id: null,
      issued_at: x.last_audio,
      bit_accuracy: x.bit_accuracy,
    }));
    const ambiguo = m?.ambiguo ?? false;
    let nota: string;
    if (!det.detected) nota = "No se detectó una marca de Blindaje en este audio.";
    else if (!candidates.length)
      nota = `Se detectó una marca de AudioSeal, pero no coincide con ninguna cuenta (más de ${LEAK_AUDIO_MAX_HAMMING} bits de diferencia): puede venir de otro sistema o estar dañada.`;
    else if (ambiguo)
      nota = `Más de una cuenta podría explicar esta marca${m!.otras_posibles ? " si los bits dudosos se leen de otra forma" : ""}: no atribuyas la filtración sin más evidencia.`;
    else nota = "La marca de audio identifica la cuenta, no el archivo ni la hora: revisa en la auditoría qué audios escuchó esa cuenta.";
    return {
      result: { detected: det.detected, kind, score: det.score, candidates, ambiguo, nota: `${nota} ${NOTA_RASTREO}`, model: det.model },
      audit: {
        kind,
        detected: det.detected,
        score: det.score,
        model: det.model,
        candidates: candidates.map((c) => c.user_id),
        ambiguo,
        cuentas_comparadas: results.length,
      },
    };
  }

  const det = await ml.watermarkImageDetect(bytes);
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.user_id, w.evidence_id, w.message, w.created_at, u.email, u.display_name, u.role, e.label AS evidence_label, e.case_id
     FROM watermark_issues w JOIN users u ON u.id = w.user_id LEFT JOIN evidence e ON e.id = w.evidence_id
     WHERE w.kind = 'imagen' AND w.nbits = ? ORDER BY w.created_at DESC LIMIT ?`,
  )
    .bind(det.bits.length, MAX_IMAGE_ISSUES)
    .all<{ id: string; user_id: string; evidence_id: string; message: string; created_at: string; evidence_label: string | null; case_id: string | null } & UserInfo>();
  // Con 256 bits el azar no llega a 85 %: se compara aunque el detector no pase su umbral.
  const m = matchImage(det.bits, results);
  const candidates: LeakTraceCandidate[] = m.matches.map((x) => ({
    ...candidateBase(x, x.user_id),
    evidence_label: x.evidence_label,
    case_id: x.case_id,
    issued_at: x.created_at,
    bit_accuracy: Math.round(x.bit_accuracy * 10_000) / 10_000,
  }));
  let nota: string;
  if (!candidates.length) {
    nota = det.detected
      ? "Se detectó una marca de Video Seal, pero no coincide con ninguna entrega de la consola: puede venir de otro sistema o estar dañada."
      : "No se detectó una marca de Blindaje en esta imagen.";
  } else if (m.ambiguo) {
    nota = "Más de una entrega coincide de forma parecida: no atribuyas la filtración sin más evidencia.";
  } else {
    nota = "La marca coincide con una entrega de la consola: cuenta, evidencia y hora de la copia.";
  }
  return {
    result: { detected: det.detected, kind, score: det.score, candidates, ambiguo: m.ambiguo, nota: `${nota} ${NOTA_RASTREO}`, model: det.model },
    audit: {
      kind,
      detected: det.detected,
      score: det.score,
      model: det.model,
      nbits: det.bits.length,
      candidates: candidates.map((c) => c.user_id),
      issues: m.matches.map((x) => x.id),
      ambiguo: m.ambiguo,
      mejor_exactitud: m.mejor,
      entregas_comparadas: m.comparadas,
    },
  };
}
