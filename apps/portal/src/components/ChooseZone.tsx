import { Link } from "react-router";
import { choiceSearch, type Rubro } from "../lib/choice";

/** Para las páginas que dependen del distrito cuando todavía no hay uno elegido. */
export function ChooseZone({ what, rubro }: { what: string; rubro: Rubro | null }) {
  return (
    <div className="empty">
      <p className="strong">Primero elige tu distrito</p>
      <p>
        Los {what} van por distrito. <Link to={{ pathname: "/elegir", search: choiceSearch({ rubro }) }}>Elige tu distrito</Link> o búscalo en el{" "}
        <Link to={{ pathname: "/mapa", search: choiceSearch({ rubro }) }}>mapa</Link>.
      </p>
    </div>
  );
}
