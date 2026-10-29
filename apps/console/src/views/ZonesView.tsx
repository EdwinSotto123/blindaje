import "../styles/zones.css";

import {
  DISTRICT_GRID,
  DISTRICTS,
  MIN_CASES_FOR_STATS,
  MIN_VICTIMS_FOR_STATS,
  canShowTerritorialStats,
  countBand,
  districtById,
  type ConsoleZoneRow,
  type ConsoleZones,
  type District,
} from "@blindaje/shared";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { NetworkSummary } from "../api/types";
import { useApi, useUser } from "../app/context";
import { Empty, ErrorBox, Loading, PageHead } from "../components/ui";
import { fmtDateTime, fmtInt } from "../lib/format";
import { can } from "../lib/permissions";
import { useAsync } from "../lib/useAsync";

/**
 * Zonas (docs/rediseno.md): dónde pasan los casos, por distrito, nunca por dirección ni vivienda.
 * La grilla es esquemática (DISTRICTS[].col/row), sin mapa base ni coordenadas. El equipo ve cifras
 * exactas, pero un distrito solo muestra su detalle si pasa el umbral de 5 casos de 3 víctimas; por
 * debajo se ve igual que uno sin casos. No hay total de la ciudad: con un total y las cifras por
 * distrito, una resta revelaría lo que el umbral oculta.
 */

export const ZONE_PERIODS = [14, 28, 90] as const;
export type ZonePeriod = (typeof ZONE_PERIODS)[number];
const DEFAULT_PERIOD: ZonePeriod = 28;

export const BIAS_NOTE = "Más casos en un distrito puede significar que ahí se denuncia más, no que sea más peligroso.";
export const THRESHOLD_NOTE = `Un distrito muestra cifras solo con al menos ${MIN_CASES_FOR_STATS} casos de ${MIN_VICTIMS_FOR_STATS} víctimas distintas en el periodo. Por debajo, o sin casos, se ve igual: sin datos suficientes.`;

export type Trend = "sube" | "baja" | "estable";

/** Tendencia frente al periodo anterior: cambios de 1 caso o de menos del 20 % cuentan como estables. */
export function trendOf(casos: number, previos: number): Trend {
  if (Math.abs(casos - previos) < 2) return "estable";
  if (previos === 0) return "sube";
  const ratio = casos / previos;
  if (ratio >= 1.2) return "sube";
  if (ratio <= 0.8) return "baja";
  return "estable";
}

const TREND_MARK: Record<Trend, string> = { sube: "↑", baja: "↓", estable: "→" };

/** Hasta este ancho la grilla y el detalle van uno debajo del otro (zones.css usa el mismo corte). */
const STACKED_MQ = "(max-width: 1365px)";
const TREND_WORD: Record<Trend, string> = { sube: "sube", baja: "baja", estable: "estable" };

/** Intensidad del cuadro por rango de casos (1 a 4); 0 es "sin datos suficientes". */
const LEVEL: Record<string, number> = { "5-9": 1, "10-19": 2, "20-49": 3, "50+": 4 };

export interface ZoneCell {
  district: District;
  /** Solo si el distrito pasa el umbral; si no, null (aunque la API haya mandado la fila). */
  row: ConsoleZoneRow | null;
  level: number;
  trend: Trend | null;
}

/** Un cuadro por cada uno de los 50 distritos. El umbral se vuelve a revisar aquí, por si acaso. */
export function buildCells(data: ConsoleZones): ZoneCell[] {
  const byId = new Map(data.filas.map((f) => [f.distrito, f]));
  return DISTRICTS.map((district) => {
    const f = byId.get(district.id);
    const visible = !!f && f.sobre_umbral && canShowTerritorialStats(f.casos, f.victimas);
    if (!f || !visible) return { district, row: null, level: 0, trend: null };
    return { district, row: f, level: LEVEL[countBand(f.casos, f.victimas) ?? ""] ?? 1, trend: trendOf(f.casos, f.casos_previos) };
  });
}

/** Orden de la tabla: primero los distritos con cifras (más casos arriba), luego el resto por nombre. */
export function tableOrder(cells: ZoneCell[]): ZoneCell[] {
  return [...cells].sort((a, b) => {
    if (a.row && b.row) return b.row.casos - a.row.casos || a.district.name.localeCompare(b.district.name, "es");
    if (a.row) return -1;
    if (b.row) return 1;
    return a.district.name.localeCompare(b.district.name, "es");
  });
}

function casesWord(n: number): string {
  return n === 1 ? "1 caso" : `${fmtInt(n)} casos`;
}

/** Texto completo de un cuadro para lectores de pantalla. */
export function cellLabel(c: ZoneCell, dias: number): string {
  if (!c.row) return `${c.district.name}: sin datos suficientes`;
  return `${c.district.name}: ${casesWord(c.row.casos)} en ${dias} días, ${TREND_WORD[c.trend ?? "estable"]} frente al periodo anterior`;
}

/** El cuadro vecino en la dirección de la flecha (prefiere seguir en la misma fila o columna). */
export function neighbor(from: District, key: string): District | null {
  const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  const d = dirs[key];
  if (!d) return null;
  let best: District | null = null;
  let bestScore = Infinity;
  for (const c of DISTRICTS) {
    const dx = c.col - from.col;
    const dy = c.row - from.row;
    const along = dx * d[0] + dy * d[1];
    if (along <= 0) continue;
    const score = along + Math.abs(d[0] ? dy : dx) * 3;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function parsePeriod(v: string | null): ZonePeriod {
  const n = Number(v);
  return (ZONE_PERIODS as readonly number[]).includes(n) ? (n as ZonePeriod) : DEFAULT_PERIOD;
}

export function ZonesView() {
  const api = useApi();
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const dias = parsePeriod(params.get("dias"));
  const zones = useAsync(() => api.zones(dias), `zones:${dias}`);
  const canNetworks = can(user.role, "networks.view");
  const nets = useAsync(() => (canNetworks ? api.listNetworks() : Promise.resolve([] as NetworkSummary[])), `zones:networks:${canNetworks}`);

  const cells = zones.data ? buildCells(zones.data) : [];
  const top = tableOrder(cells).find((c) => c.row);
  const asked = districtById(params.get("distrito"));
  const selected = asked ?? top?.district ?? null;

  const update = (next: { dias?: ZonePeriod; distrito?: string | null }) => {
    const d = next.dias ?? dias;
    const id = next.distrito === undefined ? asked?.id : next.distrito;
    const p: Record<string, string> = {};
    if (d !== DEFAULT_PERIOD) p.dias = String(d);
    if (id) p.distrito = id;
    setParams(p, { replace: true });
  };

  return (
    <>
      <PageHead title="Zonas">
        Dónde pasan los casos, por distrito. Nunca una dirección ni una vivienda: cada cuadro es un distrito entero.
      </PageHead>
      <div className="zones-toolbar">
        <div className="segmented" role="group" aria-label="Periodo">
          {ZONE_PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={dias === p} onClick={() => update({ dias: p })}>
              {p} días
            </button>
          ))}
        </div>
        {zones.data ? (
          <span className="small muted">
            Últimos {zones.data.periodo_dias} días frente a los {zones.data.periodo_dias} anteriores · actualizado {fmtDateTime(zones.data.actualizado)}
          </span>
        ) : null}
        {api.mode === "mock" ? <span className="chip chip-pink">Cifras ficticias</span> : null}
      </div>
      <ZoneNotes />
      {zones.error ? <ErrorBox error={zones.error} onRetry={zones.reload} /> : null}
      {zones.loading && !zones.data ? <Loading label="Cargando las zonas…" /> : null}
      {zones.data ? (
        <ZonesBody
          data={zones.data}
          cells={cells}
          selected={selected}
          onSelect={(id) => update({ distrito: id })}
          networks={nets.data ?? []}
          canNetworks={canNetworks}
        />
      ) : null}
    </>
  );
}

/** Nota de sesgo y regla del umbral: siempre a la vista. */
export function ZoneNotes() {
  return (
    <aside className="zone-notes" aria-label="Cómo leer estas cifras">
      <p>
        <span className="zone-note-tag">Sesgo</span> {BIAS_NOTE}
      </p>
      <p>
        <span className="zone-note-tag">Umbral</span> {THRESHOLD_NOTE}
      </p>
      <p>
        <span className="zone-note-tag">Sin totales</span> No mostramos el total de la ciudad: con un total y las cifras por distrito, una resta revelaría
        lo que el umbral oculta.
      </p>
    </aside>
  );
}

export function ZonesBody({
  data,
  cells,
  selected,
  onSelect,
  networks,
  canNetworks,
}: {
  data: ConsoleZones;
  cells: ZoneCell[];
  selected: District | null;
  onSelect: (id: string) => void;
  networks: NetworkSummary[];
  canNetworks: boolean;
}) {
  const withData = cells.filter((c) => c.row).length;
  const current = cells.find((c) => c.district.id === selected?.id) ?? null;

  // Con la grilla y el detalle apilados, tocar un distrito lleva al detalle si no está a la vista.
  const select = (id: string, via: "click" | "key") => {
    onSelect(id);
    if (via !== "click" || typeof window === "undefined" || !window.matchMedia?.(STACKED_MQ).matches) return;
    requestAnimationFrame(() => {
      const panel = document.getElementById("zona-detalle-panel");
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      if (r.top >= 0 && r.top < window.innerHeight * 0.6) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      panel.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    });
  };
  return (
    <>
      <p className="zone-summary small">
        <span className="chip chip-grid">
          {withData} de {cells.length} distritos con cifras
        </span>
        <span className="muted">Los demás no llegan al umbral o no tienen casos.</span>
        {data.sin_distrito > 0 ? (
          <span className="muted">
            {casesWord(data.sin_distrito)} del periodo no {data.sin_distrito === 1 ? "tiene" : "tienen"} un distrito de la lista y no entran en la grilla.
          </span>
        ) : null}
      </p>
      <div className="zones-layout">
        <section className="panel zone-map-panel" aria-labelledby="zonas-grilla">
          <div className="panel-head">
            <h2 id="zonas-grilla">Grilla de distritos</h2>
            <span className="small muted">Norte arriba. La posición de cada cuadro es aproximada.</span>
          </div>
          <ZoneGrid cells={cells} dias={data.periodo_dias} selectedId={current?.district.id ?? null} onSelect={select} />
          <ZoneLegend />
        </section>
        <ZoneDetail cell={current} dias={data.periodo_dias} networks={networks} canNetworks={canNetworks} />
      </div>
      <ZoneTable cells={cells} dias={data.periodo_dias} networks={networks} />
    </>
  );
}

export function ZoneGrid({
  cells,
  dias,
  selectedId,
  onSelect,
}: {
  cells: ZoneCell[];
  dias: number;
  selectedId: string | null;
  onSelect: (id: string, via: "click" | "key") => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const mapRef = useRef<HTMLDivElement>(null);
  // Una sola parada de tabulación (el cuadro elegido); las flechas recorren la grilla.
  const tabStop = selectedId ?? cells[0]?.district.id ?? null;

  // En pantallas angostas la grilla se desplaza a los lados: el distrito elegido queda a la vista.
  useEffect(() => {
    const map = mapRef.current;
    const btn = selectedId ? refs.current.get(selectedId) : undefined;
    if (!map || !btn || map.scrollWidth <= map.clientWidth) return;
    const left = btn.offsetLeft;
    if (left >= map.scrollLeft && left + btn.offsetWidth <= map.scrollLeft + map.clientWidth) return;
    map.scrollLeft = left - (map.clientWidth - btn.offsetWidth) / 2;
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, from: District) => {
    let next: District | null = null;
    if (e.key === "Home") next = DISTRICTS[0] ?? null;
    else if (e.key === "End") next = DISTRICTS[DISTRICTS.length - 1] ?? null;
    else next = neighbor(from, e.key);
    if (!next && !e.key.startsWith("Arrow")) return;
    e.preventDefault();
    if (!next) return;
    refs.current.get(next.id)?.focus();
    onSelect(next.id, "key");
  };

  return (
    <>
      <p className="zone-scroll-hint small muted" aria-hidden="true">
        Desliza la grilla a los lados para ver todos los distritos.
      </p>
      <div ref={mapRef} className="zone-map" role="region" aria-label="Grilla de distritos (se desplaza a los lados)">
        <p id="zonas-ayuda" className="sr-only">
          Cada botón es un distrito. Usa las flechas para moverte entre distritos; el detalle se muestra al lado. Hay una tabla con los mismos datos más abajo.
        </p>
        <div
          className="zone-grid"
          role="group"
          aria-label={`Distritos de Lima y el Callao, últimos ${dias} días`}
          aria-describedby="zonas-ayuda"
          style={{ gridTemplateColumns: `repeat(${DISTRICT_GRID.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${DISTRICT_GRID.rows}, auto)` }}
        >
          {cells.map((c) => {
            const id = c.district.id;
            return (
              <button
                key={id}
                ref={(el) => {
                  if (el) refs.current.set(id, el);
                  else refs.current.delete(id);
                }}
                type="button"
                className="zone-cell"
                data-level={c.level}
                aria-pressed={selectedId === id}
                aria-label={cellLabel(c, dias)}
                tabIndex={tabStop === id ? 0 : -1}
                style={{ gridColumn: c.district.col + 1, gridRow: c.district.row + 1 }}
                onClick={() => onSelect(id, "click")}
                onKeyDown={(e) => onKeyDown(e, c.district)}
              >
                <span className="zone-name">{c.district.short}</span>
                {c.row ? (
                  <span className="zone-count">
                    {fmtInt(c.row.casos)}
                    {c.trend ? (
                      <span className="zone-trend" data-trend={c.trend}>
                        {TREND_MARK[c.trend]}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="zone-none">sin datos</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function ZoneLegend() {
  return (
    <div className="zone-legend small" aria-label="Leyenda">
      <ul className="list-plain zone-legend-scale">
        <li>
          <i data-level="0" aria-hidden="true" /> Sin datos suficientes
        </li>
        <li>
          <i data-level="1" aria-hidden="true" /> 5 a 9 casos
        </li>
        <li>
          <i data-level="2" aria-hidden="true" /> 10 a 19
        </li>
        <li>
          <i data-level="3" aria-hidden="true" /> 20 a 49
        </li>
        <li>
          <i data-level="4" aria-hidden="true" /> 50 o más
        </li>
      </ul>
      <p className="muted">
        <span aria-hidden="true">{TREND_MARK.sube}</span> sube, <span aria-hidden="true">{TREND_MARK.baja}</span> baja,{" "}
        <span aria-hidden="true">{TREND_MARK.estable}</span> estable, frente al periodo anterior del mismo largo.
      </p>
    </div>
  );
}

/** Una red de la fila: la API puede mandar el id o la etiqueta (R-001); se muestra la etiqueta. */
function resolveNetwork(ref: string, networks: NetworkSummary[]): { id: string; label: string } {
  const n = networks.find((x) => x.id === ref || x.label === ref);
  return n ? { id: n.id, label: n.label } : { id: ref, label: ref };
}

export function ZoneDetail({
  cell,
  dias,
  networks,
  canNetworks,
}: {
  cell: ZoneCell | null;
  dias: number;
  networks: NetworkSummary[];
  canNetworks: boolean;
}) {
  if (!cell) {
    return (
      <section id="zona-detalle-panel" className="panel zone-detail" aria-label="Detalle del distrito">
        <Empty title="Elige un distrito">Toca un cuadro de la grilla para ver su detalle.</Empty>
      </section>
    );
  }
  const { district, row, trend } = cell;
  return (
    <section id="zona-detalle-panel" className="panel zone-detail" aria-labelledby="zona-detalle">
      <div className="panel-head">
        <h2 id="zona-detalle">{district.name}</h2>
        <span className="chip chip-grid">{district.area}</span>
      </div>
      {row ? (
        <div className="stack-sm">
          <p className="zone-figure">
            <span className="zone-big">{fmtInt(row.casos)}</span>
            <span>
              {row.casos === 1 ? "caso" : "casos"} en los últimos {dias} días
            </span>
          </p>
          <dl className="dl">
            <dt>Víctimas distintas</dt>
            <dd>{fmtInt(row.victimas)}</dd>
            <dt>Periodo anterior</dt>
            <dd>{row.casos_previos >= MIN_CASES_FOR_STATS ? casesWord(row.casos_previos) : `menos de ${MIN_CASES_FOR_STATS} casos`}</dd>
            <dt>Tendencia</dt>
            <dd>
              {trend ? (
                <span className="zone-trend-text" data-trend={trend}>
                  <span aria-hidden="true">{TREND_MARK[trend]}</span> {trend === "estable" ? "Estable" : trend === "sube" ? "Sube" : "Baja"}
                </span>
              ) : (
                "—"
              )}
            </dd>
            <dt>Redes</dt>
            <dd>
              {row.redes.length ? (
                <span className="row">
                  {row.redes.map((r) => {
                    const n = resolveNetwork(r, networks);
                    return canNetworks ? (
                      <Link key={r} className="cite" data-kind="red" to={`/redes/${encodeURIComponent(n.id)}`}>
                        {n.label}
                      </Link>
                    ) : (
                      <span key={r} className="chip chip-outline">
                        {n.label}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className="muted">Ninguna confirmada</span>
              )}
            </dd>
          </dl>
          <div className="stack-sm">
            <h3>Modalidades</h3>
            {row.modalidades.length ? (
              <ul className="zone-modalities">
                {row.modalidades.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Sin modalidades descritas para este periodo.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="zone-empty">
          <p className="strong">Sin datos suficientes</p>
          <p className="small">
            Con menos de {MIN_CASES_FOR_STATS} casos de {MIN_VICTIMS_FOR_STATS} víctimas distintas en {dias} días, o sin casos, no se muestran cifras, redes
            ni modalidades del distrito.
          </p>
        </div>
      )}
      <p className="small muted zone-detail-note">{BIAS_NOTE}</p>
    </section>
  );
}

/** Alternativa accesible a la grilla: los mismos datos, en tabla. */
export function ZoneTable({ cells, dias, networks = [] }: { cells: ZoneCell[]; dias: number; networks?: NetworkSummary[] }) {
  const rows = tableOrder(cells);
  return (
    <details className="panel zone-table">
      <summary>
        <span className="strong">Ver como tabla</span> <span className="small muted">({rows.length} distritos, los mismos datos de la grilla)</span>
      </summary>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla de distritos (se desplaza a los lados)">
        <table className="table">
          <caption className="sr-only">
            Casos por distrito en los últimos {dias} días. {THRESHOLD_NOTE}
          </caption>
          <thead>
            <tr>
              <th scope="col">Distrito</th>
              <th scope="col">Área</th>
              <th scope="col" className="num">
                Casos
              </th>
              <th scope="col" className="num">
                Víctimas
              </th>
              <th scope="col">Tendencia</th>
              <th scope="col">Redes</th>
              <th scope="col">Modalidades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.district.id}>
                <th scope="row" className="zone-th">
                  {c.district.name}
                </th>
                <td className="nowrap">{c.district.area}</td>
                {c.row ? (
                  <>
                    <td className="num">{fmtInt(c.row.casos)}</td>
                    <td className="num">{fmtInt(c.row.victimas)}</td>
                    <td className="nowrap">{c.trend ? `${TREND_MARK[c.trend]} ${TREND_WORD[c.trend]}` : "—"}</td>
                    <td>{c.row.redes.length ? c.row.redes.map((r) => resolveNetwork(r, networks).label).join(", ") : "—"}</td>
                    <td>{c.row.modalidades.length ? c.row.modalidades.join("; ") : "—"}</td>
                  </>
                ) : (
                  <td colSpan={5} className="muted">
                    Sin datos suficientes
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
