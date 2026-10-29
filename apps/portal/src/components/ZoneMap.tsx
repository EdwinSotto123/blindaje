import { DISTRICT_GRID, DISTRICTS, type District, type PublicZoneCell, type PublicZoneMap, type ZoneLevel } from "@blindaje/shared";
import { useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { bandLabel, bandPhrase } from "../lib/bands";
import { choiceSearch, filterDistricts, type Rubro } from "../lib/choice";

/** Nivel del mapa en palabras. "sin_datos" es igual para cero casos y para menos del umbral. */
export const NIVEL_MAPA: Record<ZoneLevel, string> = {
  sin_datos: "Sin datos",
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
};

const TENDENCIA: Record<NonNullable<PublicZoneCell["tendencia"]>, { short: string; phrase: string }> = {
  sube: { short: "Sube", phrase: "van en aumento" },
  estable: { short: "Estable", phrase: "se mantienen" },
  baja: { short: "Baja", phrase: "van bajando" },
};

const LEGEND: ZoneLevel[] = ["sin_datos", "bajo", "medio", "alto"];
const LEVEL_ORDER: Record<ZoneLevel, number> = { alto: 0, medio: 1, bajo: 2, sin_datos: 3 };
const BAND_ORDER = ["50+", "20-49", "10-19", "5-9"];

function emptyCell(distrito: string): PublicZoneCell {
  return { distrito, nivel: "sin_datos", casos: null, tendencia: null, modalidades: [] };
}

/** La celda que se dibuja: sin rango, siempre "sin datos" (la vista no distingue cero de "bajo el umbral"). */
function cellOf(map: PublicZoneMap, id: string): PublicZoneCell {
  const c = map.celdas.find((x) => x.distrito === id);
  return c && c.nivel !== "sin_datos" && c.casos ? c : emptyCell(id);
}

/** Lo que dice un lector de pantalla de cada distrito, y la línea de detalle. */
export function cellSentence(d: District, c: PublicZoneCell): string {
  if (c.nivel === "sin_datos" || !c.casos) return `${d.name}: sin datos`;
  const tend = c.tendencia ? `, ${TENDENCIA[c.tendencia].phrase}` : "";
  return `${d.name}: riesgo ${NIVEL_MAPA[c.nivel].toLowerCase()}, ${bandPhrase(c.casos)}${tend}`;
}

/** Lo que sigue al nombre visible del cuadro, para lectores de pantalla: " (San Juan de Lurigancho): riesgo alto, …". */
export function cellTail(d: District, c: PublicZoneCell): string {
  // "Lurigancho" + " (Chosica)"; "SJL" + " (San Juan de Lurigancho)"; "Ate" + "".
  const full = d.short === d.name ? "" : d.name.startsWith(d.short) ? d.name.slice(d.short.length) : ` (${d.name})`;
  return `${full}${cellSentence(d, c).slice(d.name.length)}`;
}

/** Leyenda del mapa: cuatro muestras, de "sin datos" a "alto", y el marco de "tu distrito". */
export function MapLegend({ selected }: { selected?: District | null }) {
  return (
    <ul className="zlegend" aria-label="Leyenda del mapa">
      {LEGEND.map((n) => (
        <li key={n}>
          <span className="zswatch" data-nivel={n} aria-hidden="true" />
          {NIVEL_MAPA[n]}
        </li>
      ))}
      {selected ? (
        <li>
          <span className="zswatch zswatch-mine" aria-hidden="true" />
          Tu distrito ({selected.name})
        </li>
      ) : null}
    </ul>
  );
}

/** Los distritos que llegan al mínimo, del riesgo más alto al más bajo (lo mismo que ya se ve en el mapa). */
export function rankedCells(map: PublicZoneMap): { d: District; c: PublicZoneCell }[] {
  return DISTRICTS.map((d) => ({ d, c: cellOf(map, d.id) }))
    .filter((x) => x.c.casos)
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.c.nivel] - LEVEL_ORDER[b.c.nivel] ||
        BAND_ORDER.indexOf(a.c.casos ?? "") - BAND_ORDER.indexOf(b.c.casos ?? "") ||
        a.d.name.localeCompare(b.d.name, "es"),
    );
}

/**
 * Mapa esquemático: una grilla de 9 × 14 cuadros (DISTRICTS[].col/row, norte arriba), un cuadro por
 * distrito, sin mapa base, sin calles ni coordenadas. El color es el nivel (una sola tinta, de claro a
 * oscuro) y el texto, el rango. "Sin datos" es un cuadro gris claro, sin rango. Cada cuadro abre su
 * distrito. Al lado (abajo en el celular), el detalle del distrito bajo el puntero o el foco y la
 * lista de los distritos con datos; pasar por la lista marca el cuadro en el mapa.
 */
export function ZoneMap({ map, selected, rubro }: { map: PublicZoneMap; selected: District | null; rubro: Rubro | null }) {
  const [focus, setFocus] = useState<string | null>(null);
  const shown = DISTRICTS.find((d) => d.id === (focus ?? selected?.id)) ?? null;
  const shownCell = shown ? cellOf(map, shown.id) : null;
  const ranked = rankedCells(map);
  const gridStyle = { "--cols": DISTRICT_GRID.cols, "--rows": DISTRICT_GRID.rows } as CSSProperties;

  return (
    <figure className="zmap">
      <a className="skip-inline" href="#lista-distritos">
        Saltar el mapa e ir a la lista de distritos
      </a>
      <MapLegend selected={selected} />
      <div className="zmap-frame">
        <span className="zmap-north" aria-hidden="true">
          Norte
        </span>
        <ul className="zmap-grid" style={gridStyle} aria-label="Distritos de Lima y el Callao, de norte a sur" onMouseLeave={() => setFocus(null)}>
          {DISTRICTS.map((d) => {
            const c = cellOf(map, d.id);
            const mine = d.id === selected?.id;
            return (
              <li key={d.id} style={{ gridColumn: d.col + 1, gridRow: d.row + 1 }}>
                <Link
                  className="zcell"
                  data-nivel={c.nivel}
                  data-focus={focus === d.id ? "" : undefined}
                  aria-current={mine ? "true" : undefined}
                  to={{ pathname: "/", search: choiceSearch({ distrito: d.id, rubro }) }}
                  onMouseEnter={() => setFocus(d.id)}
                  onFocus={() => setFocus(d.id)}
                  onBlur={() => setFocus(null)}
                >
                  {/* El nombre accesible empieza con el nombre visible ("SJL") y sigue con el detalle. */}
                  <span className="zcell-name">{d.short}</span>
                  <span className="sr-only">{cellTail(d, c)}</span>
                  {c.casos ? (
                    <span className="zcell-band" aria-hidden="true">
                      {c.casos}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="zmap-side">
        {/* Detalle del distrito bajo el puntero o el foco. Lo mismo está en la tabla, para lectores de pantalla. */}
        <div className="zreadout" aria-hidden="true">
          {shown && shownCell ? (
            <>
              <p>
                <strong>{shown.name}</strong> <span className="muted">· {shown.area}</span>
              </p>
              <p>
                {shownCell.casos ? (
                  <>
                    Riesgo{" "}
                    <mark className="level" data-nivel={shownCell.nivel}>
                      {NIVEL_MAPA[shownCell.nivel].toLowerCase()}
                    </mark>
                    , {bandPhrase(shownCell.casos)}
                    {shownCell.tendencia ? `; ${TENDENCIA[shownCell.tendencia].phrase}` : ""}.
                  </>
                ) : (
                  "Sin datos: no tiene casos o no llega a 5 casos de 3 personas. No se distingue cuál de las dos."
                )}
              </p>
              {shownCell.modalidades.length ? <p className="muted small">{shownCell.modalidades.join(" · ")}</p> : null}
            </>
          ) : (
            <p className="muted">Pasa el puntero por un distrito para ver su detalle, o tócalo para abrirlo.</p>
          )}
        </div>
        {ranked.length ? (
          <div className="zrank">
            <p className="zrank-title">Dónde hay datos</p>
            <p className="muted small">Distritos con al menos 5 casos de 3 personas, del riesgo más alto al más bajo.</p>
            <ol className="zrank-list" onMouseLeave={() => setFocus(null)}>
              {ranked.map(({ d, c }) => (
                <li key={d.id}>
                  <Link
                    to={{ pathname: "/", search: choiceSearch({ distrito: d.id, rubro }) }}
                    aria-current={d.id === selected?.id ? "true" : undefined}
                    onMouseEnter={() => setFocus(d.id)}
                    onFocus={() => setFocus(d.id)}
                    onBlur={() => setFocus(null)}
                  >
                    <span className="zdot" data-nivel={c.nivel} aria-hidden="true" />
                    <span className="zrank-name">{d.name}</span>
                    <span className="zrank-val">
                      {NIVEL_MAPA[c.nivel]} · {c.casos}
                      {c.tendencia === "sube" ? <span className="zrank-trend"> · sube</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
      <figcaption className="muted small">
        Es un esquema, no un mapa a escala: cada cuadro es un distrito en su posición aproximada, con el norte arriba. No muestra calles,
        límites ni lugares dentro del distrito.
      </figcaption>
    </figure>
  );
}

/** La tabla de los 50 distritos: la versión accesible del mapa y, en el celular, la forma principal de elegir. */
export function ZoneTable({ map, selected, rubro }: { map: PublicZoneMap; selected: District | null; rubro: Rubro | null }) {
  const groups = filterDistricts("");
  return (
    <div className="table-scroll ztable-wrap" role="region" aria-labelledby="ztable-caption" tabIndex={0}>
      <table className="ztable">
        <caption id="ztable-caption">Nivel y rango de casos de cada distrito en los últimos {map.periodo_dias} días</caption>
        <thead>
          <tr>
            <th scope="col">Distrito</th>
            <th scope="col">Nivel</th>
            <th scope="col">Casos</th>
            <th scope="col">Tendencia</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.area}>
            <tr className="ztable-area">
              <th scope="colgroup" colSpan={4}>
                {g.area}
              </th>
            </tr>
            {g.districts.map((d) => {
              const c = cellOf(map, d.id);
              const mine = d.id === selected?.id;
              return (
                <tr key={d.id} data-mine={mine ? "" : undefined}>
                  <th scope="row">
                    <Link to={{ pathname: "/", search: choiceSearch({ distrito: d.id, rubro }) }} aria-current={mine ? "true" : undefined}>
                      {d.name}
                    </Link>
                    {mine ? <span className="ztable-mine"> (tu distrito)</span> : null}
                    {c.modalidades.length ? <span className="ztable-mods">{c.modalidades.join(" · ")}</span> : null}
                  </th>
                  {c.casos ? (
                    <>
                      <td className="nowrap">
                        <span className="zdot" data-nivel={c.nivel} aria-hidden="true" />
                        {NIVEL_MAPA[c.nivel]}
                      </td>
                      <td className="num nowrap">{bandLabel(c.casos)}</td>
                      <td>{c.tendencia ? TENDENCIA[c.tendencia].short : "Sin dato"}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="muted">
                      <span className="zdot" data-nivel="sin_datos" aria-hidden="true" />
                      Sin datos
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
