import cytoscape from "cytoscape";
import { useEffect, useMemo, useRef } from "react";
import type { GraphNodeType, NetworkView } from "../api/types";
import { NODE_TYPES, NODE_TYPE_ORDER, graphStyle, networkToElements } from "../lib/graph";
import { Icon } from "./Icons";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Grafo interactivo de una red. El lienzo no es accesible por sí mismo: la lista de elementos y la
 * línea de tiempo de la vista ofrecen la misma información con teclado y lector de pantalla, y
 * seleccionar ahí resalta el nodo aquí.
 */
export function GraphCanvas({
  net,
  selected,
  onSelect,
}: {
  net: NetworkView;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSelectRef = useRef(onSelect);
  const elements = useMemo(() => networkToElements(net), [net]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = boxRef.current;
    if (!container) return;
    const cy = cytoscape({
      container,
      elements,
      style: graphStyle(),
      layout: { name: "preset", fit: true, padding: 48 },
      minZoom: 0.25,
      maxZoom: 3,
      boxSelectionEnabled: false,
      selectionType: "single",
    });
    cy.on("tap", "node", (e) => onSelectRef.current(e.target.id() as string));
    cy.on("tap", (e) => {
      if (e.target === cy) onSelectRef.current(null);
    });
    cyRef.current = cy;
    // Al cambiar el tamaño del contenedor (carga de fuentes, panel lateral), reajustar a la vista.
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            cy.resize();
            cy.fit(undefined, 48);
          })
        : null;
    ro?.observe(container);
    return () => {
      ro?.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("atenuado");
      cy.nodes().unselect();
      if (!selected) return;
      const node = cy.getElementById(selected);
      if (node.empty()) return;
      node.select();
      cy.elements().not(node.closedNeighborhood()).addClass("atenuado");
    });
    if (selected) {
      const node = cy.getElementById(selected);
      if (node.nonempty()) {
        if (prefersReducedMotion()) cy.center(node);
        else cy.animate({ center: { eles: node } }, { duration: 220 });
      }
    }
  }, [selected, elements]);

  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  const nCases = net.nodes.filter((n) => n.type === "caso").length;
  const nSignals = net.nodes.length - nCases;
  const nLinks = net.edges.filter((e) => e.type === "vinculo").length;

  return (
    <div className="graph-box">
      <div className="graph-tools">
        <button type="button" className="btn btn-sm" onClick={() => zoom(1.25)} aria-label="Acercar">
          <Icon name="zoomIn" size={15} />
        </button>
        <button type="button" className="btn btn-sm" onClick={() => zoom(0.8)} aria-label="Alejar">
          <Icon name="zoomOut" size={15} />
        </button>
        <button type="button" className="btn btn-sm" onClick={() => cyRef.current?.fit(undefined, 48)} aria-label="Ajustar a la vista">
          <Icon name="fit" size={15} />
        </button>
      </div>
      <div
        ref={boxRef}
        role="img"
        aria-label={`Grafo de la red ${net.label}: ${nCases} casos, ${nLinks} vínculos confirmados y ${nSignals} señales. La lista de elementos ofrece la misma información.`}
        style={{ position: "absolute", inset: 0 }}
      />
    </div>
  );
}

/** Forma del nodo en SVG para la leyenda (misma forma y color que en el grafo). */
export function NodeShape({ type, size = 22 }: { type: GraphNodeType; size?: number }) {
  const m = NODE_TYPES[type];
  const common = { fill: m.fill, stroke: m.border, strokeWidth: 2 };
  const shape = (() => {
    switch (m.shape) {
      case "round-rectangle":
        return <rect x="2" y="6" width="20" height="12" rx="3" {...common} />;
      case "ellipse":
        return <circle cx="12" cy="12" r="9" {...common} />;
      case "diamond":
        return <path d="M12 2l10 10-10 10L2 12z" {...common} />;
      case "round-tag":
        return <path d="M3 6h12l6 6-6 6H3z" strokeLinejoin="round" {...common} />;
      case "hexagon":
        return <path d="M7 3h10l5 9-5 9H7l-5-9z" {...common} />;
    }
  })();
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24">
      {shape}
    </svg>
  );
}

export function GraphLegend() {
  return (
    <ul className="legend" aria-label="Leyenda del grafo">
      {NODE_TYPE_ORDER.map((t) => (
        <li key={t}>
          <NodeShape type={t} />
          <span>
            {NODE_TYPES[t].plural} <span className="sr-only">({NODE_TYPES[t].description})</span>
          </span>
        </li>
      ))}
      <li>
        <svg aria-hidden="true" width="30" height="12" viewBox="0 0 30 12">
          <path d="M1 6h28" stroke="#1E3A70" strokeWidth="4" />
        </svg>
        Vínculo confirmado <span className="sr-only">(línea gruesa continua)</span>
      </li>
      <li>
        <svg aria-hidden="true" width="30" height="12" viewBox="0 0 30 12">
          <path d="M1 6h28" stroke="#7F92B3" strokeWidth="1.8" strokeDasharray="5 4" />
        </svg>
        Señal del caso <span className="sr-only">(línea delgada punteada)</span>
      </li>
    </ul>
  );
}
