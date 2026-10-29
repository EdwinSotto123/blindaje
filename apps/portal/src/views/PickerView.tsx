import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Icon } from "../components/Icons";
import { PageHead } from "../components/ui";
import { choiceSearch, filterDistricts, RUBRO_LABEL, RUBROS, useChoice, type Rubro } from "../lib/choice";

/**
 * Elegir distrito y rubro. Es lo primero que ve quien llega sin zona en la URL. El rubro es opcional
 * (un vecino sin negocio ve todos los rubros); cada distrito es un enlace que ya lleva el rubro, así
 * que elegir es un solo toque.
 */
export function PickerView({ notFound = false }: { notFound?: boolean }) {
  const choice = useChoice();
  const [rubro, setRubro] = useState<Rubro | null>(choice.rubro);
  return (
    <>
      <PageHead title="¿Qué zona quieres ver?" margin="Empieza">
        <p>
          Elige tu distrito y, si tienes un negocio, tu rubro. Verás el riesgo de la zona y los avisos y consejos que aprobó el equipo de Blindaje. No
          necesitas cuenta.
        </p>
      </PageHead>
      {notFound ? (
        <div className="note" role="status">
          <Icon name="info" />
          <p>No encontramos ese distrito. Elige uno de la lista.</p>
        </div>
      ) : null}
      <DistrictPicker rubro={rubro} onRubro={setRubro} current={choice.distrito?.id ?? null} />
    </>
  );
}

/** El selector en sí, sin llamadas a la API (se puede probar con un render estático). */
export function DistrictPicker({
  rubro,
  onRubro,
  current,
  initialQuery = "",
}: {
  rubro: Rubro | null;
  onRubro: (r: Rubro | null) => void;
  current: string | null;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const navigate = useNavigate();
  const ids = useId();
  const groups = filterDistricts(query);
  const count = groups.reduce((n, g) => n + g.districts.length, 0);

  // Enter con un solo resultado abre ese distrito.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const only = count === 1 ? groups[0]!.districts[0]! : null;
    if (only) navigate({ pathname: "/", search: choiceSearch({ distrito: only.id, rubro }) });
  };

  return (
    <div className="picker">
      <div className="field picker-rubro">
        <label htmlFor={`${ids}-rubro`}>Tu rubro (opcional)</label>
        <select
          id={`${ids}-rubro`}
          value={rubro ?? ""}
          onChange={(e) => onRubro((RUBROS as readonly string[]).includes(e.target.value) ? (e.target.value as Rubro) : null)}
        >
          <option value="">Todos los rubros (no tengo negocio)</option>
          {RUBROS.map((r) => (
            <option key={r} value={r}>
              {RUBRO_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      <form role="search" className="field picker-search" onSubmit={submit} aria-label="Buscar distrito">
        <label htmlFor={`${ids}-q`}>Busca tu distrito</label>
        <span className="search-box">
          <Icon name="search" size={20} />
          <input
            id={`${ids}-q`}
            type="search"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Por ejemplo, Ate o Comas"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-describedby={`${ids}-count`}
          />
        </span>
        <p id={`${ids}-count`} className="pencil small" role="status" aria-live="polite">
          {count === 0 ? "Ningún distrito coincide. Prueba con otra parte del nombre." : count === 50 ? "50 distritos de Lima y el Callao." : `${count} ${count === 1 ? "distrito coincide" : "distritos coinciden"}.`}
        </p>
      </form>

      <div className="picker-groups">
        {groups.map((g, gi) => (
          <section key={g.area} className="picker-group" aria-labelledby={`${ids}-g${gi}`}>
            <h2 id={`${ids}-g${gi}`}>{g.area}</h2>
            <ul className="district-list">
              {g.districts.map((d) => (
                <li key={d.id}>
                  <Link to={{ pathname: "/", search: choiceSearch({ distrito: d.id, rubro }) }} aria-current={d.id === current ? "true" : undefined}>
                    {d.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="picker-map">
        <Icon name="map" size={20} />
        <span>
          ¿Prefieres verlo en un esquema? <Link to={{ pathname: "/mapa", search: choiceSearch({ rubro }) }}>Mira el mapa de Lima y el Callao</Link>.
        </span>
      </p>
    </div>
  );
}
