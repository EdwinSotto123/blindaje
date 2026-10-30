import { DEFAULT_BASE_URL } from "@blindaje/meta-client";
import type { ConsoleMonitor, MonitorActivity, MonitorAgent, MonitorService } from "@blindaje/shared";
import { metaFetch } from "../agents/common";
import { auditHead } from "../audit";
import { budgetUsd } from "../costs";
import type { Env } from "../env";
import { errorFields, log } from "../lib/log";
import { tryGetMlClient } from "../ml/client";
import { API_VERSION } from "../routes/public";
import { getChromaClient } from "../vectors/chroma";

/**
 * Panel de monitoreo de la administración (GET /v1/console/monitoreo). Las cifras salen de una sola
 * ida y vuelta a D1; los servicios se miden en paralelo con esa lectura, cada uno con su tope de
 * tiempo, así que el panel nunca espera más que el servicio más lento (máximo ~3 s).
 */

const PROBE_TIMEOUT_MS = 3_000;
/** Sobre esto un servicio que respondió se marca "lento". */
const SLOW_MS: Record<MonitorService["servicio"], number> = { d1: 250, chroma: 600, ml: 1_500, meta: 1_500, auditoria: 400 };

async function probe(servicio: MonitorService["servicio"], detalle: string, fn: () => Promise<string | void>): Promise<MonitorService> {
  const t = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const extra = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS);
      }),
    ]);
    const ms = Date.now() - t;
    return { servicio, estado: ms > SLOW_MS[servicio] ? "lento" : "ok", latencia_ms: ms, detalle: extra || detalle, medido_en: new Date().toISOString() };
  } catch (err) {
    log("warn", "monitor_probe_failed", { servicio, ...errorFields(err) });
    return { servicio, estado: "caido", latencia_ms: null, detalle, medido_en: new Date().toISOString() };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const off = (servicio: MonitorService["servicio"], detalle: string): MonitorService => ({
  servicio,
  estado: "apagado",
  latencia_ms: null,
  detalle,
  medido_en: new Date().toISOString(),
});

/**
 * Meta (~1 s) y Chroma (~0,3 s) son las mediciones lentas: el panel muestra la última (guardada en
 * KV, con su hora) y, si tiene más de 30 s, la renueva en segundo plano para la próxima lectura.
 */
const PROBE_FRESH_MS = 30_000;
const PROBE_KV_PREFIX = "monitor:";

type WaitUntil = (p: Promise<unknown>) => void;

async function cachedProbe(env: Env, servicio: MonitorService["servicio"], waitUntil: WaitUntil, run: () => Promise<MonitorService>): Promise<MonitorService> {
  const key = PROBE_KV_PREFIX + servicio;
  const refresh = async () => {
    const result = await run();
    await env.CONFIG.put(key, JSON.stringify(result), { expirationTtl: 3600 }).catch(() => undefined);
    return result;
  };
  const cached = await env.CONFIG.get<MonitorService>(key, "json").catch(() => null);
  if (!cached) return refresh();
  if (Date.now() - Date.parse(cached.medido_en) > PROBE_FRESH_MS) waitUntil(refresh().catch(() => undefined));
  return cached;
}

function chromaService(env: Env, waitUntil: WaitUntil): Promise<MonitorService> {
  const chroma = getChromaClient(env);
  if (!chroma) return Promise.resolve(off("chroma", "Sin credenciales: la búsqueda vectorial usa FAISS"));
  return cachedProbe(env, "chroma", waitUntil, () =>
    probe("chroma", `Chroma Cloud, base "${chroma.cfg.database}"`, async () => {
      await chroma.heartbeat();
    }),
  );
}

function mlService(env: Env): Promise<MonitorService> {
  const ml = tryGetMlClient(env);
  if (!ml) return Promise.resolve(off("ml", "Contenedor no desplegado: los casos nuevos no generan voz, imagen ni marcas"));
  return probe("ml", "Contenedor ML (voz, imagen, marcas de agua)", async () => {
    await ml.health();
  });
}

async function metaService(env: Env, waitUntil: WaitUntil): Promise<MonitorService> {
  if (!env.MODEL_API_KEY) return off("meta", "Falta MODEL_API_KEY");
  // Listar modelos no consume presupuesto: mide la ida y vuelta a la API de Meta.
  return cachedProbe(env, "meta", waitUntil, () =>
    probe("meta", "API de Meta (Muse Spark, SAM 3.1, transcripción)", async () => {
      const res = await metaFetch()(`${DEFAULT_BASE_URL}/models`, {
        method: "GET",
        headers: { authorization: `Bearer ${env.MODEL_API_KEY}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`meta_${res.status}`);
    }),
  );
}

function auditService(env: Env): Promise<MonitorService> {
  return probe("auditoria", "Cadena de auditoría (Durable Object)", async () => {
    const head = await auditHead(env);
    return head ? `Cadena de auditoría al día hasta la entrada ${head.seq}` : "Cadena de auditoría sin entradas";
  });
}

interface Counts {
  total: number;
  nuevos_24h: number;
  nuevos_7d: number;
  procesando: number;
  con_error: number;
  indexados: number;
}

export async function consoleMonitor(
  env: Env,
  opts: { demo: boolean; colo: string | null; placement: string | null; started: number; waitUntil: WaitUntil },
): Promise<ConsoleMonitor> {
  const now = Date.now();
  const day = new Date(now - 86_400_000).toISOString();
  const week = new Date(now - 7 * 86_400_000).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);
  const demo = opts.demo ? 1 : 0;

  const db = async () => {
    const t = Date.now();
    const res = await env.DB.batch([
      env.DB.prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(created_at >= ?), 0) AS nuevos_24h,
           COALESCE(SUM(created_at >= ?), 0) AS nuevos_7d,
           COALESCE(SUM(estado = 'procesando'), 0) AS procesando,
           COALESCE(SUM(estado = 'error'), 0) AS con_error,
           COALESCE(SUM(indexed = 1), 0) AS indexados
         FROM cases WHERE is_demo = ?`,
      ).bind(day, week, demo),
      env.DB.prepare(`SELECT l.status, COUNT(*) AS n FROM links l JOIN cases c ON c.id = l.case_a WHERE c.is_demo = ? GROUP BY l.status`).bind(demo),
      env.DB.prepare(`SELECT COUNT(DISTINCT nc.network_id) AS n FROM network_cases nc JOIN cases c ON c.id = nc.case_id WHERE c.is_demo = ?`).bind(demo),
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM alerts WHERE status = 'borrador') AS alertas,
           (SELECT COUNT(*) FROM business_recommendations WHERE status = 'borrador' AND is_demo = ?) AS recomendaciones,
           (SELECT COUNT(*) FROM hypotheses WHERE status = 'borrador') AS hipotesis`,
      ).bind(demo),
      env.DB.prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total, COALESCE(SUM(CASE WHEN substr(ts, 1, 10) = ? THEN cost_usd ELSE 0 END), 0) AS hoy FROM api_costs`,
      ).bind(today),
      env.DB.prepare(
        `SELECT agent AS agente, MAX(created_at) AS ultima,
           COALESCE(SUM(created_at >= ? AND status = 'ok'), 0) AS ok_7d,
           COALESCE(SUM(created_at >= ? AND status <> 'ok'), 0) AS error_7d
         FROM agent_runs GROUP BY agent ORDER BY ultima DESC`,
      ).bind(week, week),
      env.DB.prepare("SELECT seq, ts, action AS accion, actor_type AS actor_tipo FROM audit_log ORDER BY seq DESC LIMIT 10"),
    ]);
    return { res, ms: Date.now() - t };
  };

  const [{ res, ms: dbMs }, ...services] = await Promise.all([
    db(),
    chromaService(env, opts.waitUntil),
    mlService(env),
    metaService(env, opts.waitUntil),
    auditService(env),
  ]);
  const [casesRes, linksRes, netsRes, pendRes, costRes, agentsRes, auditRes] = res;
  const casos = (casesRes!.results[0] ?? { total: 0, nuevos_24h: 0, nuevos_7d: 0, procesando: 0, con_error: 0, indexados: 0 }) as Counts;
  const byStatus = new Map((linksRes!.results as Array<{ status: string; n: number }>).map((r) => [r.status, r.n]));
  const pend = (pendRes!.results[0] ?? { alertas: 0, recomendaciones: 0, hipotesis: 0 }) as ConsoleMonitor["pendientes"];
  const cost = (costRes!.results[0] ?? { total: 0, hoy: 0 }) as { total: number; hoy: number };
  const budget = budgetUsd(env);

  const d1: MonitorService = {
    servicio: "d1",
    estado: dbMs > SLOW_MS.d1 ? "lento" : "ok",
    latencia_ms: dbMs,
    detalle: "Base D1, primaria en Miami (ENAM)",
    medido_en: new Date().toISOString(),
  };

  return {
    generado_en: new Date().toISOString(),
    mundo: opts.demo ? "demo" : "real",
    api: { version: API_VERSION, entorno: env.ENVIRONMENT, colo: opts.colo, ubicacion: opts.placement, ms: Date.now() - opts.started },
    servicios: [d1, ...services],
    casos: {
      total: Number(casos.total),
      nuevos_24h: Number(casos.nuevos_24h),
      nuevos_7d: Number(casos.nuevos_7d),
      procesando: Number(casos.procesando),
      con_error: Number(casos.con_error),
      indexados: Number(casos.indexados),
    },
    vinculos: {
      probable: byStatus.get("probable") ?? 0,
      por_revisar: byStatus.get("por_revisar") ?? 0,
      confirmado: byStatus.get("confirmado") ?? 0,
      // Los descartados por el motor (bajo el umbral) también cuentan como descartados.
      descartado: (byStatus.get("descartado") ?? 0) + (byStatus.get("descartado_auto") ?? 0),
    },
    redes: Number((netsRes!.results[0] as { n: number } | undefined)?.n ?? 0),
    pendientes: { alertas: Number(pend.alertas), recomendaciones: Number(pend.recomendaciones), hipotesis: Number(pend.hipotesis) },
    presupuesto: {
      gastado_usd: Math.round(cost.total * 10_000) / 10_000,
      hoy_usd: Math.round(cost.hoy * 10_000) / 10_000,
      presupuesto_usd: budget,
      pct: Math.round((cost.total / budget) * 10_000) / 10_000,
    },
    agentes: (agentsRes!.results as MonitorAgent[]).map((a) => ({ ...a, ok_7d: Number(a.ok_7d), error_7d: Number(a.error_7d) })),
    actividad: auditRes!.results as MonitorActivity[],
  };
}
