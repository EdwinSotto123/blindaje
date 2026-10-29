import * as S from "@blindaje/shared";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { MemoryTokenStore } from "../api/client";
import { HttpApi } from "../api/httpApi";
import type { NetworkSummary } from "../api/types";
import { mockConsoleZones } from "../mock/zonesMock";
import { BIAS_NOTE, buildCells, cellLabel, neighbor, trendOf, ZoneDetail, ZoneNotes, ZonesBody, ZoneTable, type ZoneCell } from "./ZonesView";

const NOW = new Date("2026-10-28T15:00:00Z");
const data = mockConsoleZones(28, NOW, ["R-001", "R-002"]);
const cells = buildCells(data);
const cell = (id: string) => cells.find((c) => c.district.id === id)!;
const NETS: NetworkSummary[] = [
  { id: "net-1", label: "R-001", n_cases: 3, sectores: [], periodo: null, updated_at: "2026-10-20T15:00:00Z", profile_status: null },
  { id: "net-2", label: "R-002", n_cases: 2, sectores: [], periodo: null, updated_at: "2026-10-01T15:00:00Z", profile_status: null },
];

const html = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");

/** El HTML del botón de un distrito en la grilla. */
function cellButton(markup: string, name: string): string {
  const m = new RegExp(`<button[^>]*aria-label="${name}:[^"]*"[^>]*>(.*?)</button>`).exec(markup);
  if (!m) throw new Error(`No está el cuadro de ${name}`);
  return m[0];
}

function body(selected: string | null, canNetworks = true) {
  return html(
    <ZonesBody data={data} cells={cells} selected={selected ? S.districtById(selected) : null} onSelect={() => {}} networks={NETS} canNetworks={canNetworks} />,
  );
}

describe("grilla de distritos", () => {
  it("dibuja los 50 distritos en su lugar de la grilla esquemática, sin coordenadas", () => {
    const markup = body("san-juan-de-lurigancho");
    expect(markup.match(/class="zone-cell"/g)).toHaveLength(50);
    // SJL está en la columna 5 y la fila 3 (base 0) de DISTRICTS.
    expect(cellButton(markup, "San Juan de Lurigancho")).toContain("grid-column:6;grid-row:4");
    expect(markup).not.toMatch(/\blat\b|\blng\b|latitud|longitud|coordenada/i);
  });

  it("muestra la cifra y la tendencia solo sobre el umbral", () => {
    const markup = body(null);
    const sjl = cellButton(markup, "San Juan de Lurigancho");
    expect(text(sjl)).toContain("14");
    expect(sjl).toContain('data-trend="sube"');
    expect(sjl).toContain('aria-label="San Juan de Lurigancho: 14 casos en 28 días, sube frente al periodo anterior"');
  });

  it("bajo el umbral no muestra ningún número: se ve igual que un distrito sin casos", () => {
    const markup = body(null);
    // Carabayllo: 6 casos de solo 2 víctimas. Callao: 4 casos. Miraflores: ninguno.
    for (const name of ["Carabayllo", "Callao", "Miraflores"]) {
      const b = cellButton(markup, name);
      expect(b).toContain(`aria-label="${name}: sin datos suficientes"`);
      expect(b).toContain('data-level="0"');
      expect(text(b).trim()).toBe(`${S.DISTRICTS.find((d) => d.name === name)!.short} sin datos`);
    }
  });

  it("aunque la API marque mal una fila, el umbral se vuelve a revisar", () => {
    const bad: S.ConsoleZones = { ...data, filas: [{ distrito: "lince", casos: 4, victimas: 4, casos_previos: 1, redes: ["R-009"], modalidades: ["x"], sobre_umbral: true }] };
    expect(buildCells(bad).find((c) => c.district.id === "lince")!.row).toBeNull();
  });

  it("las flechas llevan al distrito vecino", () => {
    const sjl = S.districtById("san-juan-de-lurigancho")!;
    expect(neighbor(sjl, "ArrowRight")?.id).toBe("lurigancho");
    expect(neighbor(sjl, "ArrowDown")?.id).toBe("el-agustino");
    expect(neighbor(S.districtById("ancon")!, "ArrowUp")).toBeNull();
  });

  it("la tendencia compara con el periodo anterior del mismo largo", () => {
    expect(trendOf(14, 8)).toBe("sube");
    expect(trendOf(7, 10)).toBe("baja");
    expect(trendOf(6, 6)).toBe("estable");
    expect(trendOf(6, 5)).toBe("estable");
    expect(trendOf(5, 0)).toBe("sube");
    expect(cellLabel(cell("miraflores"), 28)).toBe("Miraflores: sin datos suficientes");
  });
});

describe("detalle del distrito", () => {
  it("con datos: casos, víctimas, tendencia, redes enlazadas y modalidades", () => {
    const t = text(body("san-juan-de-lurigancho"));
    expect(t).toContain("14 casos en los últimos 28 días");
    expect(t).toContain("Víctimas distintas 11");
    expect(t).toContain("Periodo anterior 8 casos");
    expect(t).toContain("Sube");
    expect(t).toContain("Audios que dicen ser de “Los X”");
    expect(body("san-juan-de-lurigancho")).toContain('href="/redes/net-1"');
  });

  it("sin acceso a redes (revisión), la red se nombra pero no se enlaza", () => {
    const markup = body("san-juan-de-lurigancho", false);
    expect(text(markup)).toContain("R-001");
    expect(markup).not.toContain('href="/redes/');
  });

  it("bajo el umbral no hay cifras, redes ni modalidades", () => {
    const markup = html(<ZoneDetail cell={cell("carabayllo")} dias={28} networks={NETS} canNetworks />);
    const t = text(markup);
    expect(t).toContain("Sin datos suficientes");
    expect(t).not.toContain("6 casos");
    expect(markup).not.toContain("/redes/");
    expect(t).not.toMatch(/Víctimas distintas/);
  });

  it("el periodo anterior bajo el umbral no se da en cifra", () => {
    const vic: ZoneCell = { ...cell("villa-el-salvador") };
    expect(vic.row!.casos_previos).toBeLessThan(S.MIN_CASES_FOR_STATS);
    expect(text(html(<ZoneDetail cell={vic} dias={28} networks={[]} canNetworks={false} />))).toContain("Periodo anterior menos de 5 casos");
  });
});

describe("nota de sesgo, umbral y tabla", () => {
  it("la nota de sesgo y la regla del umbral están siempre a la vista, sin total de la ciudad", () => {
    const t = text(html(<ZoneNotes />));
    expect(t).toContain(BIAS_NOTE);
    expect(t).toContain("al menos 5 casos de 3 víctimas distintas");
    expect(t).toContain("No mostramos el total de la ciudad");
    // También en el detalle de cada distrito.
    expect(text(body("comas"))).toContain(BIAS_NOTE);
    const total = data.filas.reduce((s, f) => s + f.casos, 0);
    expect(text(body(null))).not.toContain(` ${total} `);
  });

  it("la tabla tiene los mismos 50 distritos, con cifras solo sobre el umbral", () => {
    const markup = html(<ZoneTable cells={cells} dias={28} networks={NETS} />);
    expect(markup.match(/<th scope="row"/g)).toHaveLength(50);
    expect(markup).toContain("<caption");
    const rowOf = (name: string) => new RegExp(`<tr><th scope="row"[^>]*>${name}</th>(.*?)</tr>`).exec(markup)![1]!;
    expect(text(rowOf("San Juan de Lurigancho"))).toMatch(/Lima Este 14 11 ↑ sube R-001/);
    expect(text(rowOf("Carabayllo"))).toBe(" Lima Norte Sin datos suficientes ");
    // Primero los distritos con cifras, de más a menos casos.
    expect(markup.indexOf(">San Juan de Lurigancho<")).toBeLessThan(markup.indexOf(">Ate<"));
    expect(markup.indexOf(">Los Olivos<")).toBeLessThan(markup.indexOf(">Ancón<"));
  });
});

describe("API de zonas", () => {
  it("pide GET /v1/console/zones?dias= y valida la respuesta con shared", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(mockConsoleZones(14, NOW, [])), { status: 200, headers: { "content-type": "application/json" } });
    });
    const api = new HttpApi("https://api.blindaje.test", new MemoryTokenStore({ accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 600_000 }), fetchImpl);
    const z = await api.zones(14);
    expect(urls).toEqual(["https://api.blindaje.test/v1/console/zones?dias=14"]);
    expect(z.periodo_dias).toBe(14);
  });
});
