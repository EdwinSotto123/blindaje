import { COUNT_BANDS, type CountBand } from "@blindaje/shared";
import { bandIndex, bandLabel } from "../lib/bands";
import { fmtDayMonth } from "../lib/format";
import { Icon } from "./Icons";

export interface BandRow {
  key: string;
  label: string;
  /** null: no alcanza el umbral; se dibuja la ausencia. */
  band: CountBand | null;
  /** Anotación corta al lado de la etiqueta ("tu rubro", "hasta hoy"). */
  mark?: string;
}

/**
 * Renglones con rangos: cada renglón tiene cuatro peldaños (5-9, 10-19, 20-49, 50+) y se pintan en
 * terracota hasta el rango que corresponde. Los peldaños son una escala ordenada, no una cifra: no hay un
 * cuadro por caso, porque lo público nunca dice cuántos casos exactos hay. Un renglón sin rango se
 * dibuja punteado. El dibujo es decorativo para lectores de pantalla: la leyenda dice la tendencia en
 * una frase y la tabla alternativa trae todos los rangos.
 */
export function BandLedger({
  rows,
  labelHead,
  summary,
  tableCaption,
  tableToggle,
}: {
  rows: BandRow[];
  labelHead: string;
  summary: string;
  tableCaption: string;
  /** Texto del botón que abre la tabla; distinto por gráfico para que no haya dos iguales. */
  tableToggle: string;
}) {
  return (
    <div className="ledger-wrap">
      <figure className="ledger-figure">
        <div className="ledger" aria-hidden="true">
          <div className="ledger-row ledger-head">
            <span className="ledger-label">{labelHead}</span>
            <span className="ledger-steps ledger-scale">
              {COUNT_BANDS.map((b) => (
                <span key={b}>{b}</span>
              ))}
            </span>
            <span className="ledger-value">Casos</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="ledger-row" data-empty={r.band === null ? "" : undefined}>
              <span className="ledger-label">
                {r.label}
                {r.mark ? <em> {r.mark}</em> : null}
              </span>
              <span className="ledger-steps">
                {r.band === null ? (
                  <i className="ledger-absent" />
                ) : (
                  COUNT_BANDS.map((b, i) => <i key={b} data-on={i <= bandIndex(r.band!) ? "" : undefined} />)
                )}
              </span>
              <span className="ledger-value">{r.band === null ? "sin datos" : r.band}</span>
            </div>
          ))}
        </div>
        <figcaption>
          <span>{summary}</span>{" "}
          <span className="muted">
            Son rangos, no cifras exactas. Un renglón punteado no llega a 5 casos de 3 personas y va sin datos.
          </span>
        </figcaption>
      </figure>
      <details className="table-alt">
        <summary>
          <Icon name="table" size={18} />
          {tableToggle}
        </summary>
        <div className="table-scroll" role="region" aria-label={tableCaption} tabIndex={0}>
          <table>
            <caption>{tableCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{labelHead}</th>
                <th scope="col">Casos (rango)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    {r.label}
                    {r.mark ? ` (${r.mark})` : ""}
                  </th>
                  <td>{r.band === null ? "Sin datos: menos del mínimo" : bandLabel(r.band)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** La tendencia por semana en una frase, con rangos: nunca una cifra exacta. */
export function bandTrendSummary(tendencia: { semana: string; casos: CountBand | null }[]): string {
  const known = tendencia.filter((t): t is { semana: string; casos: CountBand } => t.casos !== null);
  const missing = tendencia.length - known.length;
  const tail = missing > 0 ? ` ${missing === 1 ? "Una semana no llega" : `${missing} semanas no llegan`} al mínimo y ${missing === 1 ? "va" : "van"} sin datos.` : "";
  if (known.length === 0) return "Todavía no hay semanas con casos suficientes para mostrar un rango.";
  const first = known[0]!;
  const last = known[known.length - 1]!;
  if (known.length === 1) return `Solo la semana del ${fmtDayMonth(first.semana)} llega al mínimo: ${bandLabel(first.casos)} casos.${tail}`;
  const span = `entre la semana del ${fmtDayMonth(first.semana)} y la del ${fmtDayMonth(last.semana)}`;
  const a = bandIndex(first.casos);
  const b = bandIndex(last.casos);
  if (b > a) return `Los casos por semana subieron del rango de ${bandLabel(first.casos)} al de ${bandLabel(last.casos)} ${span}.${tail}`;
  if (b < a) return `Los casos por semana bajaron del rango de ${bandLabel(first.casos)} al de ${bandLabel(last.casos)} ${span}.${tail}`;
  return `Los casos por semana se mantuvieron en el rango de ${bandLabel(last.casos)} ${span}.${tail}`;
}
