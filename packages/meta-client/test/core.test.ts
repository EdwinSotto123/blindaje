import { describe, expect, it, vi } from "vitest";
import { MetaApiError, MetaClient, MetaNetworkError, MetaTimeoutError, parseRetryAfter, type UsageEvent } from "../src";
import { jsonResponse, message, mockFetch, responseBody } from "./helpers/mock-fetch";

const ok = () => jsonResponse(responseBody("resp_1", [message("hola")]));
const errorBody = (code: string, type = "server_error") => ({ error: { message: `fallo ${code}`, type, param: null, code } });

function client(fetch: ReturnType<typeof mockFetch>, extra: Partial<ConstructorParameters<typeof MetaClient>[0]> = {}) {
  const delays: number[] = [];
  const c = new MetaClient({
    apiKey: "LLM_test_secret",
    fetch,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0.5,
    ...extra,
  });
  return { c, delays };
}

describe("transporte", () => {
  it("manda Bearer, JSON y la URL base", async () => {
    const fetch = mockFetch(ok);
    const { c } = client(fetch);
    await c.responses.create({ model: "muse-spark-1.3", input: "hola" });
    expect(fetch.calls[0]?.url).toBe("https://api.meta.ai/v1/responses");
    expect(fetch.calls[0]?.init.headers.Authorization).toBe("Bearer LLM_test_secret");
    expect(fetch.calls[0]?.init.headers["Content-Type"]).toBe("application/json");
    expect(fetch.calls[0]?.json).toMatchObject({ model: "muse-spark-1.3", input: "hola" });
  });

  it("reintenta 429 respetando Retry-After y luego responde", async () => {
    const fetch = mockFetch(
      () => jsonResponse(errorBody("rate_limit_exceeded", "rate_limit_error"), 429, { "retry-after": "3" }),
      ok,
    );
    const { c, delays } = client(fetch);
    const res = await c.responses.create({ model: "muse-spark-1.3", input: "hola" });
    expect(res.id).toBe("resp_1");
    expect(fetch.calls).toHaveLength(2);
    expect(delays).toEqual([3000]);
  });

  it("reintenta 5xx con backoff exponencial y jitter desde 500 ms", async () => {
    const fetch = mockFetch(
      () => jsonResponse(errorBody("backend_unavailable"), 503),
      () => jsonResponse(errorBody("server_error"), 500),
      () => jsonResponse(errorBody("gateway_timeout"), 504),
      ok,
    );
    const { c, delays } = client(fetch);
    await c.responses.create({ model: "muse-spark-1.3", input: "hola" });
    // random = 0.5 → base × 2^n × 1.25
    expect(delays).toEqual([625, 1250, 2500]);
  });

  it("se rinde tras maxRetries y lanza MetaApiError tipado con request id", async () => {
    const fetch = mockFetch(() => jsonResponse(errorBody("service_overloaded"), 503, { "x-request-id": "req-503" }));
    const { c, delays } = client(fetch, { maxRetries: 2 });
    const error = await c.responses.create({ model: "muse-spark-1.3", input: "hola" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    const apiError = error as MetaApiError;
    expect(apiError.status).toBe(503);
    expect(apiError.code).toBe("service_overloaded");
    expect(apiError.type).toBe("server_error");
    expect(apiError.requestId).toBe("req-503");
    expect(apiError.retryable).toBe(true);
    expect(fetch.calls).toHaveLength(3);
    expect(delays).toHaveLength(2);
  });

  it("no reintenta 400 y conserva param", async () => {
    const fetch = mockFetch(() =>
      jsonResponse({ error: { message: "`top_p` inválido", type: "invalid_request_error", param: "top_p", code: null } }, 400),
    );
    const { c } = client(fetch);
    const error = (await c.responses.create({ model: "muse-spark-1.3", input: "x", top_p: 5 }).catch((e: unknown) => e)) as MetaApiError;
    expect(error.status).toBe(400);
    expect(error.param).toBe("top_p");
    expect(error.code).toBeNull();
    expect(error.retryable).toBe(false);
    expect(fetch.calls).toHaveLength(1);
  });

  it("404 sin cuerpo también da un error legible", async () => {
    const fetch = mockFetch(() => new Response(null, { status: 404, statusText: "Not Found" }));
    const { c } = client(fetch);
    const error = (await c.files.delete("file-1").catch((e: unknown) => e)) as MetaApiError;
    expect(error.status).toBe(404);
    expect(error.message).toMatch(/404/);
  });

  it("reintenta errores de red", async () => {
    const fetch = mockFetch(() => {
      throw new TypeError("fetch failed");
    }, ok);
    const { c } = client(fetch);
    const res = await c.responses.create({ model: "muse-spark-1.3", input: "hola" });
    expect(res.id).toBe("resp_1");
  });

  it("los errores de red persistentes salen como MetaNetworkError", async () => {
    const fetch = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const { c } = client(fetch, { maxRetries: 1 });
    await expect(c.listModels()).rejects.toBeInstanceOf(MetaNetworkError);
  });

  it("corta por timeout con AbortSignal y lanza MetaTimeoutError", async () => {
    const fetch = mockFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    );
    const { c } = client(fetch);
    const error = await c.listModels({ timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaTimeoutError);
    expect((error as MetaTimeoutError).timeoutMs).toBe(20);
    expect(fetch.calls).toHaveLength(1);
  });

  it("respeta la cancelación del llamador sin reintentar", async () => {
    const fetch = mockFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("cancelado", "AbortError")));
        }),
    );
    const { c } = client(fetch);
    const controller = new AbortController();
    const pending = c.listModels({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelado/);
    expect(fetch.calls).toHaveLength(1);
  });

  it("parseRetryAfter acepta segundos y fechas HTTP", () => {
    expect(parseRetryAfter("15")).toBe(15000);
    expect(parseRetryAfter("1.5")).toBe(1500);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("mañana")).toBeNull();
  });
});

describe("hooks de costo", () => {
  it("onUsage recibe unidades, costo, request id y contexto", async () => {
    const events: UsageEvent[] = [];
    const fetch = mockFetch(() =>
      jsonResponse(responseBody("resp_9", [message("ok")], { input: 1000, output: 200, cached: 400, reasoning: 150 }), 200, {
        "x-request-id": "req-9",
      }),
    );
    const { c } = client(fetch, { hooks: { onUsage: (e) => void events.push(e) } });
    await c.responses.create({ model: "muse-spark-1.3", input: "x" }, { operation: "ficha", context: { case_id: "C-1" } });
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e).toMatchObject({
      model: "muse-spark-1.3",
      operation: "ficha",
      essential: true,
      status: "ok",
      request_id: "req-9",
      response_id: "resp_9",
      context: { case_id: "C-1" },
      units: { input_tokens: 1000, output_tokens: 200, cached_tokens: 400, reasoning_tokens: 150 },
    });
    expect(e.cost_usd).toBeCloseTo((600 * 1.25 + 400 * 0.15 + 200 * 4.25) / 1e6, 10);
  });

  it("beforeCall puede bloquear: no hay fetch y onUsage registra blocked", async () => {
    const events: UsageEvent[] = [];
    const fetch = mockFetch(ok);
    const beforeCall = vi.fn((info: { essential: boolean }) => {
      if (!info.essential) throw new Error("presupuesto al 80%: bloqueado");
    });
    const { c } = client(fetch, { hooks: { beforeCall, onUsage: (e) => void events.push(e) } });
    await expect(c.responses.create({ model: "muse-wonder-1.0", input: "x" })).rejects.toThrow(/bloqueado/);
    expect(fetch.calls).toHaveLength(0);
    expect(events[0]).toMatchObject({ model: "muse-wonder-1.0", essential: false, status: "blocked", cost_usd: 0 });
    // Spark sigue pasando.
    await c.responses.create({ model: "muse-spark-1.3", input: "x" });
    expect(fetch.calls).toHaveLength(1);
  });

  it("una llamada fallida se registra como error con costo 0", async () => {
    const events: UsageEvent[] = [];
    const fetch = mockFetch(() => jsonResponse(errorBody("x", "invalid_request_error"), 400, { "x-request-id": "req-400" }));
    const { c } = client(fetch, { hooks: { onUsage: (e) => void events.push(e) } });
    await expect(c.responses.create({ model: "muse-spark-1.3", input: "x" })).rejects.toBeInstanceOf(MetaApiError);
    expect(events[0]).toMatchObject({ status: "error", cost_usd: 0, request_id: "req-400", error: { status: 400 } });
  });

  it("un onUsage que falla no tumba la llamada", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { c } = client(mockFetch(ok), {
      hooks: {
        onUsage: () => {
          throw new Error("D1 caído");
        },
      },
    });
    await expect(c.responses.create({ model: "muse-spark-1.3", input: "x" })).resolves.toMatchObject({ id: "resp_1" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("las salvaguardas actúan antes de beforeCall y de fetch", async () => {
    const fetch = mockFetch(ok);
    const beforeCall = vi.fn();
    const { c } = client(fetch, { hooks: { beforeCall } });
    await expect(c.responses.create({ model: "muse-spark-1.3-contributor", input: "x" })).rejects.toThrow(/Contributor/);
    await expect(c.responses.create({ model: "muse-spark-1.3", input: "x", tools: [{ type: "web_search" }] })).rejects.toThrow(
      /búsqueda web/,
    );
    await expect(
      c.responses.create({ model: "muse-spark-1.3", input: "x", tool_choice: "required" as unknown as "auto" }),
    ).rejects.toThrow(/auto/);
    expect(beforeCall).not.toHaveBeenCalled();
    expect(fetch.calls).toHaveLength(0);
  });
});
