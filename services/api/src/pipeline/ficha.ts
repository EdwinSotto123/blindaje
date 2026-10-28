import {
  FICHA_SYSTEM,
  FichaExtraction,
  FichaStored,
  PROMPT_VERSION,
  Sector,
  delimitarEvidencia,
  esInyeccion,
  hmacIdentifier,
  identifierLabel,
  importAllianceKey,
  lastThree,
  type IdentificadorExtraido,
  type IdentificadorRef,
  type IdentifierRole,
  type IdentifierType,
} from "@blindaje/shared";
import type { Env } from "../env";
import { metaClientFor, runCheckedAgent } from "../agents/common";
import { identifiersAad } from "../cases";
import { costCacheKey, withCostCache } from "../costs";
import type { EvidenceRow } from "../evidence";
import { openString, sealString, sha256Hex } from "../lib/crypto";
import { nextCounter, parseJsonColumn } from "../lib/db";
import { nowIso } from "../lib/ids";
import { errorFields, log } from "../lib/log";
import { tryGetMlClient } from "../ml/client";
import { embeddingStatement } from "./store";
import { normalizeIdentifierStrict, sanitizeFichaText } from "./privacy";
import { ensureScreened } from "./promptguard";
import { readEvidenceText } from "./text";
import type { CaseIdentifiersPlain, FramesContent, LecturaContent, SegmentacionContent, TranscripcionContent } from "./types";

/**
 * Ficha del caso (sección 7.3) e identificadores cifrados (7.5).
 *
 * Entrada de Muse Spark: las piezas etiquetadas (EV-…) del caso, con el mismo formato que usa la
 * evaluación (`eval/src/ficha-input.ts`): transcripciones SIN los turnos de la víctima, mensajes,
 * lecturas de imagen y video, y el relato. Salida: `FichaExtraction` strict con reasoning "low".
 * Validación de citas y registro en `agent_runs` (agente "ficha").
 *
 * Inyección de instrucciones (PLAN D15): el contenido de cada pieza va delimitado como dato
 * (<<<EVIDENCIA …>>> … <<<FIN …>>>) y, si Llama Prompt Guard 2 lo marcó, con un aviso delante. Antes
 * de armar la ficha se revisa en un lote lo que quedó sin revisar; si el clasificador no está, la
 * ficha se arma igual (todo delimitado, sin avisos).
 */

export const FICHA_MODEL = "muse-spark-1.3";
const FICHA_EFFORT = "low" as const;

/**
 * Pieza de evidencia para la ficha. Mismo formato que `eval/src/ficha-input.ts` (con el que la
 * evaluación midió la exactitud de la ficha): etiqueta, tipo, hora de recepción en Lima y número de
 * origen si se conoce. Los videos van como "Lectura de imagen" (es la lectura de un cuadro).
 */
export interface PiezaFicha {
  label: string;
  tipo: "audio" | "texto" | "imagen" | "relato";
  recibido: string | null;
  origen: string | null;
  contenido: string;
  /** Id de la evidencia (para el resultado de Prompt Guard). */
  evidence_id?: string;
  /** Llama Prompt Guard 2 marcó la pieza como posible inyección de instrucciones. */
  marcada?: boolean;
  score?: number | null;
}

const TIPO_PIEZA: Record<PiezaFicha["tipo"], string> = {
  audio: "Transcripción de audio",
  texto: "Mensaje de texto",
  imagen: "Lectura de imagen",
  relato: "Relato de la persona afectada",
};

/** ISO 8601 en hora de Lima (UTC−5, sin horario de verano). */
export function limaIso(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return `${new Date(t - 5 * 3600_000).toISOString().slice(0, 16)}-05:00`;
}

/**
 * Como `buildFichaInput` de la evaluación (cambia la frase de contenido ficticio), con el contenido
 * de cada pieza delimitado como dato y el aviso de Prompt Guard delante de las piezas marcadas.
 */
export function buildFichaInput(caso: string, demo: boolean, piezas: PiezaFicha[]): string {
  const bloques = piezas.map((p) => {
    const meta: string[] = [];
    if (p.recibido) meta.push(`recibido ${p.recibido}`);
    if (p.origen) meta.push(`enviado desde ${p.origen}`);
    const head = `[${p.label}] ${TIPO_PIEZA[p.tipo]}${meta.length ? ` (${meta.join(", ")})` : ""}:`;
    return `${head}\n${delimitarEvidencia(p.label, p.contenido, { marcada: p.marcada, score: p.score ?? null })}`;
  });
  return [`Caso ${caso}.${demo ? " Contenido ficticio de demostración." : ""}`, `Evidencia (${piezas.length} piezas):`, "", bloques.join("\n\n")].join("\n");
}

interface DerivativeRow {
  evidence_id: string;
  tipo: string;
  content_json: string | null;
}

export interface CasePieces {
  piezas: PiezaFicha[];
  /** Filas de la evidencia del caso (para revisar con Prompt Guard lo que falte). */
  evidence: EvidenceRow[];
  labels: Set<string>;
  placas: Array<{ valor: string; label: string }>;
  /** Dígitos de los números que dijo la víctima (turnos `es_victima`): nunca pasan a identificadores. */
  victimNumbers: Set<string>;
}

const DIGIT_RUN = /\d[\d\s.-]{6,}\d/g;

function digitRuns(text: string): string[] {
  return (text.match(DIGIT_RUN) ?? []).map((m) => m.replace(/\D/g, "")).filter((d) => d.length >= 7);
}

/** Arma las piezas del caso. Los turnos marcados `es_victima` nunca salen de aquí. */
export async function collectPieces(env: Env, caseId: string): Promise<CasePieces> {
  const [evRes, derRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM evidence WHERE case_id = ? ORDER BY seq").bind(caseId),
    env.DB.prepare(
      "SELECT evidence_id, tipo, content_json FROM derivatives WHERE case_id = ? AND tipo IN ('transcripcion','lectura','segmentacion','frames')",
    ).bind(caseId),
  ]);
  const evidence = evRes!.results as unknown as EvidenceRow[];
  const ders = derRes!.results as unknown as DerivativeRow[];
  const of = <T>(evId: string, tipo: string) => parseJsonColumn<T>(ders.find((d) => d.evidence_id === evId && d.tipo === tipo)?.content_json);

  const piezas: PiezaFicha[] = [];
  const placas: CasePieces["placas"] = [];
  const victimNumbers = new Set<string>();
  const labels = new Set(evidence.map((e) => e.label));
  for (const e of evidence) {
    const recibido = limaIso(e.captured_at ?? e.received_utc);
    if (e.tipo === "audio") {
      const tr = of<TranscripcionContent>(e.id, "transcripcion");
      for (const t of tr?.turns ?? []) if (t.es_victima) for (const d of digitRuns(t.text)) victimNumbers.add(d.slice(-9));
      const lines = (tr?.turns ?? [])
        .filter((t) => !t.es_victima && t.text.trim())
        .map((t) => `Hablante ${t.speaker ?? "?"}: ${t.text.trim()}`);
      if (lines.length) piezas.push({ label: e.label, tipo: "audio", recibido, origen: null, contenido: lines.join("\n"), evidence_id: e.id });
    } else if (e.tipo === "texto") {
      const text = await readEvidenceText(env, e);
      if (text?.trim()) piezas.push({ label: e.label, tipo: e.source === "relato" ? "relato" : "texto", recibido, origen: null, contenido: text, evidence_id: e.id });
    } else {
      const lines: string[] = [];
      const seg = of<SegmentacionContent>(e.id, "segmentacion");
      const objetos = [...new Set((seg?.objetos ?? []).map((o) => o.concepto).filter((c) => c !== "rostro" && c !== "niño"))];
      if (objetos.length) lines.push(`Objetos detectados: ${objetos.join(", ")}.`);
      const frames = of<FramesContent>(e.id, "frames");
      if (frames?.placa) lines.push("Se ve una placa de vehículo.");
      const lectura = of<LecturaContent>(e.id, "lectura");
      if (lectura?.texto) lines.push(`Texto escrito: «${lectura.texto}».`);
      for (const p of lectura?.placas ?? []) {
        lines.push(`Placa de vehículo: ${p}.`);
        placas.push({ valor: p, label: e.label });
      }
      if (lines.length) piezas.push({ label: e.label, tipo: "imagen", recibido, origen: null, contenido: lines.join("\n"), evidence_id: e.id });
    }
  }
  return { piezas, evidence, labels, placas, victimNumbers };
}

/** Marca las piezas que Llama Prompt Guard 2 señaló (revisa antes, en un lote, lo que faltaba). */
export async function annotatePieces(env: Env, caseId: string, pieces: Pick<CasePieces, "piezas" | "evidence">): Promise<PiezaFicha[]> {
  const ids = new Set(pieces.piezas.map((p) => p.evidence_id).filter(Boolean));
  const guard = await ensureScreened(
    env,
    caseId,
    pieces.evidence.filter((e) => ids.has(e.id)),
  );
  return pieces.piezas.map((p) => {
    const r = p.evidence_id ? guard.get(p.evidence_id) : undefined;
    return esInyeccion(r) ? { ...p, marcada: true, score: r?.score ?? null } : p;
  });
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function allianceKey(env: Env): Promise<CryptoKey> {
  let k = keyCache.get(env.HMAC_ALLIANCE_KEY);
  if (!k) {
    k = importAllianceKey(env.HMAC_ALLIANCE_KEY);
    keyCache.set(env.HMAC_ALLIANCE_KEY, k);
  }
  return k;
}

interface ResolvedIdentifier {
  tipo: IdentifierType;
  rol: IdentifierRole;
  valor: string;
  normalizado: string;
  hmac: string;
  evidencia: string[];
}

/** Normaliza (estricto), aplica HMAC y une duplicados (mismo HMAC y rol). */
export async function resolveIdentifiers(env: Env, ids: Array<Pick<IdentificadorExtraido, "tipo" | "valor" | "rol" | "evidencia">>): Promise<ResolvedIdentifier[]> {
  const key = await allianceKey(env);
  const out: ResolvedIdentifier[] = [];
  for (const i of ids) {
    const normalizado = normalizeIdentifierStrict(i.tipo, i.valor);
    if (!normalizado) continue;
    const hmac = await hmacIdentifier(key, i.tipo, normalizado);
    const dup = out.find((o) => o.hmac === hmac && o.rol === i.rol);
    if (dup) {
      dup.evidencia = [...new Set([...dup.evidencia, ...i.evidencia])];
      continue;
    }
    out.push({ tipo: i.tipo, rol: i.rol, valor: i.valor.trim(), normalizado, hmac, evidencia: [...new Set(i.evidencia)] });
  }
  return out;
}

interface CaseRowLite {
  id: string;
  code: string;
  sector: string | null;
  zona_cuadricula: string | null;
  is_demo: number;
  consent_mode: string;
  indexed: number;
}

/**
 * Consolida la ficha con Muse Spark. Devuelve null si el caso todavía no tiene piezas legibles.
 * Efectos: `cases.identifiers_enc` (valores en claro, cifrados, solo para la denuncia de la víctima)
 * y el vector del `resumen_mo` en `embeddings` (`texto`). Los HMAC van en el paso `identificadores`.
 */
export async function buildFicha(env: Env, caseId: string): Promise<FichaStored | null> {
  const c = await env.DB.prepare("SELECT id, code, sector, zona_cuadricula, is_demo, consent_mode, indexed FROM cases WHERE id = ?")
    .bind(caseId)
    .first<CaseRowLite>();
  if (!c) return null;
  const collected = await collectPieces(env, caseId);
  const { labels, placas, victimNumbers } = collected;
  if (!collected.piezas.length) return null;
  const piezas = await annotatePieces(env, caseId, collected);
  const input = buildFichaInput(c.code, c.is_demo === 1, piezas);

  const meta = metaClientFor(env, { case_id: caseId });
  const run = await runCheckedAgent<FichaExtraction>(env, {
    agent: "ficha",
    model: FICHA_MODEL,
    target_type: "case",
    target_id: caseId,
    known: labels,
    attempt: async (feedback) => {
      const text = feedback ? `${input}\n\n${feedback}` : input;
      const cacheKey = await costCacheKey(await sha256Hex(text), "ficha", `${FICHA_MODEL}:${FICHA_EFFORT}:${PROMPT_VERSION}`);
      const r = await withCostCache(env, { cache_key: cacheKey, model: FICHA_MODEL, operation: "ficha", case_id: caseId }, async () => {
        const p = await meta.responses.parse(
          {
            model: FICHA_MODEL,
            instructions: FICHA_SYSTEM,
            input: [{ role: "user", content: text }],
            schema: FichaExtraction,
            schemaName: "ficha",
            reasoningEffort: FICHA_EFFORT,
            store: false,
          },
          { operation: "ficha", context: { case_id: caseId, cache_key: cacheKey } },
        );
        return { output: p.output, cost_usd: p.costUsd };
      });
      return { output: r.output, cost_usd: r.cost_usd, tool_calls: 0 };
    },
  });

  const clean = sanitizeFichaText(run.output, labels);
  const extracted = [
    ...clean.identificadores,
    ...placas
      .filter((p) => !clean.identificadores.some((i) => i.tipo === "placa" && normalizeIdentifierStrict("placa", i.valor) === normalizeIdentifierStrict("placa", p.valor)))
      .map((p) => ({ tipo: "placa" as const, valor: p.valor, rol: "vehiculo" as const, evidencia: [p.label] })),
  ];
  const resolved = (await resolveIdentifiers(env, extracted)).filter((r) => !victimNumbers.has(r.normalizado.replace(/\D/g, "").slice(-9)));
  const refs: IdentificadorRef[] = resolved.map((r) => ({
    ref: identifierLabel(r.hmac),
    tipo: r.tipo,
    rol: r.rol,
    ultimos_3: lastThree(r.normalizado),
    evidencia: r.evidencia,
  }));
  const { identificadores: _omit, ...rest } = clean;
  const sector = rest.sector ?? (Sector.safeParse(c.sector).success ? (c.sector as Sector) : null);
  const stored = FichaStored.parse({ ...rest, sector, caso: c.code, zona: c.zona_cuadricula, identificadores: refs });

  const plain: CaseIdentifiersPlain = {
    identificadores: resolved.map((r) => ({ tipo: r.tipo, valor: r.valor, normalizado: r.normalizado, rol: r.rol, evidencia: r.evidencia })),
  };
  const enc = await sealString(env.EVIDENCE_ENCRYPTION_KEY, JSON.stringify(plain), identifiersAad(caseId));
  await env.DB.prepare("UPDATE cases SET identifiers_enc = ?, primer_contacto = COALESCE(primer_contacto, ?), updated_at = ? WHERE id = ?")
    .bind(enc, stored.primer_contacto, nowIso(), caseId)
    .run();
  await ensureTextEmbedding(env, caseId, stored.resumen_mo, { force: true });
  log("info", "ficha_built", {
    case_id: caseId,
    piezas: piezas.length,
    piezas_marcadas: piezas.filter((p) => p.marcada).length,
    identificadores: refs.length,
    citas_ok: run.status === "ok",
  });
  return stored;
}

/**
 * Vector del `resumen_mo` (ML `/text/embed`, kind passage) en `embeddings` (`texto`). Mejor
 * esfuerzo: sin contenedor, el caso sigue sin la señal de texto y se reintenta al indexar.
 */
export async function ensureTextEmbedding(env: Env, caseId: string, resumen: string | null, opts: { force?: boolean } = {}): Promise<boolean> {
  const ml = tryGetMlClient(env);
  if (!ml) return false;
  const prev = await env.DB.prepare("SELECT faiss_id FROM embeddings WHERE case_id = ? AND index_name = 'texto' AND ref_type = 'ficha'")
    .bind(caseId)
    .all<{ faiss_id: number }>();
  if (prev.results.length && !opts.force) return true;
  let text = resumen;
  if (text == null) {
    const row = await env.DB.prepare("SELECT ficha_json FROM cases WHERE id = ?").bind(caseId).first<{ ficha_json: string | null }>();
    text = parseJsonColumn<FichaStored>(row?.ficha_json)?.resumen_mo ?? null;
  }
  if (!text?.trim()) return false;
  try {
    const { model, vectors } = await ml.textEmbed([text], "passage");
    const vector = vectors[0];
    if (!vector?.length) return false;
    const faissId = await nextCounter(env, "faiss");
    const oldIds = prev.results.map((r) => r.faiss_id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM embeddings WHERE case_id = ? AND index_name = 'texto' AND ref_type = 'ficha'").bind(caseId),
      embeddingStatement(env, { faiss_id: faissId, index_name: "texto", case_id: caseId, ref_type: "ficha", ref_id: caseId, vector, model }),
    ]);
    if (oldIds.length) await ml.indexRemove("texto", oldIds).catch(() => undefined);
    return true;
  } catch (err) {
    log("warn", "text_embedding_failed", { case_id: caseId, ...errorFields(err) });
    return false;
  }
}

/**
 * Identificadores (sección 7.5): HMAC-SHA256 con la clave de la alianza → `identifiers` y
 * `case_identifiers`. `indexed = 1` solo si el caso tiene consentimiento comunitario.
 */
export async function storeIdentifiers(env: Env, caseId: string): Promise<{ count: number; stub: boolean }> {
  const c = await env.DB.prepare("SELECT identifiers_enc, consent_mode FROM cases WHERE id = ?")
    .bind(caseId)
    .first<{ identifiers_enc: string | null; consent_mode: string }>();
  if (!c) return { count: 0, stub: false };
  let plain: CaseIdentifiersPlain = { identificadores: [] };
  if (c.identifiers_enc) {
    plain = JSON.parse(await openString(env.EVIDENCE_ENCRYPTION_KEY, c.identifiers_enc, identifiersAad(caseId))) as CaseIdentifiersPlain;
  }
  const resolved = await resolveIdentifiers(
    env,
    plain.identificadores.map((i) => ({
      tipo: i.tipo as IdentifierType,
      valor: i.normalizado ?? i.valor,
      rol: (i.rol ?? "contacto") as IdentifierRole,
      evidencia: i.evidencia ?? [],
    })),
  );
  const indexed = c.consent_mode === "comunitario" ? 1 : 0;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM case_identifiers WHERE case_id = ?").bind(caseId),
    ...resolved.flatMap((r) => [
      env.DB.prepare("INSERT OR IGNORE INTO identifiers (hmac, ref, tipo, ultimos_3, first_seen) VALUES (?, ?, ?, ?, ?)").bind(
        r.hmac,
        identifierLabel(r.hmac),
        r.tipo,
        lastThree(r.normalizado),
        now,
      ),
      env.DB.prepare(
        "INSERT OR REPLACE INTO case_identifiers (case_id, hmac, rol, evidence_json, indexed, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(caseId, r.hmac, r.rol, JSON.stringify(r.evidencia), indexed, now),
    ]),
    env.DB.prepare("DELETE FROM identifiers WHERE hmac NOT IN (SELECT hmac FROM case_identifiers)"),
  ]);
  return { count: resolved.length, stub: false };
}
