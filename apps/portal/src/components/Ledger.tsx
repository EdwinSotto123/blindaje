import { casos, fmtDayMonth } from "../lib/format";
import { Icon } from "./Icons";

export interface LedgerRow {
  key: string;
  label: string;
  /** null: no alcanza el umbral; se dibuja la ausencia. */
  value: number | null;
  /** Anotación corta al lado de la etiqueta ("tu sector", "en curso"). */
  mark?: string;
}

/** Máximo de cuadros por renglón; con más casos, cada cuadro vale más de uno. */
const MAX_CELLS = 10;

export function perCell(rows: LedgerRow[]): number {
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  return max <= MAX_CELLS ? 1 : Math.ceil(max / MAX_CELLS);
}

export function cellsFor(value: number, unit: number): number {
  if (value <= 0) return 0;
  return Math.max(1, Math.round(value / unit));
}

/**
 * Gráfico de renglones sobre el cuadriculado: cada caso es un cuadro pintado en tinta y un renglón
 * sin cifra se dibuja punteado. El dibujo es decorativo para lectores de pantalla: la leyenda dice
 * la tendencia en una frase y la tabla alternativa trae todos los números.
 */
export function Ledger({
  rows,
  labelHead,
  summary,
  tableCaption,
}: {
  rows: LedgerRow[];
  labelHead: string;
  summary: string;
  tableCaption: string;
}) {
  const unit = perCell(rows);
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
                {r.value === null ? (
                  <i className="ledger-absent" />
                ) : (
                  Array.from({ length: cellsFor(r.value, unit) }, (_, i) => <i key={i} />)
                )}
              </span>
              <span className="ledger-value">{r.value === null ? "sin cifra" : r.value.toLocaleString("es-PE")}</span>
            </div>
          ))}
        </div>
        <figcaption>
          <span>{summary}</span>{" "}
          <span className="pencil">
            Cada cuadro es {unit === 1 ? "un caso" : `${unit} casos`}. Un renglón punteado no alcanza el mínimo para mostrar la cifra.
          </span>
        </figcaption>
      </figure>
      <details className="table-alt">
        <summary>
          <Icon name="table" size={18} />
          Ver los números en una tabla
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
  const tail = missing > 0 ? ` ${missing === 1 ? "Una semana no tiene" : `${missing} semanas no tienen`} cifra.` : "";
  if (known.length === 0) return "Todavía no hay semanas con casos suficientes para mostrar cifras.";
  const first = known[0]!;
  const last = known[known.length - 1]!;
  if (known.length === 1) return `Solo la semana del ${fmtDayMonth(first.semana)} tiene cifra: ${casos(first.casos)}.${tail}`;
  const span = `entre la semana del ${fmtDayMonth(first.semana)} y la del ${fmtDayMonth(last.semana)}`;
  if (last.casos > first.casos) return `Los casos por semana subieron de ${first.casos} a ${last.casos} ${span}.${tail}`;
  if (last.casos < first.casos) return `Los casos por semana bajaron de ${first.casos} a ${last.casos} ${span}.${tail}`;
  return `Los casos por semana se mantuvieron en ${last.casos} ${span}.${tail}`;
}
