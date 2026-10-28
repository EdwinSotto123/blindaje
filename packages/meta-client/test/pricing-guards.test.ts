import { describe, expect, it } from "vitest";
import {
  MetaGuardError,
  assertModelAllowed,
  assertNoWebSearch,
  assertToolChoice,
  assertToolName,
  estimateCost,
  isEssentialModel,
} from "../src";

describe("estimateCost", () => {
  it("Spark: entrada, salida y caché por millón", () => {
    expect(estimateCost("muse-spark-1.3", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(5.5, 8);
    // 400k de 1M servidos desde caché: 600k × 1.25 + 400k × 0.15
    expect(estimateCost("muse-spark-1.3", { input_tokens: 1_000_000, cached_tokens: 400_000 })).toBeCloseTo(0.81, 8);
    // Los tokens de razonamiento ya están dentro de output_tokens: no se cobran dos veces.
    expect(estimateCost("muse-spark-1.3", { output_tokens: 1000, reasoning_tokens: 800 })).toBeCloseTo(0.00425, 8);
  });
  it("Wonder: 4/20 y caché 0.20", () => {
    expect(estimateCost("muse-wonder-1.0", { input_tokens: 1_000_000, output_tokens: 1_000_000, cached_tokens: 1_000_000 })).toBeCloseTo(
      20.2,
      8,
    );
  });
  it("SAM: 2.50 por 1,000 imágenes y 0.20 por 1,000 frames con mínimo 50 por video", () => {
    expect(estimateCost("sam-3.1", { images: 1 })).toBeCloseTo(0.0025, 8);
    expect(estimateCost("sam-3.1", { frames: 10 })).toBeCloseTo(0.01, 8);
    expect(estimateCost("sam-3.1", { frames: 500 })).toBeCloseTo(0.1, 8);
  });
  it("Transcribe: 0.18 por hora, por segundo entero hacia abajo", () => {
    expect(estimateCost("muse-voice-transcribe-1.0", { audio_seconds: 3600 })).toBeCloseTo(0.18, 8);
    expect(estimateCost("muse-voice-transcribe-1.0", { audio_seconds: 30.9 })).toBeCloseTo(0.0015, 8);
  });
  it("Muse Image: 0.01 por imagen", () => {
    expect(estimateCost("muse-image-1.0", { images: 3 })).toBeCloseTo(0.03, 8);
  });
  it("acepta versiones nuevas de una familia conocida y rechaza modelos desconocidos y contributor", () => {
    expect(estimateCost("muse-spark-1.9", { input_tokens: 1_000_000 })).toBeCloseTo(1.25, 8);
    expect(() => estimateCost("gpt-x", {})).toThrow(MetaGuardError);
    expect(() => estimateCost("muse-spark-1.3-contributor", {})).toThrow(/Contributor/);
  });
  it("Wonder e Image no son esenciales", () => {
    expect(isEssentialModel("muse-spark-1.3")).toBe(true);
    expect(isEssentialModel("sam-3.1")).toBe(true);
    expect(isEssentialModel("muse-wonder-1.0")).toBe(false);
    expect(isEssentialModel("muse-image-1.0")).toBe(false);
  });
});

describe("salvaguardas", () => {
  it("rechaza modelos contributor", () => {
    expect(() => assertModelAllowed("muse-spark-1.3-contributor")).toThrow(MetaGuardError);
    expect(() => assertModelAllowed("muse-spark-1.2-contributor")).toThrow(/Contributor mode/);
    expect(() => assertModelAllowed("muse-spark-1.3")).not.toThrow();
  });
  it("rechaza búsqueda web en todas sus formas", () => {
    const err = (body: Record<string, unknown>) => {
      try {
        assertNoWebSearch(body);
        return null;
      } catch (e) {
        return (e as MetaGuardError).code;
      }
    };
    expect(err({ tools: [{ type: "web_search" }] })).toBe("web_search_forbidden");
    expect(err({ tools: [{ type: "web_search_preview" }] })).toBe("web_search_forbidden");
    expect(err({ tools: [{ type: "function", name: "web_search", parameters: {} }] })).toBe("web_search_forbidden");
    expect(err({ web_search_options: {} })).toBe("web_search_forbidden");
    expect(err({ include: ["web_search_call.action.sources"] })).toBe("web_search_forbidden");
    expect(err({ tools: [{ type: "function", name: "buscar_casos", parameters: {} }] })).toBeNull();
  });
  it("solo tool_choice auto", () => {
    expect(() => assertToolChoice("required")).toThrow(/auto/);
    expect(() => assertToolChoice("auto")).not.toThrow();
    expect(() => assertToolChoice(undefined)).not.toThrow();
  });
  it("nombres de herramienta con a lo sumo un punto", () => {
    expect(() => assertToolName("obtener_red")).not.toThrow();
    expect(() => assertToolName("grafo.vecinos")).not.toThrow();
    expect(() => assertToolName("a.b.c")).toThrow(MetaGuardError);
    expect(() => assertToolName("con espacio")).toThrow(MetaGuardError);
  });
});
