import type cytoscape from "cytoscape";
import type { GraphNodeType, NetworkView } from "../api/types";

/**
 * Mapeo de `NetworkView` (API) a elementos de Cytoscape.
 *
 * Cada tipo de nodo se distingue por FORMA y por COLOR (nunca solo por color), y la leyenda HTML
 * usa estos mismos metadatos. La disposición es determinista: los casos van en una fila ordenada
 * por fecha de primer contacto y cada tipo de señal en su propio carril; una señal compartida
 * queda entre los casos que la comparten.
 */

export interface NodeTypeMeta {
  label: string;
  plural: string;
  shape: "round-rectangle" | "ellipse" | "diamond" | "round-tag" | "hexagon";
  fill: string;
  border: string;
  text: string;
  description: string;
}

export const NODE_TYPES: Record<GraphNodeType, NodeTypeMeta> = {
  caso: {
    label: "Caso",
    plural: "Casos",
    shape: "round-rectangle",
    fill: "#1E3A70",
    border: "#1E3A70",
    text: "#FFFFFF",
    description: "Rectángulo azul tinta",
  },
  voz: {
    label: "Huella de voz",
    plural: "Huellas de voz",
    shape: "ellipse",
    fill: "#FFE066",
    border: "#1E3A70",
    text: "#1E3A70",
    description: "Círculo amarillo",
  },
  identificador: {
    label: "Identificador cifrado",
    plural: "Identificadores",
    shape: "diamond",
    fill: "#B8F2C9",
    border: "#1E3A70",
    text: "#1E3A70",
    description: "Rombo verde",
  },
  frase: {
    label: "Frase firma",
    plural: "Frases firma",
    shape: "round-tag",
    fill: "#FFC7D9",
    border: "#1E3A70",
    text: "#1E3A70",
    description: "Etiqueta rosada",
  },
  imagen: {
    label: "Imagen plantilla",
    plural: "Imágenes",
    shape: "hexagon",
    fill: "#A9C8F2",
    border: "#1E3A70",
    text: "#1E3A70",
    description: "Hexágono celeste",
  },
};

export const NODE_TYPE_ORDER: GraphNodeType[] = ["caso", "voz", "identificador", "frase", "imagen"];

const LANE_Y: Record<GraphNodeType, number> = { imagen: -230, voz: -120, caso: 0, identificador: 125, frase: 235 };
const CASE_GAP = 280;
const SPREAD = 120;

const ID_SHORT: Record<string, string> = {
  telefono: "Tel.",
  cuenta_yape: "Yape",
  cuenta_plin: "Plin",
  cuenta_bancaria: "Cuenta",
  placa: "Placa",
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Texto visible de un nodo. Los identificadores muestran solo los últimos 3 caracteres. */
export function nodeDisplayLabel(node: NetworkView["nodes"][number]): string {
  const d = node.data ?? {};
  switch (node.type) {
    case "caso":
      return /^caso\b/i.test(node.label) ? node.label : `Caso ${node.label}`;
    case "identificador": {
      const last = typeof d.ultimos_3 === "string" ? d.ultimos_3 : null;
      const tipo = typeof d.tipo === "string" ? (ID_SHORT[d.tipo] ?? null) : null;
      if (last) return tipo ? `${tipo} …${last}` : `…${last}`;
      return node.label;
    }
    case "frase":
      return `“${truncate(node.label, 26)}”`;
    default:
      return node.label;
  }
}

function caseDate(node: NetworkView["nodes"][number]): string {
  const v = node.data?.primer_contacto;
  return typeof v === "string" ? v : "9999";
}

export function networkToElements(net: Pick<NetworkView, "nodes" | "edges">): cytoscape.ElementDefinition[] {
  const nodeIds = new Set(net.nodes.map((n) => n.id));
  const edges = net.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target);

  // Posiciones: casos en fila por fecha; señales en su carril, en el promedio de sus casos.
  const cases = net.nodes.filter((n) => n.type === "caso").sort((a, b) => caseDate(a).localeCompare(caseDate(b)) || a.id.localeCompare(b.id));
  const pos = new Map<string, { x: number; y: number }>();
  cases.forEach((c, i) => pos.set(c.id, { x: i * CASE_GAP, y: 0 }));
  const caseX = (id: string) => pos.get(id)?.x;

  const neighbours = new Map<string, number[]>();
  for (const e of edges) {
    for (const [a, b] of [
      [e.source, e.target],
      [e.target, e.source],
    ] as const) {
      const x = caseX(b);
      if (x !== undefined && !cases.some((c) => c.id === a)) neighbours.set(a, [...(neighbours.get(a) ?? []), x]);
    }
  }
  const buckets = new Map<string, string[]>();
  const others = net.nodes.filter((n) => n.type !== "caso");
  const centerOf = (id: string) => {
    const xs = neighbours.get(id) ?? [];
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : ((cases.length - 1) * CASE_GAP) / 2;
  };
  for (const n of others) {
    const key = `${n.type}:${Math.round(centerOf(n.id))}`;
    buckets.set(key, [...(buckets.get(key) ?? []), n.id]);
  }
  for (const n of others) {
    const key = `${n.type}:${Math.round(centerOf(n.id))}`;
    const group = buckets.get(key) ?? [n.id];
    const k = group.indexOf(n.id);
    const offset = (k - (group.length - 1) / 2) * SPREAD;
    // Escalonado leve en grupos grandes para que las etiquetas no se encimen.
    const stagger = group.length > 2 && k % 2 === 1 ? 28 : 0;
    pos.set(n.id, { x: centerOf(n.id) + offset, y: LANE_Y[n.type] + (LANE_Y[n.type] < 0 ? -stagger : stagger) });
  }

  const nodes: cytoscape.ElementDefinition[] = net.nodes.map((n) => ({
    group: "nodes",
    data: { id: n.id, label: nodeDisplayLabel(n), type: n.type, ref: n.label },
    classes: n.type,
    position: pos.get(n.id) ?? { x: 0, y: LANE_Y[n.type] },
  }));
  const edgeEls: cytoscape.ElementDefinition[] = edges.map((e) => ({
    group: "edges",
    data: {
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      label: e.type === "vinculo" ? [e.label, e.weight != null ? e.weight.toFixed(2) : null].filter(Boolean).join(" · ") : "",
      weight: e.weight ?? null,
    },
    classes: e.type,
  }));
  return [...nodes, ...edgeEls];
}

/** Hoja de estilos de Cytoscape con los tokens del Cuaderno. */
export function graphStyle(): cytoscape.StylesheetJson {
  const typeRules: cytoscape.StylesheetJson = NODE_TYPE_ORDER.map((t) => {
    const m = NODE_TYPES[t];
    return {
      selector: `node.${t}`,
      style: {
        shape: m.shape,
        "background-color": m.fill,
        "border-color": m.border,
      },
    };
  });
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-family": "Atkinson Hyperlegible, system-ui, sans-serif",
        "font-size": 13,
        color: "#1E3A70",
        "text-valign": "bottom",
        "text-margin-y": 6,
        "text-background-color": "#FBFCFE",
        "text-background-opacity": 0.92,
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
        width: 34,
        height: 34,
        "border-width": 2,
      },
    },
    ...typeRules,
    {
      selector: "node.caso",
      style: {
        width: 92,
        height: 44,
        color: "#FFFFFF",
        "font-size": 15,
        "font-weight": "bold",
        "text-valign": "center",
        "text-margin-y": 0,
        "text-background-opacity": 0,
      },
    },
    { selector: "node.identificador", style: { width: 40, height: 40 } },
    { selector: "node.frase", style: { width: 44, height: 28 } },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": "#7F92B3",
        "line-style": "dashed",
        "line-dash-pattern": [5, 4],
        "curve-style": "bezier",
      },
    },
    {
      selector: "edge.vinculo",
      style: {
        width: 4,
        "line-color": "#1E3A70",
        "line-style": "solid",
        label: "data(label)",
        "font-family": "Atkinson Hyperlegible, system-ui, sans-serif",
        "font-size": 12,
        "font-weight": "bold",
        color: "#1E3A70",
        "text-background-color": "#FFE066",
        "text-background-opacity": 1,
        "text-background-padding": "3px",
        "text-background-shape": "roundrectangle",
      },
    },
    { selector: "node:selected", style: { "border-width": 4, "border-color": "#D64545" } },
    { selector: "node.caso:selected", style: { "border-color": "#FFE066" } },
    { selector: ".atenuado", style: { opacity: 0.22 } },
    { selector: "node.resaltado", style: { "border-width": 4, "border-color": "#D64545" } },
  ];
}
