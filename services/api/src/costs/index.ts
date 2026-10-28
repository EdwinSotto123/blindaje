import type { CostsResponse } from "@blindaje/shared";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { getDecrypted, putEncrypted, sha256Hex } from "../lib/crypto";
import { fromUtf8, utf8 } from "../lib/encoding";
import { newId, nowIso } from "../lib/ids";
import { log } from "../lib/log";

/**
 * Registro de costos y presupuesto de la Meta Model API.
 *
 * Reglas:
 * - Cada llamada (o intento bloqueado, o acierto de caché) queda en `api_costs`.
 * - Con el gasto en >= 80 % de META_BUDGET_USD se bloquean las llamadas no esenciales
 *   (Muse Wonder, Muse Image): se registra `status: 'blocked'` y se lanza `budget_exceeded`.
 * - Con el gasto en >= 100 % se bloquea todo: el crédito del equipo es el límite real.
 * - Caché por `cache_key` = SHA-256(sha256_del_archivo:operación:variante). Los resultados se
 *   guardan cifrados en R2 (`cache/<key>`), porque pueden contener transcripciones.
 *
 * El cliente de Meta (packages/meta-client) se conecta con `createMetaHooks(env)`, que devuelve
 * `{ beforeCall, onUsage }`.
 */

export const NONESSENTIAL_THRESHOLD = 0.8;

export type CostStatus = "ok" | "error" | "blocked" | "cached";

/** Operaciones conocidas (columna `operation`). Se aceptan otras cadenas. */
export type CostOperation =
  | "ficha"
  | "transcribe"
  | "sam_image"
  | "sam_video"
  | "lectura"
  | "vinculador"
  | "cartografo"
  | "vigia"
  | "redactor"
  | "image"
  | (string & {});

export interface CostUnits {
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  images?: number;
  frames?: number;
  audio_seconds?: number;
}

export interface CostRecord {
  model: string;
  operation: CostOperation;
  units?: CostUnits;
  cost_usd: number;
  essential: boolean;
  status: CostStatus;
  case_id?: string | null;
  cache_key?: string | null;
  request_id?: string | null;
}

// ---------------------------------------------------------------------------
// Precios (DEVLOG.md, verificados el 28/10) y clasificación
// ---------------------------------------------------------------------------

interface TokenPrice {
  in: number;
  out: number;
  cached: number;
}
const PER_M = 1_000_000;
const TOKEN_PRICES: Record<string, TokenPrice> = {
  "muse-spark-1.3": { in: 1.25, out: 4.25, cached: 0.15 },
  "muse-spark-1.2": { in: 1.25, out: 4.25, cached: 0.15 },
  "muse-wonder-1.0": { in: 4, out: 20, cached: 4 },
};
const SAM_PER_IMAGE = 2.5 / 1000;
const SAM_PER_FRAME = 0.2 / 1000;
const SAM_MIN_FRAMES = 50;
const TRANSCRIBE_PER_SECOND = 0.18 / 3600;
const IMAGE_PER_IMAGE = 0.01;

/** Muse Wonder y Muse Image son no esenciales: el sistema funciona sin ellos. */
export function isEssentialModel(model: string): boolean {
  return model !== "muse-wonder-1.0" && model !== "muse-image-1.0";
}

export function estimateCostUsd(model: string, units: CostUnits = {}): number {
  const tp = TOKEN_PRICES[model];
  if (tp) {
    const cached = units.cached_tokens ?? 0;
    const input = Math.max(0, (units.input_tokens ?? 0) - cached);
    return (input * tp.in + cached * tp.cached + (units.output_tokens ?? 0) * tp.out) / PER_M;
  }
  switch (model) {
    case "sam-3.1": {
      const frames = units.frames ? Math.max(units.frames, SAM_MIN_FRAMES) : 0;
      return (units.images ?? 0) * SAM_PER_IMAGE + frames * SAM_PER_FRAME;
    }
    case "muse-voice-transcribe-1.0":
      return (units.audio_seconds ?? 0) * TRANSCRIBE_PER_SECOND;
    case "muse-image-1.0":
      return (units.images ?? 0) * IMAGE_PER_IMAGE;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export async function recordCost(env: Env, rec: CostRecord): Promise<void> {
  if (rec.model.endsWith("-contributor")) {
    // Nunca deberíamos llegar aquí: contributor mode está prohibido para datos de la app.
    log("error", "contributor_model_rejected", { model: rec.model });
    throw new ApiError("forbidden", "Modelo no permitido");
  }
  const u = rec.units ?? {};
  await env.DB.prepare(
    `INSERT INTO api_costs (id, ts, model, operation, input_tokens, output_tokens, cached_tokens, images, frames,
       audio_seconds, cost_usd, essential, status, case_id, request_id, cache_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId(),
      nowIso(),
      rec.model,
      rec.operation,
      Math.round(u.input_tokens ?? 0),
      Math.round(u.output_tokens ?? 0),
      Math.round(u.cached_tokens ?? 0),
      Math.round(u.images ?? 0),
      Math.round(u.frames ?? 0),
      u.audio_seconds ?? 0,
      Number.isFinite(rec.cost_usd) ? rec.cost_usd : 0,
      rec.essential ? 1 : 0,
      rec.status,
      rec.case_id ?? null,
      rec.request_id ?? null,
      rec.cache_key ?? null,
    )
    .run();
  log("info", "meta_cost", {
    model: rec.model,
    operation: rec.operation,
    status: rec.status,
    cost_usd: rec.cost_usd,
    essential: rec.essential,
  });
}

export interface BudgetStatus {
  total_usd: number;
  budget_usd: number;
  pct: number;
  nonessential_blocked: boolean;
  all_blocked: boolean;
}

export function budgetUsd(env: Env): number {
  const v = Number(env.META_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 150;
}

export async function budgetStatus(env: Env): Promise<BudgetStatus> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM api_costs").first<{ total: number }>();
  const total = row?.total ?? 0;
  const budget = budgetUsd(env);
  const pct = total / budget;
  return {
    total_usd: total,
    budget_usd: budget,
    pct,
    nonessential_blocked: pct >= NONESSENTIAL_THRESHOLD,
    all_blocked: pct >= 1,
  };
}

export interface BudgetGuardContext {
  essential: boolean;
  model?: string;
  operation?: CostOperation;
  case_id?: string | null;
  cache_key?: string | null;
}

/**
 * Llamar antes de cada llamada a Meta. Si el presupuesto no lo permite, registra la llamada como
 * `blocked` (salvo `record: false`, cuando el que llama registra el bloqueo por su cuenta) y lanza
 * ApiError("budget_exceeded").
 */
export async function budgetGuard(env: Env, ctx: BudgetGuardContext, opts: { record?: boolean } = {}): Promise<void> {
  const st = await budgetStatus(env);
  const blocked = st.all_blocked || (!ctx.essential && st.nonessential_blocked);
  if (!blocked) return;
  if (opts.record !== false) await recordCost(env, {
    model: ctx.model ?? "desconocido",
    operation: ctx.operation ?? "desconocida",
    cost_usd: 0,
    essential: ctx.essential,
    status: "blocked",
    case_id: ctx.case_id ?? null,
    cache_key: ctx.cache_key ?? null,
  });
  throw new ApiError(
    "budget_exceeded",
    st.all_blocked
      ? "Se alcanzó el presupuesto de la Meta Model API"
      : "Presupuesto al 80 %: las llamadas no esenciales están bloqueadas",
    { details: { pct: Math.round(st.pct * 1000) / 10, essential: ctx.essential } },
  );
}

// ---------------------------------------------------------------------------
// Caché por hash
// ---------------------------------------------------------------------------

export function costCacheKey(fileSha256: string, operation: CostOperation, variant = ""): Promise<string> {
  return sha256Hex(`${fileSha256}:${operation}:${variant}`);
}

function cacheR2Key(key: string): string {
  return `cache/${key}`;
}

export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  try {
    const plain = await getDecrypted(env.EVIDENCE, cacheR2Key(key), env.EVIDENCE_ENCRYPTION_KEY, `cache:${key}`);
    return plain ? (JSON.parse(fromUtf8(plain)) as T) : null;
  } catch (err) {
    log("warn", "cost_cache_unreadable", { cache_key: key, error_name: (err as Error).name });
    return null;
  }
}

export async function cachePut(env: Env, key: string, value: unknown): Promise<void> {
  await putEncrypted(env.EVIDENCE, cacheR2Key(key), env.EVIDENCE_ENCRYPTION_KEY, utf8(JSON.stringify(value)), `cache:${key}`);
}

/**
 * Envuelve una llamada cara con caché: si hay resultado guardado lo devuelve y registra
 * `status: 'cached'`; si no, ejecuta `fn` y guarda el resultado.
 */
export async function withCostCache<T>(
  env: Env,
  opts: { cache_key: string; model: string; operation: CostOperation; case_id?: string | null; essential?: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(env, opts.cache_key);
  if (hit !== null) {
    await recordCost(env, {
      model: opts.model,
      operation: opts.operation,
      cost_usd: 0,
      essential: opts.essential ?? isEssentialModel(opts.model),
      status: "cached",
      case_id: opts.case_id ?? null,
      cache_key: opts.cache_key,
    });
    return hit;
  }
  const value = await fn();
  await cachePut(env, opts.cache_key, value);
  return value;
}

// ---------------------------------------------------------------------------
// Hooks para packages/meta-client
// ---------------------------------------------------------------------------

/**
 * Forma de `CallInfo` de @blindaje/meta-client (compatible estructuralmente; el test
 * meta-hooks.test.ts lo comprueba contra el paquete). `case_id` y `cache_key` viajan en `context`.
 */
export interface MetaCallInfo {
  model: string;
  operation: CostOperation;
  /** Por defecto: isEssentialModel(model). */
  essential?: boolean;
  context?: Record<string, unknown>;
}

/** Forma de `UsageEvent` de @blindaje/meta-client: llega después de cada llamada (ok, error o bloqueada). */
export interface MetaUsageInfo extends MetaCallInfo {
  status: "ok" | "error" | "blocked";
  units?: CostUnits & { reasoning_tokens?: number };
  /** Si el cliente no lo calcula, se estima con la tabla de precios. */
  cost_usd?: number;
  request_id?: string | null;
  response_id?: string | null;
  duration_ms?: number;
  error?: { name: string; message: string; status?: number; code?: string | null };
}

export interface MetaHooks {
  beforeCall(call: MetaCallInfo): Promise<void>;
  onUsage(usage: MetaUsageInfo): Promise<void>;
}

function ctxString(ctx: Record<string, unknown> | undefined, key: string): string | null {
  const v = ctx?.[key];
  return typeof v === "string" && v ? v : null;
}

/**
 * Hooks para `createMetaClient({ apiKey, hooks: createMetaHooks(env, { case_id }) })`.
 * - beforeCall: presupuesto (lanza budget_exceeded). No registra: el cliente emite el evento
 *   `blocked` por onUsage, así queda una sola fila por intento.
 * - onUsage: registra en api_costs con unidades y costo (estimado aquí si no viene).
 */
export function createMetaHooks(env: Env, defaults: { case_id?: string | null } = {}): MetaHooks {
  return {
    async beforeCall(call) {
      if (call.model.endsWith("-contributor")) throw new ApiError("forbidden", "Modelo contributor no permitido");
      await budgetGuard(
        env,
        {
          essential: call.essential ?? isEssentialModel(call.model),
          model: call.model,
          operation: call.operation,
          case_id: ctxString(call.context, "case_id") ?? defaults.case_id ?? null,
          cache_key: ctxString(call.context, "cache_key"),
        },
        { record: false },
      );
    },
    async onUsage(usage) {
      const { reasoning_tokens: _r, ...units } = usage.units ?? {};
      await recordCost(env, {
        model: usage.model,
        operation: usage.operation,
        units,
        cost_usd: usage.status === "blocked" ? 0 : (usage.cost_usd ?? estimateCostUsd(usage.model, units)),
        essential: usage.essential ?? isEssentialModel(usage.model),
        status: usage.status,
        case_id: ctxString(usage.context, "case_id") ?? defaults.case_id ?? null,
        cache_key: ctxString(usage.context, "cache_key"),
        request_id: usage.request_id ?? null,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Resumen para la consola
// ---------------------------------------------------------------------------

export async function costsSummary(env: Env): Promise<CostsResponse> {
  const st = await budgetStatus(env);
  const [byModel, byDay, recent] = await env.DB.batch([
    env.DB.prepare(
      `SELECT model, COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost_usd,
         SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cached_tokens) AS cached_tokens,
         SUM(images) AS images, SUM(frames) AS frames, SUM(audio_seconds) AS audio_seconds
       FROM api_costs GROUP BY model ORDER BY cost_usd DESC`,
    ),
    env.DB.prepare(
      `SELECT substr(ts, 1, 10) AS day, COALESCE(SUM(cost_usd),0) AS cost_usd FROM api_costs GROUP BY day ORDER BY day ASC`,
    ),
    env.DB.prepare(`SELECT ts, model, operation, cost_usd, status FROM api_costs ORDER BY ts DESC LIMIT 50`),
  ]);
  const unitKeys = ["input_tokens", "output_tokens", "cached_tokens", "images", "frames", "audio_seconds"] as const;
  return {
    total_usd: round6(st.total_usd),
    budget_usd: st.budget_usd,
    pct: Math.round(st.pct * 10000) / 100,
    nonessential_blocked: st.nonessential_blocked,
    by_model: (byModel!.results as Array<Record<string, number | string>>).map((r) => {
      const units: Record<string, number> = {};
      for (const k of unitKeys) {
        const v = Number(r[k] ?? 0);
        if (v) units[k] = v;
      }
      return { model: String(r.model), calls: Number(r.calls), cost_usd: round6(Number(r.cost_usd)), units };
    }),
    by_day: (byDay!.results as Array<{ day: string; cost_usd: number }>).map((r) => ({
      day: r.day,
      cost_usd: round6(r.cost_usd),
    })),
    recent: (recent!.results as Array<{ ts: string; model: string; operation: string; cost_usd: number; status: string }>).map(
      (r) => ({ ...r, cost_usd: round6(r.cost_usd) }),
    ),
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
