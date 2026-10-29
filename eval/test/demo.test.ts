import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeIdentifier } from "@blindaje/shared";
import { loadDemo } from "../src/demo-data";
import { DEMO_DIR } from "../src/env";

const hoy = new Date("2026-11-02T12:00:00-05:00");
const demo = loadDemo(hoy);

describe("datos del demo", () => {
  it("todos los archivos de evidencia existen", () => {
    for (const c of [...demo.casos, demo.infiltrado]) {
      for (const e of c.evidencia) if (e.archivo) expect(existsSync(resolve(DEMO_DIR, e.archivo))).toBe(true);
      if (c.muestra_voz) expect(existsSync(resolve(DEMO_DIR, c.muestra_voz))).toBe(true);
    }
  });

  it("las fechas son relativas al día del seed y caen en los últimos 14 días", () => {
    for (const c of demo.casos) {
      for (const e of c.evidencia) {
        const t = Date.parse(e.captured_at);
        expect(hoy.getTime() - t).toBeGreaterThan(0);
        expect(hoy.getTime() - t).toBeLessThan(14 * 86400000);
      }
      expect(c.relato).not.toMatch(/\{fecha:/);
    }
  });

  it("el Vigía tiene volumen: >= 5 casos de >= 3 víctimas en San Juan de Lurigancho (un distrito), todos comunitarios", () => {
    const sjl = demo.casos.filter((c) => c.zona === "san-juan-de-lurigancho");
    expect(sjl.length).toBeGreaterThanOrEqual(5);
    expect(new Set(sjl.map((c) => c.invite + c.code)).size).toBeGreaterThanOrEqual(3);
    for (const c of demo.casos) expect(c.consent_mode).toBe("comunitario");
  });

  it("A y B comparten voz con números distintos; B, C y al menos dos de fondo pagan a la cuenta recaudadora", () => {
    const tel = (s: string) => normalizeIdentifier("telefono", s);
    expect(tel(demo.identificadores.contacto_A!)).not.toBe(tel(demo.identificadores.contacto_B!));
    const recaudadora = demo.identificadores.yape_recaudadora!.replace(/\D/g, "");
    const pagan = demo.casos.filter((c) => c.evidencia.some((e) => (e.texto ?? "").replace(/\D/g, "").includes(recaudadora)));
    const codes = pagan.map((c) => c.code);
    expect(codes).toContain("B");
    expect(codes).toContain("C");
    expect(pagan.filter((c) => c.fondo).length).toBeGreaterThanOrEqual(2);
    expect(codes).not.toContain("A");
  });

  it("los casos de fondo son solo texto", () => {
    for (const c of demo.casos.filter((x) => x.fondo)) expect(c.evidencia.every((e) => e.tipo === "texto")).toBe(true);
  });
});
