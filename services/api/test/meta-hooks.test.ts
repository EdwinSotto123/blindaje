import { afterAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createMetaClient, type FetchLike, type MetaHooks as ClientHooks } from "@blindaje/meta-client";
import { createMetaHooks, recordCost } from "../src/costs";

afterAll(async () => {
  await env.DB.prepare("DELETE FROM api_costs").run();
});

describe("integración con @blindaje/meta-client", () => {
  it("los hooks de costos encajan con el cliente: registran uso y bloquean por presupuesto", async () => {
    await env.DB.prepare("DELETE FROM api_costs").run();
    // Comprobación de tipos: createMetaHooks es asignable a los hooks del cliente.
    const hooks: ClientHooks = createMetaHooks(env);
    const calls: string[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push(String(JSON.parse(String(init.body)).model));
      return Response.json(
        {
          id: "resp_ficticia",
          object: "response",
          model: "muse-spark-1.3",
          status: "completed",
          output: [],
          usage: { input_tokens: 10_000, output_tokens: 2_000, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 500 } },
        },
        { headers: { "x-request-id": "req-ficticio" } },
      );
    };
    const client = createMetaClient({ apiKey: "sin-uso", fetch: fakeFetch, hooks, maxRetries: 0 });

    await client.responses.create({ model: "muse-spark-1.3", input: "texto ficticio" }, { operation: "ficha", context: { case_id: "caso-x", cache_key: "k-1" } });
    const ok = await env.DB.prepare("SELECT * FROM api_costs WHERE status = 'ok'").first<Record<string, unknown>>();
    expect(ok).toMatchObject({ model: "muse-spark-1.3", operation: "ficha", input_tokens: 10_000, output_tokens: 2_000, case_id: "caso-x", cache_key: "k-1", essential: 1 });
    expect(Number(ok!.cost_usd)).toBeCloseTo((10_000 * 1.25 + 2_000 * 4.25) / 1_000_000, 6);

    // Presupuesto al 80 %: Muse Wonder se bloquea antes de llamar y queda UNA fila 'blocked'.
    await recordCost(env, { model: "muse-spark-1.3", operation: "ficha", cost_usd: 121, essential: true, status: "ok" });
    await expect(client.responses.create({ model: "muse-wonder-1.0", input: "red ficticia" }, { operation: "cartografo" })).rejects.toMatchObject({
      code: "budget_exceeded",
    });
    expect(calls).toEqual(["muse-spark-1.3"]);
    const blocked = await env.DB.prepare("SELECT model, essential, cost_usd FROM api_costs WHERE status = 'blocked'").all();
    expect(blocked.results).toEqual([{ model: "muse-wonder-1.0", essential: 0, cost_usd: 0 }]);

    // Lo esencial sigue pasando.
    await client.responses.create({ model: "muse-spark-1.3", input: "otra ficha ficticia" }, { operation: "ficha" });
    expect(calls).toEqual(["muse-spark-1.3", "muse-spark-1.3"]);
  });
});
