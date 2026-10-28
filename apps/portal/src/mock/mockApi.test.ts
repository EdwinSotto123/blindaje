import * as S from "@blindaje/shared";
import { describe, expect, it } from "vitest";
import { alertsBodegas, DEMO_ACCOUNTS, DEMO_PASSWORD, recommendationsBodegas, riskBodegasLimaEste, riskLimaEste, riskTransporteLimaSur } from "./fixtures";
import { MockPortalApi } from "./mockApi";

const bodega = DEMO_ACCOUNTS[0]!.me;
const transporte = DEMO_ACCOUNTS[1]!.me;

function api() {
  return new MockPortalApi({ latency: 0, persist: false });
}

/** Todo el texto de un objeto, para buscar lo que nunca debe aparecer. */
function allText(value: unknown): string {
  return JSON.stringify(value);
}

describe("fixtures del modo simulado", () => {
  it("cumplen el contrato de @blindaje/shared", () => {
    for (const r of [riskBodegasLimaEste(), riskLimaEste(), riskTransporteLimaSur()]) expect(S.RiskOverview.safeParse(r).success).toBe(true);
    for (const r of recommendationsBodegas()) expect(S.BusinessRecommendationView.safeParse(r).success).toBe(true);
    for (const a of alertsBodegas()) expect(S.VictimAlert.safeParse(a).success).toBe(true);
    for (const a of DEMO_ACCOUNTS) expect(S.BusinessMe.safeParse(a.me).success).toBe(true);
  });

  it("cuentan la historia de Lima Este: “Los X”, Yape, 48 horas y “habla con el jefe”", () => {
    const text = allText([riskBodegasLimaEste(), recommendationsBodegas()]);
    expect(text).toContain("Los X");
    expect(text).toContain("Yape");
    expect(text).toContain("48 horas");
    expect(text.toLowerCase()).toContain("habla con el jefe");
  });

  it("nunca traen números, cuentas ni citas internas, y nunca aconsejan pagar", () => {
    const text = allText([riskBodegasLimaEste(), riskLimaEste(), recommendationsBodegas(), alertsBodegas()]);
    // Fechas aparte, ninguna secuencia de 7 dígitos o más (teléfonos, cuentas).
    expect(text.replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, "")).not.toMatch(/\d[\d\s-]{6,}\d/);
    expect(text).not.toMatch(/\b(VIN|FICHA|EV|ID)-[A-Za-z0-9]/);
    expect(text).not.toMatch(/\bR-\d/);
    // Pagar o negociar solo aparece negado ("No pagues ni negocies", "nadie paga ni negocia").
    for (const m of text.matchAll(/(\p{L}+)\s+(paga|pagues|pagar|págales|negocia|negocies|negociar)(?!\p{L})/giu)) {
      expect(["no", "ni", "nadie", "nunca"], m[0]).toContain(m[1]!.toLowerCase());
    }
  });

  it("cada cifra respeta el umbral: si no hay cifra, el nivel es sin_datos y hay aviso", () => {
    const sur = riskTransporteLimaSur();
    expect(sur.casos_periodo).toBeNull();
    expect(sur.nivel_riesgo).toBe("sin_datos");
    expect(sur.aviso_umbral).toMatch(/Aún no hay suficientes casos para mostrar cifras/);
    expect(sur.tendencia.every((t) => t.casos === null)).toBe(true);
    const este = riskBodegasLimaEste();
    expect(este.casos_periodo).toBeGreaterThanOrEqual(5);
    // Como la API: cada semana y cada rubro con cifra cumple el umbral por sí solo.
    for (const r of [este, riskLimaEste()]) {
      for (const t of r.tendencia) if (t.casos !== null) expect(t.casos).toBeGreaterThanOrEqual(5);
      for (const x of r.sectores_afectados) if (x.casos !== null) expect(x.casos).toBeGreaterThanOrEqual(5);
    }
    // Bajo el umbral no se nombra ningún rubro: listar uno ya diría que alguien de ese rubro denunció.
    expect(sur.sectores_afectados).toEqual([]);
  });

  it("siempre explicita el sesgo", () => {
    for (const r of [riskBodegasLimaEste(), riskLimaEste(), riskTransporteLimaSur()]) expect(r.sesgo).toMatch(/se denuncia más/);
  });
});

describe("MockPortalApi", () => {
  it("entra con la cuenta de demostración y rechaza otra contraseña", async () => {
    const a = api();
    await expect(a.login(bodega.email, "otra-clave")).rejects.toMatchObject({ status: 401 });
    expect(await a.login(bodega.email, DEMO_PASSWORD)).toEqual(bodega);
  });

  it("sin sesión no entrega datos y avisa que la sesión terminó", async () => {
    const a = api();
    let expired = 0;
    a.onSessionExpired(() => expired++);
    await expect(a.risk()).rejects.toMatchObject({ status: 401 });
    expect(expired).toBe(1);
  });

  it("por defecto da el panorama de su zona y su sector", async () => {
    const a = api();
    await a.login(bodega.email, DEMO_PASSWORD);
    const r = await a.risk();
    expect([r.zona, r.sector, r.nivel_riesgo]).toEqual(["Lima Este", "bodega", "medio"]);
    // Con la zona y sin rubro, toda la zona (igual que la API).
    expect((await a.risk({ zona: "Lima Este" })).sector).toBeNull();
  });

  it("solo entrega lo aprobado de su organización", async () => {
    const a = api();
    await a.login(transporte.email, DEMO_PASSWORD);
    expect((await a.risk()).nivel_riesgo).toBe("sin_datos");
    expect(await a.recommendations()).toEqual([]);
    expect(await a.alerts()).toEqual([]);
    await a.logout();
    await a.login(bodega.email, DEMO_PASSWORD);
    expect((await a.recommendations()).length).toBe(2);
  });

  it("no expone ninguna búsqueda por número, cuenta ni placa", () => {
    const methods = Object.getOwnPropertyNames(MockPortalApi.prototype).join(" ");
    expect(methods).not.toMatch(/search|buscar|lookup|numero|cuenta|placa/i);
  });
});
