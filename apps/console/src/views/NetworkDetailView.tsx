import { useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import type { CaseSide, GraphNode, NetworkView } from "../api/types";
import { useApi, useUser } from "../app/context";
import { CiteChip, CiteList, CitationProvider, type CitationResolver } from "../components/Citations";
import { ExpedientePanel } from "../components/ExpedientePanel";
import { GraphCanvas, GraphLegend, NodeShape } from "../components/Graph";
import { Icon } from "../components/Icons";
import { Timeline } from "../components/Timeline";
import { Empty, ErrorBox, Loading, PageHead, StatusBadge } from "../components/ui";
import { indexFromCases, indexFromNetwork } from "../lib/citations";
import { SECTOR_LABEL, fmtDateTime, fmtPeriod, fmtScore } from "../lib/format";
import { NODE_TYPES, NODE_TYPE_ORDER, caseCodeOf, nodeDisplayLabel } from "../lib/graph";
import { can } from "../lib/permissions";
import { useAsync } from "../lib/useAsync";
import { ProfileTab } from "./ProfileTab";

/** Id del caso detrás de un nodo `caso` (data.case_id si la API lo manda; si no, el id del nodo). */
function caseIdOf(n: GraphNode): string {
  return typeof n.data?.case_id === "string" ? n.data.case_id : n.id;
}

/** Código de caso de una cita de evidencia o ficha: EV-A1 → A, EV-K7Q2-3 → K7Q2, FICHA-B → B. */
export function caseCodeFromRef(ref: string): string | null {
  const long = /^EV-([A-Z0-9]{2,6})-\d+$/.exec(ref);
  if (long) return long[1]!;
  const short = /^EV-([A-Z])\d+$/.exec(ref);
  if (short) return short[1]!;
  const ficha = /^FICHA-([A-Z0-9]{1,6})$/.exec(ref);
  return ficha ? ficha[1]! : null;
}

export function NetworkDetailView() {
  const { id = "", tab } = useParams();
  const api = useApi();
  const user = useUser();
  const net = useAsync(() => api.getNetwork(id), `net:${id}`);
  const index = useMemo(() => (net.data ? indexFromNetwork(net.data) : null), [net.data]);
  const canCases = can(user.role, "links.review");

  // La evidencia y las fichas se piden solo al abrir una cita: cada lectura de un caso queda auditada.
  const resolve = useMemo<CitationResolver | undefined>(() => {
    if (!canCases || !net.data) return undefined;
    const nodes = net.data.nodes.filter((n) => n.type === "caso");
    const cache = new Map<string, Promise<CaseSide>>();
    return async (ref: string) => {
      const code = caseCodeFromRef(ref);
      const node = code ? nodes.find((n) => caseCodeOf(n) === code) : undefined;
      if (!node) return undefined;
      const caseId = caseIdOf(node);
      if (!cache.has(caseId)) cache.set(caseId, api.getCase(caseId));
      const side = await cache.get(caseId)!;
      return indexFromCases([side]).get(ref);
    };
  }, [api, canCases, net.data]);

  if (net.error) {
    return (
      <>
        <PageHead title="Red" />
        <ErrorBox error={net.error} onRetry={net.reload} />
      </>
    );
  }
  if (!net.data || !index) return <Loading label="Cargando la red…" />;
  const n = net.data;
  const base = `/redes/${encodeURIComponent(n.id)}`;

  return (
    <CitationProvider index={index} {...(resolve ? { resolve } : {})}>
      <PageHead
        title={`Red ${n.label}`}
        actions={
          <Link to="/redes" className="btn btn-sm">
            <Icon name="arrowLeft" size={15} /> Todas las redes
          </Link>
        }
      >
        {n.n_cases} casos · {n.sectores.map((s) => SECTOR_LABEL[s] ?? s).join(", ")} · {n.periodo ? fmtPeriod(n.periodo) : "periodo sin dato"} · actualizada{" "}
        {fmtDateTime(n.updated_at)}
      </PageHead>
      <nav className="tabs" aria-label="Secciones de la red">
        <NavLink to={base} end>
          Grafo y línea de tiempo
        </NavLink>
        <NavLink to={`${base}/perfil`}>
          Perfil de red {n.profile_status ? <StatusBadge status={n.profile_status} /> : null}
        </NavLink>
        {can(user.role, "expedientes") ? <NavLink to={`${base}/expediente`}>Expediente</NavLink> : null}
      </nav>
      {tab === "perfil" ? (
        <ProfileTab net={n} onChanged={net.reload} />
      ) : tab === "expediente" && can(user.role, "expedientes") ? (
        <ExpedientePanel networkId={n.id} networkLabel={n.label} profileStatus={n.profile_status} />
      ) : tab ? (
        <Empty title="Sección no encontrada" />
      ) : (
        <GraphTab net={n} />
      )}
    </CitationProvider>
  );
}

function GraphTab({ net }: { net: NetworkView }) {
  const [selected, setSelected] = useState<string | null>(null);
  const nodesById = useMemo(() => new Map(net.nodes.map((n) => [n.id, n])), [net.nodes]);
  const sel = selected ? nodesById.get(selected) : undefined;
  const neighbours = useMemo(() => {
    if (!selected) return [];
    const ids = net.edges.flatMap((e) => (e.source === selected ? [e.target] : e.target === selected ? [e.source] : []));
    return [...new Set(ids)].map((i) => nodesById.get(i)).filter((x): x is GraphNode => !!x);
  }, [selected, net.edges, nodesById]);
  const caseNodeByCode = (code: string) => net.nodes.find((n) => n.type === "caso" && caseCodeOf(n) === code);
  const activeCase = sel?.type === "caso" ? String(sel.data?.code ?? sel.label.replace(/^Caso\s+/i, "")) : null;

  return (
    <div className="stack">
      <div className="graph-layout">
        <div className="stack-sm">
          <GraphCanvas net={net} selected={selected} onSelect={setSelected} />
          <GraphLegend />
        </div>
        <aside className="panel stack-sm" aria-label="Elementos del grafo">
          {sel ? (
            <section className="stack-sm" aria-live="polite">
              <h2 className="row" style={{ gap: 8 }}>
                <NodeShape type={sel.type} />
                {nodeDisplayLabel(sel)}
              </h2>
              <span className="small muted">{NODE_TYPES[sel.type].label}</span>
              <NodeDetail node={sel} neighbours={neighbours} />
              {neighbours.length ? (
                <div className="stack-sm">
                  <span className="small strong">Conectado con</span>
                  <ul className="list-plain row" style={{ gap: 6 }}>
                    {neighbours.map((nb) => (
                      <li key={nb.id}>
                        <button type="button" className="btn btn-sm" onClick={() => setSelected(nb.id)}>
                          {nodeDisplayLabel(nb)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <span>
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => setSelected(null)}>
                  Quitar selección
                </button>
              </span>
            </section>
          ) : (
            <p className="small muted">Elige un nodo en el grafo o en esta lista para ver su detalle y sus conexiones.</p>
          )}
          <hr style={{ border: 0, borderTop: "1px solid var(--borde)", width: "100%" }} />
          {NODE_TYPE_ORDER.map((t) => {
            const list = net.nodes.filter((n) => n.type === t);
            if (!list.length) return null;
            return (
              <div key={t} className="stack-sm" role="group" aria-label={NODE_TYPES[t].plural}>
                <span className="row small strong" style={{ gap: 6 }}>
                  <NodeShape type={t} size={16} /> {NODE_TYPES[t].plural} ({list.length})
                </span>
                <ul className="list-plain row" style={{ gap: 4 }}>
                  {list.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-pressed={selected === n.id}
                        style={selected === n.id ? { background: "var(--tinta)", color: "var(--blanco)" } : undefined}
                        onClick={() => setSelected(selected === n.id ? null : n.id)}
                      >
                        {nodeDisplayLabel(n)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </aside>
      </div>

      <div className="grid-2">
        <section className="panel" aria-labelledby="tl-titulo" style={{ gridColumn: "1 / -1" }}>
          <div className="panel-head">
            <h2 id="tl-titulo">Línea de tiempo</h2>
            <span className="small muted">Hora de Lima</span>
          </div>
          <Timeline
            events={net.timeline}
            activeCase={activeCase}
            onPickCase={(code) => {
              const node = caseNodeByCode(code);
              if (node) setSelected(node.id);
            }}
          />
        </section>
      </div>

      <section className="panel" aria-labelledby="vin-titulo">
        <div className="panel-head">
          <h2 id="vin-titulo">Vínculos confirmados</h2>
        </div>
        {net.links.length ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Vínculos confirmados (se desplaza a los lados)">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Vínculo</th>
                  <th scope="col">Casos</th>
                  <th scope="col" className="num">
                    Puntaje
                  </th>
                </tr>
              </thead>
              <tbody>
                {net.links.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <CiteChip refId={l.label} />
                    </td>
                    <td>
                      Caso {l.case_a} y Caso {l.case_b}
                    </td>
                    <td className="num">{fmtScore(l.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Sin vínculos.</p>
        )}
      </section>
    </div>
  );
}

const ROL: Record<string, string> = { contacto: "Número de contacto", cobro: "Cuenta de cobro", vehiculo: "Vehículo" };

function NodeDetail({ node, neighbours }: { node: GraphNode; neighbours: GraphNode[] }) {
  const d = node.data ?? {};
  const casos = Array.isArray(d.casos)
    ? (d.casos as string[])
    : neighbours
        .filter((n) => n.type === "caso")
        .map(caseCodeOf)
        .sort();
  const evidencia = Array.isArray(d.evidencia) ? (d.evidencia as string[]) : [];
  switch (node.type) {
    case "caso":
      return (
        <dl className="dl small">
          <dt>Sector</dt>
          <dd>{typeof d.sector === "string" ? (SECTOR_LABEL[d.sector] ?? d.sector) : "—"}</dd>
          <dt>Zona</dt>
          <dd>{typeof d.zona === "string" ? d.zona : "—"}</dd>
          <dt>Primer contacto</dt>
          <dd>{fmtDateTime(typeof d.primer_contacto === "string" ? d.primer_contacto : null)}</dd>
          <dt>Ficha</dt>
          <dd>
            <CiteChip refId={`FICHA-${typeof d.code === "string" ? d.code : node.label.replace(/^Caso\s+/i, "")}`} />
          </dd>
          {evidencia.length ? (
            <>
              <dt>Evidencia</dt>
              <dd>
                <CiteList refs={evidencia} />
              </dd>
            </>
          ) : null}
        </dl>
      );
    case "identificador":
      return (
        <dl className="dl small">
          <dt>Referencia</dt>
          <dd>
            <CiteChip refId={node.label} />
          </dd>
          {typeof d.rol === "string" ? (
            <>
              <dt>Uso</dt>
              <dd>{ROL[d.rol] ?? d.rol}</dd>
            </>
          ) : null}
          <dt>Casos</dt>
          <dd>{casos.join(", ") || "—"}</dd>
          {evidencia.length ? (
            <>
              <dt>Evidencia</dt>
              <dd>
                <CiteList refs={evidencia} />
              </dd>
            </>
          ) : null}
        </dl>
      );
    case "voz":
      return (
        <dl className="dl small">
          <dt>Huella</dt>
          <dd>
            <CiteChip refId={node.label} />
          </dd>
          {Array.isArray(d.huellas) ? (
            <>
              <dt>Agrupa</dt>
              <dd>{(d.huellas as string[]).join(", ")}</dd>
            </>
          ) : null}
          <dt>Casos</dt>
          <dd>{casos.join(", ") || "—"}</dd>
          {typeof d.segmentos === "number" ? (
            <>
              <dt>Segmentos</dt>
              <dd>{d.segmentos}</dd>
            </>
          ) : null}
          {evidencia.length ? (
            <>
              <dt>Evidencia</dt>
              <dd>
                <CiteList refs={evidencia} />
              </dd>
            </>
          ) : null}
        </dl>
      );
    case "frase":
      return (
        <dl className="dl small">
          <dt>Frase</dt>
          <dd className="phrase">“{node.label}”</dd>
          <dt>Casos</dt>
          <dd>{casos.join(", ") || "—"}</dd>
        </dl>
      );
    case "imagen":
      return (
        <dl className="dl small">
          <dt>Recorte</dt>
          <dd>
            <CiteChip refId={node.label} />
          </dd>
          {typeof d.descripcion === "string" || typeof d.concept === "string" ? (
            <>
              <dt>Descripción</dt>
              <dd>{typeof d.descripcion === "string" ? d.descripcion : `Concepto de SAM 3.1: “${String(d.concept)}”`}</dd>
            </>
          ) : null}
          <dt>Casos</dt>
          <dd>{casos.join(", ") || "—"}</dd>
          {evidencia.length ? (
            <>
              <dt>Evidencia</dt>
              <dd>
                <CiteList refs={evidencia} />
              </dd>
            </>
          ) : null}
        </dl>
      );
  }
}
