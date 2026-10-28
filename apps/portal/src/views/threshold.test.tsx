import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { cellLines, trendSummary } from "../components/Ledger";
import { Threshold } from "../components/ui";
import { THRESHOLD_TEXT } from "../config";
import { sectorKey, sectorLabel } from "../lib/format";
import { alertsBodegas, DEMO_ACCOUNTS, recommendationsBodegas, riskBodegasLimaEste, riskTransporteLimaSur } from "../mock/fixtures";
import { alertsAnswer, isRecent } from "./AlertsView";
import { belowThreshold, Panorama } from "./PanoramaView";
import { RecommendationSheet, urgentAnswer } from "./RecommendationsView";

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

/** Texto visible (sin etiquetas) de un HTML. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

describe("aviso de umbral", () => {
  it("bajo el umbral no muestra ninguna cifra ni gráfico: la respuesta, el aviso y qué hacer", () => {
    const risk = riskTransporteLimaSur();
    expect(belowThreshold(risk)).toBe(true);
    const html = render(<Panorama risk={risk} me={transporte} />);
    const t = text(html);
    expect(t).toContain(THRESHOLD_TEXT);
    expect(t).toContain("todavía no podemos decirte el nivel de riesgo");
    expect(t).not.toMatch(/\d+ casos? en los últimos/);
    expect(t).not.toMatch(/el riesgo para .* es (bajo|medio|alto)/);
    // Sin andamiaje vacío: ni gráfico, ni tabla, ni nombres de rubros; una sola hoja punteada.
    expect(html).not.toContain("ledger");
    expect(html).toContain('class="pending"');
    expect(t).toContain("¿Y ahora qué hago?");
  });

  it("aunque la API mandara cifras por semana, si el periodo no alcanza el umbral no se dibujan", () => {
    const risk = { ...riskTransporteLimaSur(), tendencia: riskBodegasLimaEste().tendencia };
    const html = render(<Panorama risk={risk} me={transporte} />);
    expect(html).not.toContain("ledger");
    expect(text(html)).not.toMatch(/\b\d+ casos\b(?! de 3)/);
  });

  it("con el umbral cumplido dice el nivel, la cifra y la tendencia, sin el aviso", () => {
    const html = render(<Panorama risk={riskBodegasLimaEste()} me={bodega} latestAlert={alertsBodegas()[0]} />);
    const t = text(html);
    expect(t).toContain("el riesgo para bodegas es medio");
    expect(t).toContain("14 casos en los últimos 28 días");
    expect(t).not.toContain(THRESHOLD_TEXT);
    expect(t).toContain("Los casos por semana subieron de 5 a 6");
    expect(t).toContain("Último aviso de tu gremio");
    // Las dos semanas que no llegan al mínimo se dibujan punteadas y la tabla alternativa lo dice.
    expect(trendHtml(html).match(/ledger-absent/g)?.length).toBe(2);
    expect(t).toContain("Sin cifra: menos del mínimo");
    // Un cuadro por caso: 5 + 6 cuadros pintados en la tendencia.
    expect(trendHtml(html).match(/<i><\/i>/g)?.length).toBe(11);
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
    expect(t).toContain("Hacen falta al menos 5 casos de 3 personas distintas en la zona.");
    expect(text(render(<Threshold />))).toContain("al menos 5 casos de 3 personas distintas");
  });

  it("marca el rubro propio y deja sin cifra el agregado de otros rubros", () => {
    const t = text(render(<Panorama risk={riskBodegasLimaEste()} me={bodega} />));
    expect(t).toContain("Bodegas (tu rubro)");
    expect(t).toMatch(/Otros rubros \(agregado\) Sin cifra/);
  });

  it("con cifras de la zona y el rubro bajo el umbral, muestra la cifra y el aviso, no el bloque sin cifras", () => {
    const risk = {
      ...riskBodegasLimaEste(),
      sector: null,
      aviso_umbral: "Aún no hay suficientes casos de tu rubro en esta zona para mostrar cifras propias: las cifras son de toda la zona.",
    };
    const t = text(render(<Panorama risk={risk} me={bodega} />));
    expect(t).toContain("el riesgo para todos los rubros es medio");
    expect(t).toContain("las cifras son de toda la zona");
    expect(t).not.toContain(THRESHOLD_TEXT);
  });
});

describe("recomendaciones", () => {
  it("van por prioridad: lo urgente primero, con numeración continua", () => {
    const rec = recommendationsBodegas()[0]!;
    const html = render(<RecommendationSheet rec={rec} />);
    const t = text(html);
    const iAlta = t.indexOf("Haz esto primero");
    const iMedia = t.indexOf("Después");
    const iBaja = t.indexOf("Cuando puedas");
    expect(iAlta).toBeGreaterThan(-1);
    expect(iAlta).toBeLessThan(iMedia);
    expect(iMedia).toBeLessThan(iBaja);
    // "Aprende a reconocer el guion" viene primero en los datos, pero es de prioridad media.
    expect(t.indexOf("No respondas ni negocies")).toBeLessThan(t.indexOf("Aprende a reconocer el guion"));
    expect(html).toContain('start="4"');
    expect(urgentAnswer(rec)).toBe("Lo más urgente: No respondas ni negocies.");
  });

  it("siempre muestran 105 y 1818 en “Si te pasa” y nunca citas internas", () => {
    const t = text(render(<RecommendationSheet rec={recommendationsBodegas()[0]!} />));
    expect(t).toContain("105");
    expect(t).toContain("1818");
    expect(t).toContain("habla con el jefe");
    expect(t).not.toMatch(/\b(VIN|FICHA|EV)-|\bR-\d/);
  });
});

describe("alertas", () => {
  it("responden “¿hay algo nuevo?” en una frase y marcan lo de esta semana", () => {
    const now = Date.parse("2026-10-28T15:00:00Z");
    const [nueva, vieja] = alertsBodegas();
    expect(isRecent(nueva!, now)).toBe(true);
    expect(isRecent(vieja!, now)).toBe(false);
    expect(alertsAnswer(alertsBodegas(), now)).toBe("Tu gremio te envió 2 avisos. 1 es de esta semana.");
  });
});

describe("gráfico de renglones", () => {
  it("siempre un cuadro por caso, de 10 en 10 por renglón", () => {
    expect(cellLines(5)).toBe(1);
    expect(cellLines(10)).toBe(1);
    expect(cellLines(14)).toBe(2);
  });

  it("resume la tendencia en una frase", () => {
    expect(trendSummary([{ semana: "2026-10-21", casos: null }])).toMatch(/Todavía no hay semanas/);
    expect(
      trendSummary([
        { semana: "2026-10-07", casos: 8 },
        { semana: "2026-10-14", casos: 6 },
        { semana: "2026-10-21", casos: null },
      ]),
    ).toBe("Los casos por semana bajaron de 8 a 6 entre la semana del 7 de octubre y la del 14 de octubre. Una semana no llega al mínimo y va sin cifra.");
  });
});

describe("rubros", () => {
  it("lee el rubro de la API (en singular) en plural, y compara sin tildes ni plural", () => {
    expect(sectorLabel("bodega")).toBe("bodegas");
    expect(sectorLabel("Mototaxi")).toBe("mototaxis");
    expect(sectorLabel("construccion")).toBe("construcción");
    expect(sectorLabel("Otros rubros (agregado)")).toBe("otros rubros (agregado)");
    expect(sectorKey("Bodegas")).toBe(sectorKey("bodega"));
    expect(sectorKey("Construcción")).toBe(sectorKey("construccion"));
  });
});
