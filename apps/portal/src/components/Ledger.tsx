import { casos, fmtDayMonth } from "../lib/format";
import { Icon } from "./Icons";

export interface LedgerRow {
  key: string;
  label: string;
  /** null: no alcanza el umbral; se dibuja la ausencia. */
  value: number | null;
  /** Anotación corta al lado de la etiqueta ("tu rubro", "hasta hoy"). */
  mark?: string;
}

/** Cuadros por renglón antes de pasar al siguiente, como cuando se cuenta en un cuaderno. */
export const CELLS_PER_LINE = 10;

/** Cuántos renglones de cuadros ocupa una cifra (siempre un cuadro por caso, sin redondear). */
export function cellLines(value: number): number {
  return Math.max(1, Math.ceil(value / CELLS_PER_LINE));
}

/**
 * Gráfico de renglones sobre el cuadriculado: cada caso es un cuadro pintado en tinta (de 10 en
 * 10) y un renglón sin cifra se dibuja punteado. El dibujo es decorativo para lectores de pantalla:
 * la leyenda dice la tendencia en una frase y la tabla alternativa trae todos los números.
 */
export function Ledger({
  rows,
  labelHead,
  summary,
  tableCaption,
  tableToggle,
}: {
  rows: LedgerRow[];
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
            <span className="ledger-cells" />
            <span className="ledger-value">Casos</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="ledger-row" data-empty={r.value === null ? "" : undefined}>
              <span className="ledger-label">
                {r.label}
                {r.mark ? <em> {r.mark}</em> : null}
              </span>
              <span className="ledger-cells">
                {r.value === null ? <i className="ledger-absent" /> : Array.from({ length: r.value }, (_, i) => <i key={i} />)}
              </span>
              <span className="ledger-value">{r.value === null ? "sin cifra" : r.value.toLocaleString("es-PE")}</span>
            </div>
          ))}
        </div>
        <figcaption>
          <span>{summary}</span>{" "}
          <span className="pencil">Cada cuadro es un caso. Un renglón punteado no llega a 5 casos de 3 personas y va sin cifra.</span>
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
                <th scope="col">Casos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    {r.label}
                    {r.mark ? ` (${r.mark})` : ""}
                  </th>
                  <td className="num">{r.value === null ? "Sin cifra: menos del mínimo" : casos(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** La tendencia en una frase, para la leyenda del gráfico y los lectores de pantalla. */
export function trendSummary(tendencia: { semana: string; casos: number | null }[]): string {
  const known = tendencia.filter((t): t is { semana: string; casos: number } => t.casos !== null);
  const missing = tendencia.length - known.length;
  const tail = missing > 0 ? ` ${missing === 1 ? "Una semana no llega" : `${missing} semanas no llegan`} al mínimo y ${missing === 1 ? "va" : "van"} sin cifra.` : "";
  if (known.length === 0) return "Todavía no hay semanas con casos suficientes para mostrar cifras.";
  const first = known[0]!;
  const last = known[known.length - 1]!;
  if (known.length === 1) return `Solo la semana del ${fmtDayMonth(first.semana)} tiene cifra: ${casos(first.casos)}.${tail}`;
  const span = `entre la semana del ${fmtDayMonth(first.semana)} y la del ${fmtDayMonth(last.semana)}`;
  if (last.casos > first.casos) return `Los casos por semana subieron de ${first.casos} a ${last.casos} ${span}.${tail}`;
  if (last.casos < first.casos) return `Los casos por semana bajaron de ${first.casos} a ${last.casos} ${span}.${tail}`;
  return `Los casos por semana se mantuvieron en ${last.casos} ${span}.${tail}`;
}
