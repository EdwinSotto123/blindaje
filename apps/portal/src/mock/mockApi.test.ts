import * as S from "@blindaje/shared";
import { COUNT_BANDS, countBand, DISTRICTS } from "@blindaje/shared";
import { describe, expect, it } from "vitest";
import { CASOS_FICTICIOS, publicAlerts, publicRecommendations, publicRisk, publicZones } from "./fixtures";
import { MockPortalApi } from "./mockApi";

function api() {
  return new MockPortalApi({ latency: 0 });
}

/** Todo el texto de un objeto, para buscar lo que nunca debe aparecer. */
function allText(value: unknown): string {
  return JSON.stringify(value);
}

/** Los campos numéricos de un objeto, con su ruta: en lo público solo puede haber periodo y umbral. */
function numericPaths(value: unknown, path = ""): string[] {
  if (typeof value === "number") return [path];
  if (Array.isArray(value)) return value.flatMap((v) => numericPaths(v, `${path}[]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => numericPaths(v, path ? `${path}.${k}` : k));
  return [];
}

const ARRIBA = Object.entries(CASOS_FICTICIOS)
  .filter(([, z]) => countBand(z.total[0], z.total[1]) !== null)
  .map(([id]) => id);
const DEBAJO = Object.entries(CASOS_FICTICIOS)
  .filter(([, z]) => countBand(z.total[0], z.total[1]) === null)
  .map(([id]) => id);

describe("fixtures del modo simulado", () => {
  it("cumplen el contrato de @blindaje/shared", () => {
    expect(S.PublicZoneMap.safeParse(publicZones()).success).toBe(true);
    for (const d of DISTRICTS) {
      expect(S.PublicRiskOverview.safeParse(publicRisk(d.id)).success, d.id).toBe(true);
      expect(S.PublicRiskOverview.safeParse(publicRisk(d.id, "bodega")).success, d.id).toBe(true);
      for (const a of publicAlerts(d.id)) expect(S.VictimAlert.safeParse(a).success).toBe(true);
      for (const r of publicRecommendations(d.id)) expect(S.BusinessRecommendationView.safeParse(r).success).toBe(true);
    }
  });

  it("usan distritos reales, con algunos sobre el umbral y otros con casos pero debajo", () => {
    for (const id of Object.keys(CASOS_FICTICIOS)) expect(S.districtById(id), id).not.toBeNull();
    expect(ARRIBA.length).toBeGreaterThanOrEqual(5);
    expect(DEBAJO.length).toBeGreaterThanOrEqual(3);
    // Hay un distrito con 5 casos o más pero menos de 3 personas: el umbral es de casos y de víctimas.
    expect(DEBAJO.some((id) => CASOS_FICTICIOS[id]!.total[0] >= 5)).toBe(true);
  });

  it("cuentan la historia de “Los X”: Yape, 48 horas y “habla con el jefe”", () => {
    const text = allText([publicRisk("ate", "bodega"), publicRecommendations("ate"), publicAlerts("ate")]);
    expect(text).toContain("Los X");
    expect(text).toContain("Yape");
    expect(text).toContain("48 horas");
    expect(text.toLowerCase()).toContain("habla con el jefe");
  });

  it("nunca traen números, cuentas, citas internas ni gremios, y nunca aconsejan pagar", () => {
    const text = allText([...DISTRICTS.flatMap((d): unknown[] => [publicRisk(d.id), publicRecommendations(d.id), publicAlerts(d.id)]), publicZones()]);
    // Fechas aparte, ninguna secuencia de 7 dígitos o más (teléfonos, cuentas).
    expect(text.replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, "")).not.toMatch(/\d[\d\s-]{6,}\d/);
    expect(text).not.toMatch(/\b(VIN|FICHA|EV|ID)-[A-Za-z0-9]/);
    expect(text).not.toMatch(/\bR-\d/);
    expect(text).not.toMatch(/gremio|asociad|dirigente/i);
    // Pagar o negociar solo aparece negado ("No pagues ni negocies", "nadie paga ni negocia").
    for (const m of text.matchAll(/(?:(\p{L}+)\s+)?(?<!\p{L})(paga|pagues|pagar|págales|negocia|negocies|negociar)(?!\p{L})/giu)) {
      expect(["no", "ni", "nadie", "nunca"], m[0]).toContain((m[1] ?? "").toLowerCase());
    }
  });

  it("el mapa: los 50 distritos, solo rangos, y bajo el umbral igual que sin casos", () => {
    const map = publicZones();
    expect(map.celdas.map((c) => c.distrito)).toEqual(DISTRICTS.map((d) => d.id));
    // Ningún número salvo el periodo y el umbral: ni cifras ni totales.
    expect(numericPaths(map).sort()).toEqual(["periodo_dias", "umbral.casos", "umbral.victimas"]);
    expect(Object.keys(map)).not.toContain("total");
    for (const c of map.celdas) {
      if (c.casos !== null) expect(COUNT_BANDS).toContain(c.casos);
      if (c.nivel === "sin_datos") expect(c).toEqual({ distrito: c.distrito, nivel: "sin_datos", casos: null, tendencia: null, modalidades: [] });
    }
    const cell = (id: string) => map.celdas.find((c) => c.distrito === id)!;
    for (const id of ARRIBA) expect(cell(id).nivel, id).not.toBe("sin_datos");
    // Brena tiene casos y una modalidad, pero no llega al umbral: idéntica a un distrito sin casos.
    for (const id of DEBAJO) expect({ ...cell(id), distrito: "x" }, id).toEqual({ ...cell("pucusana"), distrito: "x" });
  });

  it("el panorama de una zona: rangos por parte, sin total que reste ni cubo de otros", () => {
    for (const d of DISTRICTS) {
      for (const sector of [null, "bodega", "mototaxi", "transporte"]) {
        const r = publicRisk(d.id, sector);
        expect(numericPaths(r), `${d.id}/${sector}`).toEqual(["periodo_dias"]);
        for (const s of r.sectores_afectados) expect(s.sector).not.toMatch(/otros|varios|agregad/i);
        if (r.nivel_riesgo === "sin_datos") {
          expect(r.casos_periodo).toBeNull();
          expect(r.tendencia.every((t) => t.casos === null)).toBe(true);
          // Bajo el umbral no se nombra ningún rubro ni modalidad: ya diría que alguien denunció.
          expect(r.sectores_afectados).toEqual([]);
          expect(r.modalidades_activas).toEqual([]);
          expect(r.aviso_umbral).toMatch(/Aún no hay suficientes casos para mostrar cifras/);
        }
      }
    }
    // Ate pasa el umbral; Brena tiene 6 casos de 2 personas y no.
    expect(publicRisk("ate").casos_periodo).toBe("10-19");
    expect(publicRisk("brena").nivel_riesgo).toBe("sin_datos");
    // El mercado de Ate (1 caso) no aparece, ni sumado con otros.
    expect(publicRisk("ate").sectores_afectados.map((s) => s.sector)).toEqual(["bodega", "mototaxi"]);
  });

  it("siempre explicita el sesgo y marca la demostración", () => {
    expect(publicZones().nota_sesgo).toMatch(/se denuncia más/);
    expect(publicZones().demo).toBe(true);
    for (const d of DISTRICTS) {
      expect(publicRisk(d.id).sesgo).toMatch(/se denuncia más/);
      expect(publicRisk(d.id).demo).toBe(true);
    }
  });
});

describe("MockPortalApi", () => {
  it("no pide cuenta: entrega el mapa y el panorama sin sesión", async () => {
    const a = api();
    expect((await a.zones()).celdas).toHaveLength(50);
    expect((await a.risk({ zona: "ate" })).nivel_riesgo).toBe("alto");
  });

  it("con rubro da el panorama del rubro; si el rubro no llega al umbral, el de todo el distrito con aviso", async () => {
    const a = api();
    const bodega = await a.risk({ zona: "ate", sector: "bodega" });
    expect([bodega.zona, bodega.sector, bodega.casos_periodo]).toEqual(["ate", "bodega", "10-19"]);
    const mercado = await a.risk({ zona: "ate", sector: "mercado" });
    expect(mercado.sector).toBeNull();
    expect(mercado.aviso_umbral).toMatch(/de tu rubro/);
    expect(mercado.casos_periodo).toBe("10-19");
  });

  it("avisos y consejos van por distrito (y rubro), solo los aprobados de ese distrito", async () => {
    const a = api();
    const ate = await a.alerts({ zona: "ate" });
    expect(ate.map((x) => x.id)).toEqual(["alert-ate-2", "alert-ate-1"]);
    expect(ate.every((x) => x.zona === "ate")).toBe(true);
    expect(await a.alerts({ zona: "miraflores" })).toEqual([]);
    expect((await a.recommendations({ zona: "ate" })).length).toBe(2);
    expect((await a.recommendations({ zona: "ate", sector: "bodega" })).length).toBe(2);
    expect(await a.recommendations({ zona: "ate", sector: "mototaxi" })).toEqual([]);
    expect((await a.recommendations({ zona: "san-juan-de-lurigancho" }))[0]!.sector).toBe("transporte");
  });

  it("rechaza un distrito o un rubro que no están en la lista", async () => {
    const a = api();
    await expect(a.risk({ zona: "Lima Este" })).rejects.toMatchObject({ status: 400 });
    await expect(a.risk({ zona: "ate", sector: "banco" })).rejects.toMatchObject({ status: 400 });
  });

  it("no expone ninguna búsqueda por número, cuenta ni placa, ni sesión", () => {
    const methods = Object.getOwnPropertyNames(MockPortalApi.prototype).join(" ");
    expect(methods).not.toMatch(/search|buscar|lookup|numero|cuenta|placa|login|logout|session/i);
  });
});
