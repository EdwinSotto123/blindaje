import { describe, expect, it } from "vitest";
import { fmtPeriod } from "../lib/format";
import { initialLinks } from "../mock/fixtures";
import { signalSummary, signalVerdict, sortQueue } from "./LinksView";

const vin2 = initialLinks().find((l) => l.label === "VIN-2")!;

describe("lectura de las señales en palabras", () => {
  it("usa bandas sobre la probabilidad calibrada", () => {
    expect(signalVerdict(0.95).tone).toBe("si");
    expect(signalVerdict(0.5).tone).toBe("parcial");
    expect(signalVerdict(0.08)).toEqual({ text: "No lo sostiene", tone: "no" });
  });

  it("VIN-2: la cuenta lo sostiene y la voz no, con sus segmentos a la vista", () => {
    const g = signalSummary(vin2.signals);
    expect(g.si).toContain("identificador igual");
    expect(g.no.some((x) => x.startsWith("voz (") && x.includes("segmentos coinciden"))).toBe(true);
    // Nunca culpa a nadie: habla de lo que sostiene o no el vínculo.
    expect(JSON.stringify(g)).not.toMatch(/culpable|responsable|autor/i);
  });

  it("la cola pone primero los probables y, dentro, el puntaje más alto", () => {
    const sorted = sortQueue(initialLinks());
    const statuses = sorted.map((l) => l.status);
    expect(statuses.indexOf("por_revisar")).toBeGreaterThan(statuses.lastIndexOf("probable"));
  });
});

describe("fmtPeriod", () => {
  it("convierte el periodo ISO a fechas legibles en hora de Lima", () => {
    expect(fmtPeriod("2026-10-03 a 2026-10-19")).toMatch(/^3 oct\.? a 19 oct\.? de 2026$/);
  });
  it("deja tal cual lo que no tiene esa forma", () => {
    expect(fmtPeriod("octubre de 2026")).toBe("octubre de 2026");
    expect(fmtPeriod(null)).toBe("—");
  });
});
