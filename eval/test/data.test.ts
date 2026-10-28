import { describe, expect, it } from "vitest";
import { normalizeIdentifier } from "@blindaje/shared";
import { loadEscenarios, loadGuiones } from "../src/data";
import { fraseCoincide, normText, scoreFicha } from "../src/ficha-eval";
import { buildFichaInput } from "../src/ficha-input";

const file = loadGuiones();
const esc = loadEscenarios();
const digits = (s: string) => s.replace(/\D/g, "");

describe("guiones ficticios", () => {
  it("hay al menos 30, todos marcados como ficticios y con ids únicos", () => {
    expect(file.guiones.length).toBeGreaterThanOrEqual(30);
    expect(new Set(file.guiones.map((g) => g.id)).size).toBe(file.guiones.length);
    expect(file.guiones.every((g) => g.ficticio)).toBe(true);
  });

  it("el subconjunto de la ficha tiene 20 guiones existentes", () => {
    const ids = new Set(file.guiones.map((g) => g.id));
    expect(new Set(file.subconjunto_ficha).size).toBe(20);
    for (const id of file.subconjunto_ficha) expect(ids.has(id)).toBe(true);
  });

  for (const g of file.guiones) {
    describe(g.id, () => {
      const texto = g.evidencia.map((e) => `${e.origen ?? ""} ${e.contenido}`).join("\n");
      it("las etiquetas de evidencia son del guion y las fuentes las cubren todas", () => {
        for (const e of g.evidencia) expect(e.label.startsWith(`EV-${g.id}-`)).toBe(true);
        expect(new Set(g.etiqueta.fuentes)).toEqual(new Set(g.evidencia.map((e) => e.label)));
      });
      it("cada identificador está en la evidencia, en el rango ficticio y se normaliza", () => {
        for (const i of g.etiqueta.identificadores) {
          expect(normalizeIdentifier(i.tipo, i.valor)).not.toBeNull();
          if (i.tipo === "placa") expect(texto).toContain(i.valor);
          else expect(digits(texto)).toContain(digits(i.valor).replace(/^51/, ""));
          if (i.tipo !== "cuenta_bancaria" && i.tipo !== "placa") expect(digits(i.valor)).toMatch(/^(51)?900000[45]\d\d$/);
          if (i.tipo === "cuenta_bancaria") expect(i.valor.startsWith("000-")).toBe(true);
        }
      });
      it("cada frase firma aparece casi literal en la evidencia", () => {
        for (const f of g.etiqueta.frases_firma) expect(normText(texto)).toContain(normText(f));
      });
      it("el grupo aparece en la evidencia y no es un nombre real", () => {
        if (g.etiqueta.grupo_que_dice_ser) {
          expect(texto).toContain(g.etiqueta.grupo_que_dice_ser);
          expect(["Los X", "Los Y", "Los Z", "Los del Norte", "Los del Sur", "Los del Cerro"]).toContain(g.etiqueta.grupo_que_dice_ser);
        }
      });
      it("los datos de la víctima aparecen en el relato o en la llamada y en el rango 9xx", () => {
        for (const d of g.etiqueta.datos_victima) {
          expect(texto).toContain(d);
          if (digits(d).length === 9) expect(digits(d)).toMatch(/^9000009\d\d$/);
        }
      });
      it("la etiqueta perfecta obtiene todos los campos", () => {
        const e = g.etiqueta;
        const perfecta = {
          sector: e.sector,
          primer_contacto: e.primer_contacto,
          tipo_amenaza: e.tipo_amenaza,
          amenaza: null,
          monto_soles: e.monto_soles,
          periodicidad: e.periodicidad,
          plazo: null,
          plazo_horas: e.plazo_horas,
          canal_pago: e.canal_pago,
          identificadores: e.identificadores.map((i) => ({ ...i, evidencia: [] })),
          grupo_que_dice_ser: e.grupo_que_dice_ser,
          frases_firma: e.frases_firma,
          escalamiento: e.escalamiento.map((x) => ({ ...x, evidencia: [] })),
          resumen_mo: "",
          fuentes: e.fuentes,
        };
        const s = scoreFicha(e, perfecta);
        expect(Object.entries(s.campos).filter(([, v]) => !v.ok).map(([k]) => k)).toEqual([]);
        expect(s.privacidad_ok).toBe(true);
      });
      it("arma la entrada con todas las etiquetas", () => {
        const input = buildFichaInput(g.id, g.evidencia);
        for (const e of g.evidencia) expect(input).toContain(`[${e.label}]`);
      });
    });
  }
});

describe("comparadores de la ficha", () => {
  it("acepta frases un poco más largas o con mayúsculas y tildes distintas", () => {
    expect(fraseCoincide("no llames a la policía", "Y no llames a la policia, que nos enteramos")).toBe(true);
    expect(fraseCoincide("habla con el jefe", "Habla con el jefe")).toBe(true);
    expect(fraseCoincide("habla con el jefe", "pagas o cierras")).toBe(false);
  });
});

describe("escenarios", () => {
  const casos = new Map(esc.casos.map((c) => [c.id, c]));
  const guiones = new Set(file.guiones.map((g) => g.id));
  it("cada caso apunta a un guion existente y los pares a casos existentes", () => {
    for (const c of esc.casos) expect(guiones.has(c.guion)).toBe(true);
    for (const p of esc.pares_vinculados) {
      expect(casos.has(p.a)).toBe(true);
      expect(casos.has(p.b)).toBe(true);
    }
  });
  it("cubre los cuatro tipos de escenario pedidos", () => {
    const tipos = new Set(esc.escenarios.map((e) => e.tipo));
    for (const t of ["misma_persona_distintos_numeros", "distintas_personas_mismo_guion", "cuentas_compartidas", "imagenes_reutilizadas"]) {
      expect(tipos.has(t)).toBe(true);
    }
  });
  it("los pares por voz comparten hablante y los pares por identificador comparten un valor normalizado", () => {
    for (const p of esc.pares_vinculados) {
      const a = casos.get(p.a)!;
      const b = casos.get(p.b)!;
      if (p.por.includes("voz")) expect(a.voz?.hablante).toBe(b.voz?.hablante);
      if (p.por.includes("imagen")) expect(a.imagenes[0]?.imagen).toBe(b.imagenes[0]?.imagen);
    }
  });
});
