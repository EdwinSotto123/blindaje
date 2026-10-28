import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AlertaBorrador,
  DEFAULT_CALIBRATION,
  FichaExtraction,
  PerfilRed,
  VinculadorOutput,
  canShowTerritorialStats,
  combineSignals,
  disguiseTextIsSafe,
  evidenceLabel,
  extractCitations,
  isCitation,
  statusForScore,
} from "../src";

describe("labels", () => {
  it("genera etiquetas de evidencia legibles", () => {
    expect(evidenceLabel("A", 1)).toBe("EV-A1");
    expect(evidenceLabel("K7Q2", 3)).toBe("EV-K7Q2-3");
  });
  it("extrae citas de un texto", () => {
    const t = "La voz de EV-B1 se parece a EV-A1 y EV-A2 (V-3, VIN-21, ID-3fa9c1, FICHA-A).";
    expect(extractCitations(t).sort()).toEqual(["EV-A1", "EV-A2", "EV-B1", "FICHA-A", "ID-3fa9c1", "V-3", "VIN-21"].sort());
  });
  it("reconoce citas válidas e inválidas", () => {
    expect(isCitation("EV-A1")).toBe(true);
    expect(isCitation("R-014")).toBe(true);
    expect(isCitation("Juan Pérez")).toBe(false);
  });
});

describe("motor de vinculación", () => {
  it("combina señales con 1 − ∏(1 − p)", () => {
    expect(combineSignals([])).toBe(0);
    expect(combineSignals([0.5, 0.5])).toBeCloseTo(0.75);
    expect(combineSignals([0.95])).toBeCloseTo(0.95);
  });
  it("aplica los umbrales 0.90 y 0.60", () => {
    expect(statusForScore(0.91)).toBe("probable");
    expect(statusForScore(0.7)).toBe("por_revisar");
    expect(statusForScore(0.3)).toBe("descartado_auto");
  });
  it("el modus operandi solo nunca supera el umbral de revisión", () => {
    expect(DEFAULT_CALIBRATION.mo.p_max).toBeLessThan(DEFAULT_CALIBRATION.thresholds.revisar);
  });
});

describe("seguridad", () => {
  it("no hay estadísticas territoriales con menos de 5 casos o 3 víctimas", () => {
    expect(canShowTerritorialStats(4, 4)).toBe(false);
    expect(canShowTerritorialStats(5, 2)).toBe(false);
    expect(canShowTerritorialStats(5, 3)).toBe(true);
  });
  it("detecta palabras prohibidas en el disfraz", () => {
    expect(disguiseTextIsSafe("Anotar venta")).toBe(true);
    expect(disguiseTextIsSafe("Preparar mi denuncia")).toBe(false);
  });
});

describe("esquemas strict para la Meta Model API", () => {
  const schemas = { FichaExtraction, VinculadorOutput, PerfilRed, AlertaBorrador };
  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} cumple el subconjunto strict (additionalProperties false y required completo)`, () => {
      const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
      const walk = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const n = node as Record<string, unknown>;
        if (n.type === "object" && n.properties) {
          expect(n.additionalProperties).toBe(false);
          expect(new Set(n.required as string[])).toEqual(new Set(Object.keys(n.properties as object)));
        }
        for (const v of Object.values(n)) {
          if (Array.isArray(v)) v.forEach(walk);
          else walk(v);
        }
      };
      walk(json);
    });
  }
});
