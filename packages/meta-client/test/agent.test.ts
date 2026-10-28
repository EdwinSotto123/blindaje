import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MetaAgentError, MetaClient, defineTool, type UsageEvent } from "../src";
import { functionCall, jsonResponse, message, mockFetch, reasoning, responseBody } from "./helpers/mock-fetch";

const Final = z.object({ red: z.string(), casos: z.number() }).strict();

const tools = (log: string[] = []) => [
  defineTool({
    name: "obtener_red",
    description: "Devuelve los casos de una red",
    parameters: z.object({ red: z.string() }).strict(),
    handler: ({ red }) => {
      log.push(`red:${red}`);
      return { red, casos: ["C-1", "C-2", "C-3"] };
    },
  }),
  defineTool({
    name: "contar",
    description: "Cuenta elementos",
    parameters: z.object({ n: z.number() }).strict(),
    handler: async ({ n }) => {
      log.push(`contar:${n}`);
      return String(n);
    },
  }),
];

describe("runAgent", () => {
  it("ejecuta llamadas en paralelo, encadena con previous_response_id y reenvía instructions", async () => {
    const fetch = mockFetch(
      () =>
        jsonResponse(
          responseBody(
            "resp_1",
            [reasoning(), message("Consulto la red.", "commentary"), functionCall("c1", "obtener_red", { red: "R-1" }), functionCall("c2", "contar", { n: 3 })],
            { input: 500, output: 80, reasoning: 40 },
          ),
        ),
      () => jsonResponse(responseBody("resp_2", [reasoning(), message('{"red":"R-1","casos":3}')], { input: 700, output: 30, cached: 500 })),
    );
    const log: string[] = [];
    const events: UsageEvent[] = [];
    const c = new MetaClient({ apiKey: "k", fetch, hooks: { onUsage: (e) => void events.push(e) } });
    const result = await c.runAgent(
      {
        model: "muse-spark-1.3",
        instructions: "Eres el Cartógrafo",
        input: "Perfila la red R-1",
        tools: tools(log),
        finalSchema: Final,
        finalSchemaName: "perfil_red",
        reasoningEffort: "low",
      },
      { operation: "cartografo" },
    );

    expect(result.output).toEqual({ red: "R-1", casos: 3 });
    expect(result.turns).toBe(2);
    expect(result.responseIds).toEqual(["resp_1", "resp_2"]);
    expect(log.sort()).toEqual(["contar:3", "red:R-1"]);
    expect(result.trace.map((t) => [t.name, t.ok, t.turn])).toEqual([
      ["obtener_red", true, 1],
      ["contar", true, 1],
    ]);
    expect(result.trace[1]?.output).toBe("3");
    expect(result.usage).toMatchObject({ input_tokens: 1200, output_tokens: 110, cached_tokens: 500, reasoning_tokens: 40, calls: 2 });
    expect(result.usage.cost_usd).toBeCloseTo((500 * 1.25 + 80 * 4.25 + 200 * 1.25 + 500 * 0.15 + 30 * 4.25) / 1e6, 10);

    const [first, second] = fetch.calls.map((call) => call.json!);
    expect(first).toMatchObject({ store: true, instructions: "Eres el Cartógrafo", tool_choice: "auto", reasoning: { effort: "low" } });
    expect(first!.previous_response_id).toBeUndefined();
    expect((first!.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["obtener_red", "contar"]);
    expect(first!.text).toMatchObject({ format: { type: "json_schema", name: "perfil_red", strict: true } });
    expect(second).toMatchObject({ store: true, previous_response_id: "resp_1", instructions: "Eres el Cartógrafo", reasoning: { effort: "low" } });
    expect(second!.tools).toBeDefined();
    expect(second!.input).toEqual([
      { type: "function_call_output", call_id: "c1", output: JSON.stringify({ red: "R-1", casos: ["C-1", "C-2", "C-3"] }) },
      { type: "function_call_output", call_id: "c2", output: "3" },
    ]);
    expect(events.map((e) => e.operation)).toEqual(["cartografo", "cartografo"]);
  });

  it("acepta que el modelo responda texto sin llamar herramientas", async () => {
    const fetch = mockFetch(() => jsonResponse(responseBody("resp_1", [message("No necesito herramientas.")])));
    const c = new MetaClient({ apiKey: "k", fetch });
    const result = await c.runAgent({ model: "muse-spark-1.3", instructions: "i", input: "hola", tools: tools() });
    expect(result.output).toBe("No necesito herramientas.");
    expect(result.trace).toEqual([]);
    expect(result.turns).toBe(1);
  });

  it("devuelve al modelo los argumentos inválidos, herramientas desconocidas y errores del handler", async () => {
    const failing = defineTool({
      name: "falla",
      description: "Siempre falla",
      parameters: z.object({}).strict(),
      handler: () => {
        throw new Error("D1 no responde");
      },
    });
    const fetch = mockFetch(
      () =>
        jsonResponse(
          responseBody("resp_1", [
            functionCall("a", "contar", { n: "tres" }),
            functionCall("b", "inexistente", {}),
            functionCall("c", "contar", "{no es json"),
            functionCall("d", "falla", {}),
          ]),
        ),
      () => jsonResponse(responseBody("resp_2", [message("listo")])),
    );
    const c = new MetaClient({ apiKey: "k", fetch });
    const result = await c.runAgent({ model: "muse-spark-1.3", instructions: "i", input: "x", tools: [...tools(), failing] });
    expect(result.trace.map((t) => t.ok)).toEqual([false, false, false, false]);
    expect(result.trace[0]?.error).toMatch(/Argumentos inválidos/);
    expect(result.trace[1]?.error).toMatch(/desconocida/);
    expect(result.trace[2]?.error).toMatch(/JSON/);
    expect(result.trace[3]?.error).toBe("D1 no responde");
    const outputs = (fetch.calls[1]!.json!.input as Array<{ output: string }>).map((o) => JSON.parse(o.output) as { error: string });
    expect(outputs.every((o) => typeof o.error === "string")).toBe(true);
  });

  it("onToolError throw aborta con MetaAgentError y la traza parcial", async () => {
    const failing = defineTool({
      name: "falla",
      description: "x",
      parameters: z.object({}).strict(),
      handler: () => {
        throw new Error("boom");
      },
    });
    const fetch = mockFetch(() => jsonResponse(responseBody("resp_1", [functionCall("a", "falla", {})])));
    const c = new MetaClient({ apiKey: "k", fetch });
    const error = (await c
      .runAgent({ model: "muse-spark-1.3", instructions: "i", input: "x", tools: [failing], onToolError: "throw" })
      .catch((e: unknown) => e)) as MetaAgentError;
    expect(error).toBeInstanceOf(MetaAgentError);
    expect(error.code).toBe("tool_error");
    expect((error.partial as { trace: unknown[] }).trace).toHaveLength(1);
  });

  it("en el último turno quita las herramientas y pide la respuesta final", async () => {
    const fetch = mockFetch(
      () => jsonResponse(responseBody("resp_1", [functionCall("a", "contar", { n: 1 })])),
      () => jsonResponse(responseBody("resp_2", [message('{"red":"R-9","casos":1}')])),
    );
    const c = new MetaClient({ apiKey: "k", fetch });
    const result = await c.runAgent({ model: "muse-spark-1.3", instructions: "i", input: "x", tools: tools(), maxTurns: 2, finalSchema: Final });
    expect(result.output).toEqual({ red: "R-9", casos: 1 });
    const last = fetch.calls[1]!.json!;
    expect(last.tools).toBeUndefined();
    expect(last.instructions).toBe("i");
    const input = last.input as Array<Record<string, unknown>>;
    expect(input[0]).toMatchObject({ type: "function_call_output", call_id: "a" });
    expect(input[1]).toMatchObject({ role: "user" });
  });

  it("si la salida final no valida, pide una corrección una vez", async () => {
    const fetch = mockFetch(
      () => jsonResponse(responseBody("resp_1", [message('{"red":"R-1"}')])),
      () => jsonResponse(responseBody("resp_2", [message('{"red":"R-1","casos":2}')])),
    );
    const c = new MetaClient({ apiKey: "k", fetch });
    const result = await c.runAgent({ model: "muse-spark-1.3", instructions: "i", input: "x", tools: tools(), finalSchema: Final });
    expect(result.output).toEqual({ red: "R-1", casos: 2 });
    expect(fetch.calls[1]!.json!.previous_response_id).toBe("resp_1");
    expect(fetch.calls[1]!.json!.tools).toBeUndefined();
  });

  it("lanza max_turns si el modelo insiste en llamar herramientas", async () => {
    const fetch = mockFetch(() => jsonResponse(responseBody("resp_n", [functionCall("a", "contar", { n: 1 })])));
    const c = new MetaClient({ apiKey: "k", fetch });
    const error = (await c
      .runAgent({ model: "muse-spark-1.3", instructions: "i", input: "x", tools: tools(), maxTurns: 3 })
      .catch((e: unknown) => e)) as MetaAgentError;
    expect(error.code).toBe("max_turns");
    expect(fetch.calls).toHaveLength(3);
  });

  it("reintenta el encadenamiento si la respuesta previa aún no se persistió", async () => {
    const fetch = mockFetch(
      () => jsonResponse(responseBody("resp_1", [functionCall("a", "contar", { n: 1 })])),
      () =>
        jsonResponse(
          { error: { message: "Previous response with id 'resp_1' not found.", type: "invalid_request_error", param: "previous_response_id", code: null } },
          400,
        ),
      () => jsonResponse(responseBody("resp_2", [message("fin")])),
    );
    const c = new MetaClient({ apiKey: "k", fetch });
    const result = await c.runAgent({ model: "muse-spark-1.3", instructions: "i", input: "x", tools: tools() });
    expect(result.output).toBe("fin");
    expect(fetch.calls).toHaveLength(3);
  });

  it("rechaza web_search como nombre de herramienta", async () => {
    const c = new MetaClient({ apiKey: "k", fetch: mockFetch(() => jsonResponse({})) });
    const bad = defineTool({ name: "web_search", description: "x", parameters: z.object({}).strict(), handler: () => "" });
    await expect(c.runAgent({ model: "muse-spark-1.3", instructions: "i", input: "x", tools: [bad] })).rejects.toThrow(/búsqueda web/);
  });
});
