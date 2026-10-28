import { describe, expect, it } from "vitest";
import { validateCitations } from "../src/agents/common";

const known = new Set(["EV-A1", "EV-A2", "EV-B1", "FICHA-A", "FICHA-B", "V-3", "ID-3fa9c1", "VIN-1"]);

describe("validador de citas", () => {
  it("acepta una salida del Vinculador con citas existentes", () => {
    const check = validateCitations(
      {
        puntaje_ajustado: 0.91,
        recomendacion: "probable",
        explicacion: "La voz de EV-B1 se parece a la de EV-A1 y EV-A2 (V-3).",
        afirmaciones: [{ texto: "Ambas fichas piden pago por Yape", evidencia: ["FICHA-A", "FICHA-B"] }],
        contradicciones: [],
      },
      known,
    );
    expect(check).toEqual({ ok: true, total_afirmaciones: 1, sin_cita: [], citas_inexistentes: [] });
  });

  it("marca afirmaciones sin cita", () => {
    const check = validateCitations({ hechos: [{ texto: "La cuenta aparece en 4 casos", evidencia: [] }] }, known);
    expect(check.ok).toBe(false);
    expect(check.sin_cita).toEqual(["La cuenta aparece en 4 casos"]);
  });

  it("marca citas inventadas, también dentro del texto libre", () => {
    const check = validateCitations(
      {
        explicacion: "Coincide con EV-Z9.",
        hipotesis: [{ texto: "V-3 llama (EV-A7)", confianza: "alta", evidencia: ["V-3", "(EV-A1)"] }],
      },
      known,
    );
    expect(check.ok).toBe(false);
    expect(check.citas_inexistentes.sort()).toEqual(["EV-A7", "EV-Z9"]);
  });

  it("revisa los arrays de evidencia de objetos sin texto (alertas)", () => {
    const check = validateCitations({ titulo: "Alerta", cuerpo: "Sin datos de víctimas", evidencia: ["VIN-1", "VIN-99"] }, known);
    expect(check.ok).toBe(false);
    expect(check.citas_inexistentes).toEqual(["VIN-99"]);
  });
});
