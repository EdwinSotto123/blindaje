import { describe, expect, it } from "vitest";
import type { NetworkView } from "../api/types";
import { buildGraph, initialLinks } from "../mock/fixtures";
import { NODE_TYPES, NODE_TYPE_ORDER, graphStyle, networkToElements, nodeDisplayLabel } from "./graph";

const links = initialLinks();
const confirmed = links.filter((l) => l.label === "VIN-1" || l.label === "VIN-2");
const g = buildGraph(["A", "B", "C"], confirmed);
const net: Pick<NetworkView, "nodes" | "edges"> = { nodes: g.nodes, edges: g.edges };

const nodesOf = (els: ReturnType<typeof networkToElements>) => els.filter((e) => e.group === "nodes");
const edgesOf = (els: ReturnType<typeof networkToElements>) => els.filter((e) => e.group === "edges");

describe("networkToElements", () => {
  const els = networkToElements(net);

  it("crea un nodo por cada nodo de la red, con su tipo como clase", () => {
    expect(nodesOf(els)).toHaveLength(net.nodes.length);
    for (const el of nodesOf(els)) {
      expect(NODE_TYPE_ORDER).toContain(el.data.type);
      expect(el.classes).toBe(el.data.type);
    }
    expect(nodesOf(els).filter((e) => e.data.type === "caso").map((e) => e.data.label)).toEqual(["Caso A", "Caso B", "Caso C"]);
  });

  it("los identificadores muestran solo los últimos 3 caracteres", () => {
    const ids = nodesOf(els).filter((e) => e.data.type === "identificador");
    expect(ids.length).toBeGreaterThan(0);
    for (const el of ids) {
      expect(el.data.label).toMatch(/…[A-Z0-9]{3}$/);
      expect(el.data.label).not.toMatch(/ID-/);
    }
    expect(ids.map((e) => e.data.label)).toContain("Yape …488");
  });

  it("las aristas de vínculo llevan etiqueta y puntaje; las de señal no", () => {
    const vinc = edgesOf(els).filter((e) => e.data.type === "vinculo");
    expect(vinc.map((e) => e.data.label)).toEqual(["VIN-1 · 0.91", "VIN-2 · 0.95"]);
    for (const e of edgesOf(els).filter((x) => x.data.type === "senal")) expect(e.data.label).toBe("");
  });

  it("descarta aristas con extremos que no existen o lazos", () => {
    const withBad = {
      nodes: net.nodes,
      edges: [
        ...net.edges,
        { id: "x1", source: "case-a", target: "no-existe", type: "senal" as const },
        { id: "x2", source: "case-a", target: "case-a", type: "senal" as const },
      ],
    };
    expect(edgesOf(networkToElements(withBad))).toHaveLength(net.edges.length);
  });

  it("ordena los casos por primer contacto y pone cada señal compartida entre sus casos", () => {
    const pos = new Map(nodesOf(els).map((e) => [e.data.id as string, e.position!]));
    const a = pos.get("case-a")!;
    const b = pos.get("case-b")!;
    const c = pos.get("case-c")!;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(a.y).toBe(0);
    const cuenta = pos.get("ident-ID-3fa9c1")!;
    expect(cuenta.x).toBeCloseTo((b.x + c.x) / 2);
    expect(cuenta.y).toBeGreaterThan(0);
    const voz = pos.get("voz-V-3")!;
    expect(voz.x).toBeCloseTo((a.x + b.x) / 2);
    expect(voz.y).toBeLessThan(0);
  });

  it("es determinista", () => {
    expect(networkToElements(net)).toEqual(els);
  });
});

describe("nodeDisplayLabel", () => {
  it("usa el identificador citable si no hay últimos 3", () => {
    expect(nodeDisplayLabel({ id: "x", type: "identificador", label: "ID-abc123" })).toBe("ID-abc123");
    expect(nodeDisplayLabel({ id: "x", type: "identificador", label: "ID-abc123", data: { ultimos_3: "007" } })).toBe("…007");
    expect(nodeDisplayLabel({ id: "x", type: "caso", label: "A" })).toBe("Caso A");
    expect(nodeDisplayLabel({ id: "x", type: "frase", label: "habla con el jefe" })).toBe("“habla con el jefe”");
  });
});

describe("estilo y leyenda", () => {
  it("cada tipo de nodo tiene una forma y un color propios (nunca solo color)", () => {
    const shapes = NODE_TYPE_ORDER.map((t) => NODE_TYPES[t].shape);
    const fills = NODE_TYPE_ORDER.map((t) => NODE_TYPES[t].fill);
    expect(new Set(shapes).size).toBe(NODE_TYPE_ORDER.length);
    expect(new Set(fills).size).toBe(NODE_TYPE_ORDER.length);
  });

  it("la hoja de estilos aplica esa forma y ese color a cada clase", () => {
    const style = graphStyle();
    for (const t of NODE_TYPE_ORDER) {
      const rule = style.find((r) => r.selector === `node.${t}`);
      expect(rule).toBeDefined();
      const s = ("style" in rule! ? rule.style : rule!.css) as Record<string, unknown>;
      expect(s.shape).toBe(NODE_TYPES[t].shape);
      expect(s["background-color"]).toBe(NODE_TYPES[t].fill);
    }
  });
});
