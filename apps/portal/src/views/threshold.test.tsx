import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { cellsFor, perCell, trendSummary } from "../components/Ledger";
import { Threshold } from "../components/ui";
import { THRESHOLD_TEXT } from "../config";
import { DEMO_ACCOUNTS, recommendationsBodegas, riskBodegasLimaEste, riskTransporteLimaSur } from "../mock/fixtures";
import { belowThreshold, Panorama } from "./PanoramaView";
import { RecommendationSheet } from "./RecommendationsView";

const bodega = DEMO_ACCOUNTS[0]!.me;
const transporte = DEMO_ACCOUNTS[1]!.me;

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

/** Solo la sección de tendencia semanal del HTML. */
function trendHtml(html: string): string {
  const start = html.indexOf('id="tendencia"');
  const end = html.indexOf('id="modalidades"');
  return html.slice(start, end);
}

/** Texto visible (sin etiquetas) de un HTML, sin la tabla alternativa ni lo que es solo dibujo. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

describe("aviso de umbral", () => {
  it("bajo el umbral no muestra ninguna cifra, solo el texto del umbral", () => {
    const risk = riskTransporteLimaSur();
    expect(belowThreshold(risk)).toBe(true);
    const html = render(<Panorama risk={risk} me={transporte} />);
    const t = text(html);
    expect(t).toContain(THRESHOLD_TEXT);
    expect(t).not.toMatch(/\d+ casos? en los últimos/);
    expect(t).not.toMatch(/el riesgo para .* es (bajo|medio|alto)/);
    // Cada semana se dibuja como ausencia, no como cero.
    expect(trendHtml(html).match(/ledger-absent/g)?.length).toBe(risk.tendencia.length);
    expect(t).not.toMatch(/Casos por semana .* \b0 casos\b/);
  });

  it("aunque la API mande cifras por semana, si el periodo no alcanza el umbral no se dibujan", () => {
    const risk = { ...riskTransporteLimaSur(), tendencia: riskBodegasLimaEste().tendencia };
    const html = render(<Panorama risk={risk} me={transporte} />);
    expect(trendHtml(html).match(/ledger-absent/g)?.length).toBe(risk.tendencia.length);
    expect(text(trendHtml(html))).not.toMatch(/\b[1-9] casos?\b/);
  });

  it("con el umbral cumplido dice el nivel, la cifra y la tendencia, sin el aviso", () => {
    const html = render(<Panorama risk={riskBodegasLimaEste()} me={bodega} />);
    const t = text(html);
    expect(t).toContain("el riesgo para bodegas es medio");
    expect(t).toContain("14 casos en los últimos 28 días");
    expect(t).not.toContain(THRESHOLD_TEXT);
    expect(t).toContain("Los casos por semana subieron de 2 a 5");
    // Las dos semanas sin cifra se dibujan punteadas y la tabla alternativa las nombra.
    expect(trendHtml(html).match(/ledger-absent/g)?.length).toBe(2);
    expect(t).toContain("Sin cifra: menos del mínimo");
  });

  it("el sesgo siempre está a la vista, con o sin cifras", () => {
    for (const [risk, me] of [
      [riskBodegasLimaEste(), bodega],
      [riskTransporteLimaSur(), transporte],
    ] as const) {
      expect(text(render(<Panorama risk={risk} me={me} />))).toContain("puede significar que ahí se denuncia más");
    }
  });

  it("el componente de umbral no repite la frase si la API ya la trae", () => {
    const t = text(render(<Threshold detail={riskTransporteLimaSur().aviso_umbral} />));
    expect(t.split(THRESHOLD_TEXT).length - 1).toBe(1);
    expect(t).toContain("al menos 5 casos de 3 personas distintas");
    expect(text(render(<Threshold />))).toContain("al menos 5 casos de 3 personas distintas");
  });

  it("marca el sector propio y dibuja sin cifra los sectores bajo el umbral", () => {
    const t = text(render(<Panorama risk={riskBodegasLimaEste()} me={bodega} />));
    expect(t).toContain("Bodegas (tu sector)");
    expect(t).toMatch(/Restaurantes Sin cifra/);
  });
});

describe("recomendaciones", () => {
  it("van por prioridad: lo urgente primero, con numeración continua", () => {
    const rec = recommendationsBodegas()[0]!;
    const t = text(render(<RecommendationSheet rec={rec} />));
    const iAlta = t.indexOf("Haz esto primero");
    const iMedia = t.indexOf("Después");
    const iBaja = t.indexOf("Cuando puedas");
    expect(iAlta).toBeGreaterThan(-1);
    expect(iAlta).toBeLessThan(iMedia);
    expect(iMedia).toBeLessThan(iBaja);
    // "Aprende a reconocer el guion" viene primero en los datos, pero es de prioridad media.
    expect(t.indexOf("No respondas ni negocies")).toBeLessThan(t.indexOf("Aprende a reconocer el guion"));
    const html = render(<RecommendationSheet rec={rec} />);
    expect(html).toContain('start="4"');
  });

  it("siempre muestran 105 y 1818 en “Si te pasa”", () => {
    const t = text(render(<RecommendationSheet rec={recommendationsBodegas()[0]!} />));
    expect(t).toContain("105");
    expect(t).toContain("1818");
    expect(t).toContain("habla con el jefe");
  });
});

describe("gráfico de renglones", () => {
  it("cada cuadro es un caso hasta 10; después cada cuadro vale más", () => {
    expect(perCell([{ key: "a", label: "a", value: 5 }])).toBe(1);
    expect(perCell([{ key: "a", label: "a", value: 25 }])).toBe(3);
    expect(cellsFor(0, 1)).toBe(0);
    expect(cellsFor(1, 3)).toBe(1);
    expect(cellsFor(25, 3)).toBe(8);
  });

  it("resume la tendencia en una frase", () => {
    expect(trendSummary([{ semana: "2026-10-19", casos: null }])).toMatch(/Todavía no hay semanas/);
    expect(
      trendSummary([
        { semana: "2026-10-12", casos: 4 },
        { semana: "2026-10-19", casos: 2 },
        { semana: "2026-10-26", casos: null },
      ]),
    ).toBe("Los casos por semana bajaron de 4 a 2 entre la semana del 12 de octubre y la del 19 de octubre. Una semana no tiene cifra.");
  });
});
