import { districtById, ZONE_AREAS } from "@blindaje/shared";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { documentTitle } from "../App";
import { AppProviders } from "../app/context";
import { THRESHOLD_RULE } from "../config";
import { choiceSearch, filterDistricts, readChoice } from "../lib/choice";
import { MockPortalApi } from "../mock/mockApi";
import { publicZones } from "../mock/fixtures";
import { MapPage } from "./MapView";
import { DistrictPicker, PickerView } from "./PickerView";
import { HomeView } from "./ZoneView";

function render(node: ReactNode, url = "/"): string {
  return renderToStaticMarkup(
    <AppProviders api={new MockPortalApi({ latency: 0 })}>
      <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>
    </AppProviders>,
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:])/g, "$1");
}

/** Solo la grilla del mapa. */
function gridHtml(html: string): string {
  const start = html.indexOf('class="zmap-grid"');
  return html.slice(start, html.indexOf("</ul>", start));
}

/** El enlace de un distrito dentro de la grilla. */
function cellHtml(html: string, id: string): string {
  const grid = gridHtml(html);
  const at = grid.indexOf(`href="/?distrito=${id}`);
  const start = grid.lastIndexOf("<a", at);
  return grid.slice(start, grid.indexOf("</a>", at) + 4);
}

describe("elegir distrito y rubro", () => {
  it("la elección vive en la URL y se ignora lo que no está en la lista", () => {
    const c = readChoice(new URLSearchParams("distrito=ate&rubro=bodega"));
    expect([c.distrito?.name, c.rubro]).toEqual(["Ate", "bodega"]);
    expect(readChoice(new URLSearchParams("distrito=lima-este&rubro=banco"))).toEqual({ distrito: null, rubro: null });
    expect(choiceSearch({ distrito: "ate", rubro: "bodega" })).toBe("?distrito=ate&rubro=bodega");
    expect(choiceSearch({ distrito: "ate", rubro: null })).toBe("?distrito=ate");
    expect(choiceSearch({ distrito: "Calle Falsa 123" })).toBe("");
  });

  it("busca sin tildes y con nombres de uso común, agrupando por área", () => {
    const all = filterDistricts("");
    expect(all.map((g) => g.area)).toEqual([...ZONE_AREAS]);
    expect(all.reduce((n, g) => n + g.districts.length, 0)).toBe(50);
    expect(filterDistricts("rimac").flatMap((g) => g.districts.map((d) => d.id))).toEqual(["rimac"]);
    expect(filterDistricts("Surco").flatMap((g) => g.districts.map((d) => d.id))).toContain("santiago-de-surco");
    expect(filterDistricts("san juan").flatMap((g) => g.districts.map((d) => d.id))).toEqual(["san-juan-de-lurigancho", "san-juan-de-miraflores"]);
    expect(filterDistricts("zzz")).toEqual([]);
  });

  it("cada distrito del selector es un enlace que ya lleva el rubro elegido", () => {
    const html = render(<DistrictPicker rubro="bodega" onRubro={() => {}} current="ate" />);
    const links = html.match(/href="\/\?distrito=[a-z-]+&amp;rubro=bodega"/g) ?? [];
    expect(links).toHaveLength(50);
    expect(html).toMatch(/<a [^>]*aria-current="true"[^>]*href="\/\?distrito=ate&amp;rubro=bodega"|<a [^>]*href="\/\?distrito=ate&amp;rubro=bodega"[^>]*aria-current="true"/);
    for (const area of ZONE_AREAS) expect(html).toContain(`>${area}</h2>`);
    expect(text(html)).toContain("Mira el mapa de Lima y el Callao");
  });

  it("filtra con la búsqueda y dice cuántos coinciden", () => {
    const t = text(render(<DistrictPicker rubro={null} onRubro={() => {}} current={null} initialQuery="san" />));
    expect(t).toContain("distritos coinciden");
    expect(t).toContain("San Isidro");
    expect(t).not.toContain("Ancón");
  });

  it("“/” sin distrito muestra el selector; con distrito, Mi zona; con uno que no existe, el selector y un aviso", () => {
    expect(text(render(<HomeView />, "/"))).toContain("¿Qué zona quieres ver?");
    const zona = text(render(<HomeView />, "/?distrito=ate&rubro=bodega"));
    expect(zona).toContain("Ate");
    expect(zona).toContain("Lima Este");
    expect(zona).not.toContain("¿Qué zona quieres ver?");
    expect(text(render(<HomeView />, "/?distrito=calle-123"))).toContain("No encontramos ese distrito");
  });

  it("al cambiar de distrito el selector conserva el rubro de la URL", () => {
    const html = render(<PickerView />, "/elegir?distrito=ate&rubro=mercado");
    expect(html).toMatch(/<option value="mercado" selected="">/);
    expect(html).toContain('href="/?distrito=comas&amp;rubro=mercado"');
  });

  it("el título del documento dice el distrito y la sección", () => {
    expect(documentTitle("/", "")).toBe("Elige tu distrito · Blindaje");
    expect(documentTitle("/", "?distrito=ate")).toBe("Ate · Mi zona · Blindaje");
    expect(documentTitle("/alertas", "?distrito=ate")).toBe("Ate · Alertas · Blindaje");
    expect(documentTitle("/mapa", "?distrito=ate")).toBe("Mapa de Lima y el Callao · Blindaje");
  });
});

describe("mapa público", () => {
  const map = publicZones();

  it("dibuja los 50 distritos en su lugar de la grilla, con leyenda, nota de sesgo y regla del umbral", () => {
    const html = render(<MapPage map={map} selected={null} rubro={null} />, "/mapa");
    expect(gridHtml(html).match(/class="zcell"/g)).toHaveLength(50);
    // La posición sale de DISTRICTS[].col/row: Ancón arriba (fila 1), Pucusana al fondo (fila 14).
    expect(html).toContain('style="grid-column:3;grid-row:1"');
    expect(html).toContain('style="grid-column:9;grid-row:14"');
    const t = text(html);
    for (const l of ["Sin datos", "Bajo", "Medio", "Alto"]) expect(t).toContain(l);
    expect(html).toContain('aria-label="Leyenda del mapa"');
    expect(t).toContain(map.nota_sesgo);
    expect(t).toContain(THRESHOLD_RULE);
    expect(t).toContain("nunca en cifras exactas");
    // La tabla accesible trae los 50 distritos, con su enlace.
    const table = html.slice(html.indexOf('class="ztable"'));
    expect(table.match(/<th scope="row">/g)).toHaveLength(50);
  });

  it("un distrito bajo el umbral se ve igual que uno sin casos: sin rango ni modalidades", () => {
    const html = render(<MapPage map={map} selected={null} rubro={null} />, "/mapa");
    // Breña tiene 6 casos de 2 personas; Pucusana, ninguno.
    const brena = cellHtml(html, "brena");
    const pucusana = cellHtml(html, "pucusana");
    for (const cell of [brena, pucusana]) {
      expect(cell).toContain('data-nivel="sin_datos"');
      expect(cell).not.toContain("zcell-band");
      expect(cell).toContain('<span class="sr-only">: sin datos</span>');
    }
    const strip = (s: string) => s.replace(/brena|pucusana|Breña|Pucusana/g, "X");
    expect(strip(brena)).toBe(strip(pucusana));
    // Sobre el umbral, el rango a la vista (nunca la cifra).
    const ate = cellHtml(html, "ate");
    expect(ate).toContain('data-nivel="alto"');
    expect(ate).toContain('<span class="zcell-band" aria-hidden="true">10-19</span>');
    expect(ate).toContain('<span class="zcell-name">Ate</span><span class="sr-only">: riesgo alto, entre 10 y 19 casos, van en aumento</span>');
    // Ningún cuadro tiene una cifra suelta.
    expect(text(gridHtml(html))).not.toMatch(/\b16\b|\b24\b/);
  });

  it("marca tu distrito y lleva el rubro a cada enlace", () => {
    const html = render(<MapPage map={map} selected={districtById("ate")} rubro="bodega" />, "/mapa?distrito=ate&rubro=bodega");
    expect(cellHtml(html, "ate")).toContain('aria-current="true"');
    expect(text(html)).toContain("Tu distrito (Ate)");
    expect(text(html)).toContain("Ate: riesgo alto, entre 10 y 19 casos.");
    expect(gridHtml(html).match(/&amp;rubro=bodega"/g)).toHaveLength(50);
    const brena = text(render(<MapPage map={map} selected={districtById("brena")} rubro={null} />, "/mapa"));
    expect(brena).toContain("Breña: sin datos.");
  });

  it("los cuadros empiezan su nombre accesible con el nombre visible", () => {
    const html = render(<MapPage map={map} selected={null} rubro={null} />, "/mapa");
    expect(cellHtml(html, "san-juan-de-lurigancho")).toContain('<span class="zcell-name">SJL</span><span class="sr-only"> (San Juan de Lurigancho): riesgo alto');
  });
});
