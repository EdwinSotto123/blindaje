import type { CostsResponse } from "../api/types";
import { useApi } from "../app/context";
import { Icon } from "../components/Icons";
import { ErrorBox, Loading, Notice, PageHead } from "../components/ui";
import { NONESSENTIAL_BLOCK_PCT } from "../config";
import { fmtDate, fmtInt, fmtPct, fmtStamp, fmtUsd } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const UNIT_LABEL: Record<string, string> = {
  input_tokens: "tokens de entrada",
  output_tokens: "tokens de salida",
  cached_tokens: "tokens en caché",
  audio_seconds: "min de audio",
  images: "imágenes",
  frames: "frames de video",
};

export function fmtUnits(units: Record<string, number>): string {
  return Object.entries(units)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => (k === "audio_seconds" ? `${fmtInt(v / 60)} ${UNIT_LABEL[k]}` : `${fmtInt(v)} ${UNIT_LABEL[k] ?? k}`))
    .join(" · ");
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  ok: { label: "Correcta", cls: "chip chip-mint" },
  cached: { label: "Desde caché", cls: "chip chip-grid" },
  blocked: { label: "Bloqueada", cls: "chip chip-danger" },
  error: { label: "Error", cls: "chip chip-danger" },
};

export function CostsView() {
  const api = useApi();
  const costs = useAsync(() => api.costs(), "costs");
  return (
    <>
      <PageHead
        title="Costos de la Meta Model API"
        actions={
          <button type="button" className="btn btn-sm" onClick={costs.reload} disabled={costs.loading}>
            <Icon name="refresh" size={15} /> Actualizar
          </button>
        }
      >
        Cada llamada registra el modelo, las unidades y el costo estimado. Al llegar al {NONESSENTIAL_BLOCK_PCT}% del presupuesto se bloquean las llamadas no
        esenciales (Muse Wonder y Muse Image).
      </PageHead>
      {costs.error ? <ErrorBox error={costs.error} onRetry={costs.reload} /> : null}
      {!costs.data && costs.loading ? <Loading /> : null}
      {costs.data ? <CostsBody c={costs.data} /> : null}
    </>
  );
}

function CostsBody({ c }: { c: CostsResponse }) {
  const pct = Math.min(Math.max(c.pct, 0), 100);
  const maxModel = Math.max(...c.by_model.map((m) => m.cost_usd), 0.0001);
  const maxDay = Math.max(...c.by_day.map((d) => d.cost_usd), 0.0001);
  const remaining = Math.max(c.budget_usd - c.total_usd, 0);
  const toBlock = Math.max((c.budget_usd * NONESSENTIAL_BLOCK_PCT) / 100 - c.total_usd, 0);

  return (
    <div className="stack">
      <section className="panel stack-sm" aria-labelledby="presupuesto-titulo">
        <h2 id="presupuesto-titulo">Gasto frente al presupuesto</h2>
        <div className="budget-figure">
          <span className="v">{fmtUsd(c.total_usd)}</span>
          <span className="muted">
            de {fmtUsd(c.budget_usd, 0)} · {fmtPct(c.pct, 1)} usado
          </span>
          {c.nonessential_blocked ? (
            <span className="chip chip-danger">
              <Icon name="lock" size={14} /> No esenciales bloqueadas
            </span>
          ) : (
            <span className="chip chip-mint">
              <Icon name="check" size={14} /> No esenciales permitidas
            </span>
          )}
        </div>
        <div
          className="budget-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={c.budget_usd}
          aria-valuenow={c.total_usd}
          aria-valuetext={`${fmtUsd(c.total_usd)} de ${fmtUsd(c.budget_usd, 0)}, ${fmtPct(c.pct, 1)}`}
          aria-label="Gasto frente al presupuesto"
        >
          <div className="fill" style={{ width: `${pct}%`, borderRadius: pct >= 99 ? 6 : undefined }} />
          <div className="limit" style={{ left: `${NONESSENTIAL_BLOCK_PCT}%` }} aria-hidden="true" />
        </div>
        <div className="budget-scale" aria-hidden="true">
          <span style={{ left: "0%", transform: "none" }}>US$ 0</span>
          <span style={{ left: `${NONESSENTIAL_BLOCK_PCT}%` }}>Bloqueo {NONESSENTIAL_BLOCK_PCT} %</span>
          <span style={{ left: "100%", transform: "translateX(-100%)" }}>{fmtUsd(c.budget_usd, 0)}</span>
        </div>
        {c.nonessential_blocked ? (
          <Notice kind="warn">Se superó el {NONESSENTIAL_BLOCK_PCT}% del presupuesto: Muse Wonder y Muse Image quedan bloqueados. Las llamadas esenciales siguen.</Notice>
        ) : (
          <p className="small muted">
            Quedan {fmtUsd(remaining)}. Faltan {fmtUsd(toBlock)} para el bloqueo de llamadas no esenciales.
          </p>
        )}
      </section>

      <div className="grid-2">
        <section className="panel stack-sm" aria-labelledby="modelo-titulo">
          <h2 id="modelo-titulo">Por modelo</h2>
          <div className="bars">
            {c.by_model.map((m) => (
              <div key={m.model} className="bar-row">
                <code className="break">{m.model}</code>
                <div className="bar-track" aria-hidden="true">
                  <div className="bar-fill" style={{ width: `${(m.cost_usd / maxModel) * 100}%` }} />
                </div>
                <span className="num strong" style={{ textAlign: "right" }}>
                  {fmtUsd(m.cost_usd)}
                </span>
              </div>
            ))}
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Gasto por modelo (se desplaza a los lados)">
            <table className="table">
              <caption className="sr-only">Gasto por modelo</caption>
              <thead>
                <tr>
                  <th scope="col">Modelo</th>
                  <th scope="col" className="num">
                    Llamadas
                  </th>
                  <th scope="col">Unidades</th>
                  <th scope="col" className="num">
                    Costo
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.by_model.map((m) => (
                  <tr key={m.model}>
                    <td>
                      <code>{m.model}</code>
                    </td>
                    <td className="num">{fmtInt(m.calls)}</td>
                    <td className="small">{fmtUnits(m.units) || "—"}</td>
                    <td className="num">{fmtUsd(m.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel stack-sm" aria-labelledby="dia-titulo">
          <h2 id="dia-titulo">Por día (hora de Lima)</h2>
          <ul className="list-plain bars" aria-label="Gasto por día">
            {c.by_day.map((d) => (
              <li key={d.day} className="bar-row">
                <span>{fmtDate(d.day)}</span>
                <div className="bar-track" aria-hidden="true">
                  <div className="bar-fill" style={{ width: `${(d.cost_usd / maxDay) * 100}%` }} />
                </div>
                <span className="num strong" style={{ textAlign: "right" }}>
                  {fmtUsd(d.cost_usd)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="stack-sm" aria-labelledby="recientes-titulo">
        <h2 id="recientes-titulo">Llamadas recientes</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Llamadas recientes (se desplaza a los lados)">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Hora</th>
                <th scope="col">Modelo</th>
                <th scope="col">Operación</th>
                <th scope="col">Estado</th>
                <th scope="col" className="num">
                  Costo
                </th>
              </tr>
            </thead>
            <tbody>
              {c.recent.map((r, i) => {
                const st = STATUS_CHIP[r.status] ?? { label: r.status, cls: "chip chip-grid" };
                return (
                  <tr key={`${r.ts}-${i}`}>
                    <td className="nowrap">{fmtStamp(r.ts)}</td>
                    <td>
                      <code>{r.model}</code>
                    </td>
                    <td>{r.operation}</td>
                    <td>
                      <span className={st.cls}>{st.label}</span>
                    </td>
                    <td className="num">{fmtUsd(r.cost_usd, 4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
