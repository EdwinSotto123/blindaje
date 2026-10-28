import { afterAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { budgetGuard, budgetStatus, cacheGet, costCacheKey, createMetaHooks, estimateCostUsd, recordCost, withCostCache } from "../src/costs";
import { ApiError } from "../src/lib/errors";
import { apiJson, loginAs, seedOrg } from "./helpers";

afterAll(async () => {
  await env.DB.prepare("DELETE FROM api_costs").run();
});

describe("tabla de precios", () => {
  it("estima costos por modelo", () => {
    expect(estimateCostUsd("muse-spark-1.3", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(5.5);
    expect(estimateCostUsd("muse-spark-1.3", { input_tokens: 1_000_000, cached_tokens: 1_000_000 })).toBeCloseTo(0.15);
    expect(estimateCostUsd("sam-3.1", { images: 1000 })).toBeCloseTo(2.5);
    expect(estimateCostUsd("sam-3.1", { frames: 10 })).toBeCloseTo((50 * 0.2) / 1000);
    expect(estimateCostUsd("muse-voice-transcribe-1.0", { audio_seconds: 3600 })).toBeCloseTo(0.18);
    expect(estimateCostUsd("muse-image-1.0", { images: 3 })).toBeCloseTo(0.03);
  });
});

describe("presupuesto", () => {
  it("al 80 % bloquea lo no esencial, registra 'blocked' y deja pasar lo esencial", async () => {
    await env.DB.prepare("DELETE FROM api_costs").run();
    await recordCost(env, { model: "muse-spark-1.3", operation: "ficha", cost_usd: 119, essential: true, status: "ok" });
    await budgetGuard(env, { essential: false, model: "muse-wonder-1.0", operation: "cartografo" });

    const hooks = createMetaHooks(env, { case_id: null });
    await hooks.onUsage({ model: "muse-spark-1.3", operation: "vinculador", status: "ok", units: { input_tokens: 1_000_000 } });
    const st = await budgetStatus(env);
    expect(st.total_usd).toBeCloseTo(120.25);
    expect(st.nonessential_blocked).toBe(true);

    await expect(budgetGuard(env, { essential: false, model: "muse-wonder-1.0", operation: "cartografo" })).rejects.toMatchObject({
      code: "budget_exceeded",
    });
    await expect(hooks.beforeCall({ model: "muse-image-1.0", operation: "image" })).rejects.toBeInstanceOf(ApiError);
    await hooks.beforeCall({ model: "muse-spark-1.3", operation: "ficha" });
    await hooks.beforeCall({ model: "muse-voice-transcribe-1.0", operation: "transcribe" });

    const blocked = await env.DB.prepare("SELECT model, status, essential FROM api_costs WHERE status = 'blocked'").all<{ model: string }>();
    expect(blocked.results.map((r) => r.model).sort()).toEqual(["muse-image-1.0", "muse-wonder-1.0"]);

    const { orgId } = await seedOrg();
    const analyst = await loginAs("analyst", orgId);
    const costs = await apiJson<{ total_usd: number; budget_usd: number; pct: number; nonessential_blocked: boolean; by_model: unknown[]; recent: unknown[] }>(
      "/v1/console/costs",
      { token: analyst.token },
    );
    expect(costs.status).toBe(200);
    expect(costs.body.budget_usd).toBe(150);
    expect(costs.body.nonessential_blocked).toBe(true);
    expect(costs.body.pct).toBeGreaterThanOrEqual(80);
    expect(costs.body.by_model.length).toBeGreaterThan(0);

    // El Cartógrafo con Muse Wonder responde budget_exceeded (402) antes de llamar a Meta.
    const net = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO networks (id, num, n_casos, created_at, updated_at) VALUES (?, 9000, 2, ?, ?)")
      .bind(net, new Date().toISOString(), new Date().toISOString())
      .run();
    const wonder = await apiJson<{ error: { code: string } }>(`/v1/console/networks/${net}/cartografo`, {
      token: analyst.token,
      json: { model: "muse-wonder-1.0" },
    });
    expect(wonder.status).toBe(402);
    expect(wonder.body.error.code).toBe("budget_exceeded");
    await env.DB.prepare("DELETE FROM networks WHERE id = ?").bind(net).run();

    // Al 100 % se bloquea todo.
    await recordCost(env, { model: "muse-spark-1.3", operation: "ficha", cost_usd: 30, essential: true, status: "ok" });
    await expect(hooks.beforeCall({ model: "muse-spark-1.3", operation: "ficha" })).rejects.toMatchObject({ code: "budget_exceeded" });
    await env.DB.prepare("DELETE FROM api_costs").run();
  });

  it("rechaza modelos contributor", async () => {
    await expect(createMetaHooks(env).beforeCall({ model: "muse-spark-1.3-contributor", operation: "ficha" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("caché por hash", () => {
  it("guarda cifrado y registra 'cached' en el segundo uso", async () => {
    const key = await costCacheKey("a".repeat(64), "transcribe");
    let calls = 0;
    const fn = async () => {
      calls++;
      return { turns: [{ text: "transcripción ficticia" }] };
    };
    const first = await withCostCache(env, { cache_key: key, model: "muse-voice-transcribe-1.0", operation: "transcribe" }, fn);
    const second = await withCostCache(env, { cache_key: key, model: "muse-voice-transcribe-1.0", operation: "transcribe" }, fn);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    const raw = await (await env.EVIDENCE.get(`cache/${key}`))!.text();
    expect(raw.includes("ficticia")).toBe(false);
    expect(await cacheGet(env, key)).toEqual(first);
    const cached = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_costs WHERE status = 'cached' AND cache_key = ?").bind(key).first<{ n: number }>();
    expect(cached!.n).toBe(1);
  });
});
