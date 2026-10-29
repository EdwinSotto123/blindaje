import type { NetworkView } from "../api/types";
import { fmtDateTime, fmtShortDate } from "../lib/format";
import { CiteList } from "./Citations";

type Event = NetworkView["timeline"][number];

const DAY = 86_400_000;

/**
 * Línea de tiempo de la red: un carril por caso sobre un eje de fechas (decorativo) y la lista de
 * eventos (accesible), con sus citas.
 */
export function Timeline({
  events,
  activeCase,
  onPickCase,
}: {
  events: Event[];
  activeCase: string | null;
  onPickCase: (code: string) => void;
}) {
  if (events.length === 0) return <p className="muted">Sin eventos.</p>;
  const sorted = [...events].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
  const cases = [...new Set(sorted.map((e) => e.caso))];
  const t0 = new Date(sorted[0]!.fecha).getTime() - DAY / 2;
  const t1 = new Date(sorted[sorted.length - 1]!.fecha).getTime() + DAY / 2;
  const W = 1000;
  const left = 44;
  const right = 16;
  const laneH = 26;
  const top = 10;
  const H = top + cases.length * laneH + 30;
  const x = (iso: string) => left + ((new Date(iso).getTime() - t0) / Math.max(t1 - t0, DAY)) * (W - left - right);

  // Marcas del eje: cada ~7 días según el rango.
  const spanDays = (t1 - t0) / DAY;
  const step = spanDays > 40 ? 14 : spanDays > 14 ? 7 : spanDays > 6 ? 2 : 1;
  const ticks: number[] = [];
  const start = new Date(t0);
  start.setUTCHours(17, 0, 0, 0);
  for (let t = start.getTime(); t <= t1; t += step * DAY) ticks.push(t);

  return (
    <div className="stack-sm">
      <div className="timeline-axis" aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H * 0.9 }}>
          {cases.map((c, i) => {
            const y = top + i * laneH + laneH / 2;
            const active = activeCase === c;
            return (
              <g key={c}>
                <line x1={left} x2={W - right} y1={y} y2={y} className={active ? "tl-lane active" : "tl-lane"} />
                <text x={8} y={y + 5} className="tl-case">
                  {c}
                </text>
                {sorted
                  .filter((e) => e.caso === c)
                  .map((e, k) => (
                    <circle key={k} cx={x(e.fecha)} cy={y} r={active ? 7 : 6} className={active ? "tl-dot active" : "tl-dot"} />
                  ))}
              </g>
            );
          })}
          {ticks.map((t) => {
            const iso = new Date(t).toISOString();
            const tx = x(iso);
            return (
              <g key={t}>
                <line x1={tx} x2={tx} y1={top} y2={H - 22} className="tl-tick" />
                <text x={tx} y={H - 6} textAnchor="middle" className="tl-tick-label">
                  {fmtShortDate(iso)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ol className="timeline-list" aria-label="Eventos en orden cronológico">
        {sorted.map((e, i) => (
          <li key={i} className={activeCase === e.caso ? "active" : undefined}>
            <span className="small muted">{fmtDateTime(e.fecha)}</span>
            <span>
              <button type="button" className="btn btn-sm" onClick={() => onPickCase(e.caso)} aria-label={`Resaltar el caso ${e.caso} en el grafo`}>
                Caso {e.caso}
              </button>
            </span>
            <span>
              {e.texto} <CiteList refs={e.evidencia} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
