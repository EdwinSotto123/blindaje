import { districtById, type District } from "@blindaje/shared";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { bandTrendSummary } from "../components/Bands";
import { Threshold } from "../components/ui";
import { THRESHOLD_TEXT } from "../config";
import { asBand, bandPhrase } from "../lib/bands";
import { sectorKey, sectorLabel } from "../lib/format";
import { AVISO_RUBRO, CASOS_FICTICIOS, publicAlerts, publicRecommendations, publicRisk } from "../mock/fixtures";
import { AlertList, alertsAnswer, isRecent } from "./AlertsView";
import { RecommendationSheet, urgentAnswer } from "./RecommendationsView";
import { belowThreshold, Panorama } from "./ZoneView";

const ate = districtById("ate")!;
const brena = districtById("brena")!;
const sjl = districtById("san-juan-de-lurigancho")!;

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
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function zone(d: District, rubro: "bodega" | "mercado" | null = null, alert = false) {
  const html = render(<Panorama risk={publicRisk(d.id, rubro)} district={d} rubro={rubro} latestAlert={alert ? publicAlerts(d.id)[0] : undefined} />);
  return { html, t: text(html) };
}

describe("Mi zona bajo el umbral", () => {
  it("no muestra ningún rango ni gráfico: la respuesta, el aviso y qué hacer", () => {
    const risk = publicRisk("brena");
    expect(belowThreshold(risk)).toBe(true);
    const { html, t } = zone(brena);
    expect(t).toContain(THRESHOLD_TEXT);
    expect(t).toContain("En Breña, para todos los rubros, todavía no podemos decirte el nivel de riesgo");
    expect(t).toContain("un distrito con pocos casos se ve igual que uno sin casos");
    expect(t).not.toMatch(/entre \d+ y \d+ casos|\d+ casos o más|\b\d+-\d+\b/);
    expect(t).not.toMatch(/el riesgo para .* es (bajo|medio|alto)/);
    // Sin andamiaje vacío: ni gráfico, ni tabla, ni nombres de rubros; una sola hoja punteada.
    expect(html).not.toContain("ledger");
    expect(html).toContain('class="pending"');
    expect(t).toContain("¿Y ahora qué hago?");
    // Brena tiene 6 casos de 2 personas: la cifra nunca aparece.
    expect(t).not.toMatch(/\b6\b/);
  });

  it("aunque llegaran rangos por semana, si el periodo no alcanza el umbral no se dibujan", () => {
    const risk = { ...publicRisk("brena"), tendencia: publicRisk("ate").tendencia };
    const html = render(<Panorama risk={risk} district={brena} rubro={null} />);
    expect(html).not.toContain("ledger");
    expect(text(html)).not.toMatch(/\b\d+-\d+\b/);
  });

  it("el componente de umbral no repite la frase si la API ya la trae", () => {
    const t = text(render(<Threshold detail={publicRisk("brena").aviso_umbral} />));
    expect(t.split(THRESHOLD_TEXT).length - 1).toBe(1);
    expect(t).toContain("Hacen falta al menos 5 casos de 3 personas distintas en la zona.");
    expect(text(render(<Threshold />))).toContain("al menos 5 casos de 3 personas distintas");
  });
});

describe("Mi zona con el umbral cumplido", () => {
  it("dice el nivel y el rango, nunca la cifra exacta", () => {
    const { t } = zone(ate, null, true);
    expect(t).toContain("En Ate, el riesgo para todos los rubros es alto");
    expect(t).toContain("Entre 10 y 19 casos en los últimos 28 días");
    expect(t).not.toContain(THRESHOLD_TEXT);
    // Ate tiene 16 casos de 11 personas en el modo simulado: ninguna de las dos cifras se ve.
    expect(CASOS_FICTICIOS.ate!.total).toEqual([16, 11]);
    expect(t).not.toMatch(/\b16\b|\b11\b/);
    expect(t).toContain("Último aviso para Ate, aprobado por el equipo de Blindaje");
  });

  it("la tendencia va en rangos: cuatro peldaños por semana, no un cuadro por caso", () => {
    const { html, t } = zone(sjl);
    expect(t).toContain("Los casos por semana subieron del rango de 5 a 9 al de 10 a 19");
    expect(t).toContain("Una semana no llega al mínimo y va sin datos");
    const trend = trendHtml(html);
    // Tres semanas con rango (4 peldaños cada una) y una punteada.
    expect(trend.match(/ledger-absent/g)?.length).toBe(1);
    expect(trend.match(/<i data-on="">|<i><\/i>/g)?.length).toBe(12);
    expect(trend.match(/<i data-on="">/g)?.length).toBe(1 + 1 + 2);
    expect(t).toContain("Sin datos: menos del mínimo");
  });

  it("marca tu rubro y no muestra el cubo de otros rubros", () => {
    const { t } = zone(ate, "bodega");
    expect(t).toContain("el riesgo para bodegas es alto");
    expect(t).toContain("Bodegas (tu rubro)");
    expect(t).toContain("Mototaxis");
    expect(t).not.toMatch(/otros rubros|varios rubros|agregado/i);
    // El mercado de Ate no llega al umbral: no aparece.
    expect(t).not.toMatch(/mercado/i);
  });

  it("con el rubro bajo el umbral, muestra el rango de todo el distrito con el aviso", () => {
    const { t } = zone(ate, "mercado");
    expect(t).toContain("el riesgo para todos los rubros es alto");
    expect(t).toContain(AVISO_RUBRO);
    expect(t).not.toContain(THRESHOLD_TEXT);
  });

  it("el sesgo siempre está a la vista, con o sin datos", () => {
    for (const d of [ate, brena, sjl]) expect(zone(d).t).toContain("puede significar que ahí se denuncia más");
  });

  it("no habla de gremios", () => {
    for (const d of [ate, brena]) expect(zone(d, "bodega", true).t).not.toMatch(/gremio|asociad|dirigente/i);
  });
});

describe("rangos", () => {
  it("se leen en una frase y nunca dejan pasar una cifra", () => {
    expect(bandPhrase("10-19")).toBe("entre 10 y 19 casos");
    expect(bandPhrase("50+")).toBe("50 casos o más");
    expect(asBand("20-49")).toBe("20-49");
    expect(asBand(16)).toBe("10-19");
    expect(asBand(4)).toBeNull();
    expect(asBand("16")).toBeNull();
    expect(asBand(null)).toBeNull();
  });

  it("la tendencia se resume con rangos", () => {
    expect(bandTrendSummary([{ semana: "2026-10-21", casos: null }])).toMatch(/Todavía no hay semanas/);
    expect(
      bandTrendSummary([
        { semana: "2026-10-07", casos: "20-49" },
        { semana: "2026-10-14", casos: "10-19" },
        { semana: "2026-10-21", casos: null },
      ]),
    ).toBe("Los casos por semana bajaron del rango de 20 a 49 al de 10 a 19 entre la semana del 7 de octubre y la del 14 de octubre. Una semana no llega al mínimo y va sin datos.");
  });
});

describe("consejos", () => {
  it("van por prioridad: lo urgente primero, con numeración continua", () => {
    const rec = publicRecommendations("ate")[0]!;
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

  it("los aprueba el equipo de Blindaje, nombran el distrito y siempre muestran 105 y 1818", () => {
    const t = text(render(<RecommendationSheet rec={publicRecommendations("ate")[0]!} />));
    expect(t).toContain("Para bodegas de Ate");
    expect(t).toContain("Aprobado por el equipo de Blindaje");
    expect(t).toContain("105");
    expect(t).toContain("1818");
    expect(t).toContain("habla con el jefe");
    expect(t).not.toMatch(/\b(VIN|FICHA|EV)-|\bR-\d/);
    expect(t).not.toMatch(/gremio/i);
  });
});

describe("alertas", () => {
  const now = Date.parse("2026-10-28T15:00:00Z");

  it("responden “¿hay algo nuevo?” en una frase y marcan lo de esta semana", () => {
    const [nueva, vieja] = publicAlerts("ate");
    expect(isRecent(nueva!, now)).toBe(true);
    expect(isRecent(vieja!, now)).toBe(false);
    expect(alertsAnswer(publicAlerts("ate"), "Ate", now)).toBe("Hay 2 avisos para Ate. 1 es de esta semana.");
  });

  it("muestran solo las del distrito, aprobadas por el equipo de Blindaje", () => {
    const t = text(render(<AlertList alerts={publicAlerts("ate")} district={ate} now={now} />));
    expect(t).toContain("Ate: audios de “Los X” que piden pagos por Yape");
    expect(t).toContain("Aprobado por el equipo de Blindaje el 27 de octubre de 2026 · Ate");
    expect(t).toContain("Nuevo");
    expect(t).not.toMatch(/gremio|asociad/i);
    const vacio = text(render(<AlertList alerts={publicAlerts("miraflores")} district={districtById("miraflores")!} now={now} />));
    expect(vacio).toContain("No hay alertas para Miraflores");
    expect(vacio).toContain("no quiere decir que no pase nada");
  });
});

describe("rubros", () => {
  it("lee el rubro (en singular) en plural, y compara sin tildes ni plural", () => {
    expect(sectorLabel("bodega")).toBe("bodegas");
    expect(sectorLabel("Mototaxi")).toBe("mototaxis");
    expect(sectorLabel("construccion")).toBe("construcción");
    expect(sectorKey("Bodegas")).toBe(sectorKey("bodega"));
    expect(sectorKey("Construcción")).toBe(sectorKey("construccion"));
  });
});
