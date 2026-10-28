import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthenticityBadge, AuthenticityPanel } from "../components/Authenticity";
import { AUTENTICIDAD, CASES, initialLinks } from "../mock/fixtures";
import { AuthenticityWarningChip } from "../views/LinksView";
import { flaggedInLink, NIVEL_META, NOTA_AUSENCIA, sourceLines } from "./authenticity";
import { indexFromCases, indexFromLink } from "./citations";

const links = initialLinks();
const byLabel = (l: string) => links.find((x) => x.label === l)!;
const visibleText = (html: string) => html.replace(/<[^>]+>/g, "");

describe("advertencia de la cola", () => {
  it("marca los pares con evidencia con indicios fuertes, y solo esos", () => {
    expect(flaggedInLink(byLabel("VIN-1"))).toEqual([]);
    expect(flaggedInLink(byLabel("VIN-2"))).toEqual([{ label: "EV-C2", tipo: "audio", caseCode: "C", nivel: "indicios_fuertes" }]);
    expect(flaggedInLink(byLabel("VIN-3")).map((f) => f.label)).toEqual(["EV-F2"]);
    // Indicios débiles (EV-B3, en VIN-1) no disparan la advertencia.
    expect(byLabel("VIN-1").case_b.evidencia.find((e) => e.label === "EV-B3")!.autenticidad!.nivel).toBe("indicios_debiles");
    const chip = visibleText(renderToStaticMarkup(<AuthenticityWarningChip flagged={flaggedInLink(byLabel("VIN-3"))} />));
    expect(chip).toBe("EV-F2: indicios de IA");
    expect(renderToStaticMarkup(<AuthenticityWarningChip flagged={[]} />)).toBe("");
  });

  it("la voz de VIN-2 pesa la mitad por la voz sintética de EV-C2", () => {
    const voz = byLabel("VIN-2").signals.voz!;
    expect(voz.voz_sintetica).toEqual({ evidencia: ["EV-C2"], factor: 0.5, p_sin_ajuste: 0.16 });
    expect(voz.p).toBeCloseTo(voz.voz_sintetica!.p_sin_ajuste * voz.voz_sintetica!.factor, 6);
  });
});

describe("señales por fuente", () => {
  it("dice lo que se revisó y lo que no", () => {
    const lines = sourceLines(AUTENTICIDAD["EV-C2"]!);
    expect(lines.map((l) => l.fuente)).toEqual([
      "Marca de agua (audioseal)",
      "Credenciales C2PA",
      "Metadatos",
      "Detector de voz sintética",
      "Análisis forense (muse-spark-1.2)",
    ]);
    expect(lines[0]).toEqual({ fuente: "Marca de agua (audioseal)", estado: "No detectada", alerta: false });
    expect(lines.at(-1)).toMatchObject({ estado: "Indicios fuertes de IA", alerta: true });

    const sinMl = sourceLines({ ...AUTENTICIDAD["EV-F2"]!, tecnicas: { watermark: null, c2pa: null, metadata: null, synthetic_speech: null }, forense: null });
    expect(sinMl.map((l) => l.estado)).toEqual(["No se pudo revisar", "No se pudieron revisar", "No se pudieron revisar", "No disponible"]);
  });

  it("solo la marca de agua o C2PA hablan de 'generado con IA'", () => {
    expect(NIVEL_META.generado_ia_confirmado.sentence).toMatch(/marca de agua|C2PA/);
    for (const n of ["sin_senales", "indicios_debiles", "indicios_fuertes"] as const) expect(NIVEL_META[n].sentence).not.toMatch(/fue generado con IA\b/);
  });
});

describe("panel de autenticidad", () => {
  it("muestra nivel, señales, explicación, limitaciones y la nota fija", () => {
    const r = AUTENTICIDAD["EV-F2"]!;
    const text = visibleText(renderToStaticMarkup(<AuthenticityPanel result={r} tipo="imagen" />));
    expect(text).toContain("Indicios fuertes de IA");
    expect(text).toContain("Marca de agua (videoseal)");
    expect(text).toContain("La sombra de la bala va en otra dirección");
    expect(text).toContain(r.forense!.explicacion);
    expect(text).toContain(r.forense!.limitaciones);
    expect(text).toContain(NOTA_AUSENCIA);
  });

  it("la nota aparece también sin análisis y con 'sin señales'", () => {
    expect(visibleText(renderToStaticMarkup(<AuthenticityPanel result={null} tipo="audio" />))).toContain(NOTA_AUSENCIA);
    const limpio = visibleText(renderToStaticMarkup(<AuthenticityPanel result={AUTENTICIDAD["EV-A1"]!} tipo="audio" />));
    expect(limpio).toContain("Sin señales de IA");
    expect(limpio).toContain(NOTA_AUSENCIA);
  });

  it("el indicador corto distingue 'sin analizar' de 'sin señales' y no se muestra para texto", () => {
    expect(visibleText(renderToStaticMarkup(<AuthenticityBadge nivel={null} />))).toBe("Sin analizar");
    expect(visibleText(renderToStaticMarkup(<AuthenticityBadge nivel="sin_senales" />))).toBe("Sin señales de IA");
    expect(renderToStaticMarkup(<AuthenticityBadge nivel={undefined} />)).toBe("");
  });

  it("la cita de una evidencia lleva su autenticidad (vista de vínculo y de caso)", () => {
    const fromLink = indexFromLink(byLabel("VIN-2")).get("EV-C2");
    expect(fromLink?.kind === "evidencia" && fromLink.autenticidad?.nivel).toBe("indicios_fuertes");
    const fromCase = indexFromCases([CASES.F!]).get("EV-F2");
    expect(fromCase?.kind === "evidencia" && fromCase.autenticidad?.nivel).toBe("indicios_fuertes");
    const texto = indexFromCases([CASES.F!]).get("EV-F1");
    expect(texto?.kind === "evidencia" && texto.autenticidad).toBeUndefined();
  });
});
