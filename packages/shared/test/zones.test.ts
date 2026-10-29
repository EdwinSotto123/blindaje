import { describe, expect, it } from "vitest";
import { COUNT_BANDS, DISTRICT_GRID, DISTRICTS, countBand, districtOfZone } from "../src/zones";

describe("zonas", () => {
  it("son los 50 distritos de Lima Metropolitana y el Callao, sin repetir id, ubigeo ni cuadro", () => {
    expect(DISTRICTS).toHaveLength(50);
    expect(new Set(DISTRICTS.map((d) => d.id)).size).toBe(50);
    expect(new Set(DISTRICTS.map((d) => d.ubigeo)).size).toBe(50);
    expect(new Set(DISTRICTS.map((d) => `${d.col},${d.row}`)).size).toBe(50);
    expect(DISTRICTS.filter((d) => d.area === "Callao")).toHaveLength(7);
    for (const d of DISTRICTS) {
      expect(d.col).toBeGreaterThanOrEqual(0);
      expect(d.col).toBeLessThan(DISTRICT_GRID.cols);
      expect(d.row).toBeGreaterThanOrEqual(0);
      expect(d.row).toBeLessThan(DISTRICT_GRID.rows);
    }
  });

  it("reconoce el distrito por id, por nombre con o sin tildes y en el formato Distrito - Celda", () => {
    expect(districtOfZone("san-juan-de-lurigancho")?.id).toBe("san-juan-de-lurigancho");
    expect(districtOfZone("San Juan de Lurigancho - E12")?.id).toBe("san-juan-de-lurigancho");
    expect(districtOfZone("Rimac")?.id).toBe("rimac");
    expect(districtOfZone("Breña")?.id).toBe("brena");
    expect(districtOfZone("Cercado de Lima")?.id).toBe("lima");
    expect(districtOfZone("Lima Este")).toBeNull();
    expect(districtOfZone("")).toBeNull();
  });

  it("publica rangos y nada bajo el umbral de 5 casos de 3 víctimas", () => {
    expect(countBand(4, 4)).toBeNull();
    expect(countBand(9, 2)).toBeNull();
    expect(countBand(5, 3)).toBe("5-9");
    expect(countBand(19, 8)).toBe("10-19");
    expect(countBand(120, 40)).toBe("50+");
    expect(COUNT_BANDS).toHaveLength(4);
  });
});
