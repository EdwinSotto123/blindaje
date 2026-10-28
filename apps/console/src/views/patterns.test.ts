import { describe, expect, it } from "vitest";
import type { GraphNode } from "../api/types";
import { caseCodeOf } from "../lib/graph";
import { indexFromNetwork } from "../lib/citations";
import type { NetworkView } from "../api/types";
import { looksLikeEmail } from "./LoginView";
import { caseCodeFromRef } from "./NetworkDetailView";

// Estas expresiones perdieron sus barras invertidas una vez (\S, \d, \s) y rompieron el login con
// la API real y las citas de evidencia en la vista de red. Los tests las fijan.

describe("looksLikeEmail", () => {
  it("acepta correos reales", () => {
    for (const e of ["revisora@demo.blindaje.pe", "nombre@gremio.pe", "  ana.p@mercado-sjl.org.pe "]) expect(looksLikeEmail(e)).toBe(true);
  });
  it("rechaza lo que no es un correo", () => {
    for (const e of ["", "revisora", "revisora@", "revisora@gremio", "re visora@gremio.pe", "SSS@SSS.SSS".replace(/@/, "")]) expect(looksLikeEmail(e)).toBe(false);
  });
});

describe("caseCodeFromRef", () => {
  it("saca el código de caso de evidencia corta y larga y de una ficha", () => {
    expect(caseCodeFromRef("EV-A1")).toBe("A");
    expect(caseCodeFromRef("EV-B12")).toBe("B");
    expect(caseCodeFromRef("EV-K7Q2-3")).toBe("K7Q2");
    expect(caseCodeFromRef("FICHA-C")).toBe("C");
  });
  it("no inventa un caso para otras citas", () => {
    for (const r of ["V-7", "VIN-2", "R-001", "ID-…488", "EV-Ad", "EV-K7Q2-x"]) expect(caseCodeFromRef(r)).toBeNull();
  });
});

describe("código de caso desde la etiqueta del nodo", () => {
  const node = (label: string, data?: Record<string, unknown>): GraphNode => ({ id: `n-${label}`, type: "caso", label, ...(data ? { data } : {}) }) as GraphNode;

  it("usa data.code si viene y, si no, quita el prefijo 'Caso '", () => {
    expect(caseCodeOf(node("Caso A", { code: "A" }))).toBe("A");
    expect(caseCodeOf(node("Caso B"))).toBe("B");
    expect(caseCodeOf(node("caso   K7Q2"))).toBe("K7Q2");
  });

  it("el índice de citas de la red usa el código, no la etiqueta completa", () => {
    const net = {
      id: "net-x",
      nodes: [node("Caso A"), node("Caso B"), { id: "v1", type: "voz", label: "V-3", data: {} } as GraphNode],
      edges: [
        { source: "v1", target: "n-Caso A", type: "senal" },
        { source: "v1", target: "n-Caso B", type: "senal" },
      ],
      links: [],
      timeline: [],
    } as unknown as NetworkView;
    const entry = indexFromNetwork(net).get("V-3");
    expect(entry).toBeTruthy();
    expect(JSON.stringify(entry)).toContain('"A"');
    expect(JSON.stringify(entry)).not.toContain("Caso A");
  });
});
