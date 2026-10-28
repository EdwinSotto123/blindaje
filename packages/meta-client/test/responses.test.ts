import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MetaClient,
  MetaGuardError,
  MetaOutputError,
  extractUsage,
  getFunctionCalls,
  getOutputText,
  parseStructuredText,
  strictSubsetProblems,
  zodTextFormat,
  type MetaResponse,
} from "../src";
import { functionCall, jsonResponse, message, mockFetch, reasoning, responseBody } from "./helpers/mock-fetch";

const Ficha = z
  .object({
    resumen: z.string(),
    monto: z.number().nullable(),
    canal: z.enum(["yape", "plin", "efectivo"]),
    frases: z.array(z.object({ texto: z.string() }).strict()),
  })
  .strict();

describe("zodTextFormat", () => {
  it("arma json_schema strict sin $schema", () => {
    const format = zodTextFormat(Ficha, "ficha");
    expect(format).toMatchObject({ type: "json_schema", name: "ficha", strict: true });
    expect(format.schema.$schema).toBeUndefined();
    expect(format.schema.additionalProperties).toBe(false);
    expect(format.schema.required).toEqual(["resumen", "monto", "canal", "frases"]);
  });

  it("rechaza localmente esquemas fuera del subconjunto strict", () => {
    const conOpcional = z.object({ a: z.string(), b: z.string().optional() });
    expect(() => zodTextFormat(conOpcional, "x")).toThrow(MetaGuardError);
    expect(() => zodTextFormat(conOpcional, "x")).toThrow(/b.*nullable/);
    expect(() => zodTextFormat(z.string(), "x")).toThrow(/raíz/);
    // Sin strict se acepta tal cual.
    expect(zodTextFormat(conOpcional, "x", { strict: false }).strict).toBe(false);
  });

  it("valida el nombre del esquema", () => {
    expect(() => zodTextFormat(Ficha, "ficha del caso")).toThrow(/Nombre de esquema/);
  });

  it("strictSubsetProblems revisa objetos anidados", () => {
    const problems = strictSubsetProblems({
      type: "object",
      properties: { a: { type: "object", properties: { b: { type: "string" } } } },
      required: ["a"],
      additionalProperties: false,
    });
    expect(problems.join(" ")).toMatch(/a.*additionalProperties/);
  });
});

describe("lectura de respuestas", () => {
  const response = responseBody(
    "resp_1",
    [reasoning(), message("Voy a consultar.", "commentary"), functionCall("c1", "f", { a: 1 }), message('{"ok":'), message("true}")],
    { input: 10, output: 20, cached: 4, reasoning: 12 },
  ) as unknown as MetaResponse;

  it("getOutputText ignora el comentario intermedio", () => {
    expect(getOutputText(response)).toBe('{"ok":true}');
  });
  it("getFunctionCalls", () => {
    expect(getFunctionCalls(response).map((f) => f.call_id)).toEqual(["c1"]);
  });
  it("extractUsage con razonamiento y caché", () => {
    expect(extractUsage(response)).toEqual({ input_tokens: 10, output_tokens: 20, cached_tokens: 4, reasoning_tokens: 12, total_tokens: 30 });
    expect(extractUsage({ usage: null })).toEqual({ input_tokens: 0, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 0 });
  });
  it("parseStructuredText: JSON válido, cerca de código, JSON roto y esquema incumplido", () => {
    const ok = { resumen: "r", monto: null, canal: "yape", frases: [] };
    expect(parseStructuredText(JSON.stringify(ok), Ficha)).toEqual(ok);
    expect(parseStructuredText("```json\n" + JSON.stringify(ok) + "\n```", Ficha)).toEqual(ok);
    expect(() => parseStructuredText("{roto", Ficha)).toThrow(expect.objectContaining({ code: "invalid_json" }));
    expect(() => parseStructuredText('{"resumen":1}', Ficha)).toThrow(expect.objectContaining({ code: "schema_mismatch" }));
    expect(() => parseStructuredText("  ", Ficha)).toThrow(expect.objectContaining({ code: "empty_output" }));
  });
});

describe("responses.parse", () => {
  it("manda text.format strict, store false y reasoning.effort; valida con Zod", async () => {
    const out = { resumen: "Piden cupo semanal", monto: 500, canal: "yape", frases: [{ texto: "habla con el jefe" }] };
    const fetch = mockFetch(() => jsonResponse(responseBody("resp_p", [reasoning(), message(JSON.stringify(out))], { input: 1000, output: 100 })));
    const c = new MetaClient({ apiKey: "k", fetch });
    const res = await c.responses.parse({
      model: "muse-spark-1.3",
      instructions: "Extrae la ficha",
      input: "audio EV-A1: ...",
      schema: Ficha,
      schemaName: "ficha",
      reasoningEffort: "minimal",
    });
    expect(res.output).toEqual(out);
    expect(res.costUsd).toBeCloseTo((1000 * 1.25 + 100 * 4.25) / 1e6, 10);
    const body = fetch.calls[0]!.json!;
    expect(body.store).toBe(false);
    expect(body.reasoning).toEqual({ effort: "minimal" });
    expect(body.text).toMatchObject({ format: { type: "json_schema", name: "ficha", strict: true } });
  });

  it("una respuesta incompleta lanza MetaOutputError", async () => {
    const fetch = mockFetch(() =>
      jsonResponse({ ...responseBody("resp_i", [message('{"resumen":"a')]), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    );
    const c = new MetaClient({ apiKey: "k", fetch });
    const error = await c.responses.parse({ model: "muse-spark-1.3", input: "x", schema: Ficha, schemaName: "ficha" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaOutputError);
    expect((error as MetaOutputError).code).toBe("incomplete");
  });
});
