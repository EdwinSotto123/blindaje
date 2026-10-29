import type { District, PublicZoneMap } from "@blindaje/shared";
import { Link } from "react-router";
import { useApi, useDemoData } from "../app/context";
import { Icon } from "../components/Icons";
import { ErrorBox, Loading, Note, PageHead, Section } from "../components/ui";
import { NIVEL_MAPA, ZoneMap, ZoneTable } from "../components/ZoneMap";
import { THRESHOLD_RULE } from "../config";
import { bandPhrase } from "../lib/bands";
import { choiceSearch, useChoice, type Rubro } from "../lib/choice";
import { fmtUpdated } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function MapView() {
  const api = useApi();
  const { distrito, rubro } = useChoice();
  const zones = useAsync(() => api.zones(), "zones");
  useDemoData(zones.data?.demo);

  return (
    <>
      <PageHead title="Mapa de Lima y el Callao" margin="Mapa">
        <p>
          Cómo está la extorsión en cada distrito, con los casos que las personas registraron en Blindaje
          {zones.data ? ` en los últimos ${zones.data.periodo_dias} días.` : "."}
          {zones.data?.actualizado ? ` Actualizado el ${endSentence(fmtUpdated(zones.data.actualizado))}` : ""}
        </p>
      </PageHead>
      {zones.error ? <ErrorBox error={zones.error} onRetry={zones.reload} /> : null}
      {zones.loading && !zones.data ? <Loading label="Cargando el mapa…" /> : null}
      {zones.data ? <MapPage map={zones.data} selected={distrito} rubro={rubro} /> : null}
    </>
  );
}

function endSentence(s: string): string {
  return s.endsWith(".") ? s : `${s}.`;
}

/** El mapa ya cargado (sin llamadas a la API, para poder probarlo con un render estático). */
export function MapPage({ map, selected, rubro }: { map: PublicZoneMap; selected: District | null; rubro: Rubro | null }) {
  const mine = selected ? map.celdas.find((c) => c.distrito === selected.id) : undefined;
  return (
    <>
      {selected ? (
        <p className="answer-line map-mine">
          {mine && mine.nivel !== "sin_datos" && mine.casos ? (
            <>
              {selected.name}: riesgo <mark className="hl">{NIVEL_MAPA[mine.nivel].toLowerCase()}</mark>, {bandPhrase(mine.casos)}.{" "}
            </>
          ) : (
            <>{selected.name}: sin datos. </>
          )}
          <Link to={{ pathname: "/", search: choiceSearch({ distrito: selected.id, rubro }) }}>Ver {selected.name}</Link>
        </p>
      ) : null}

      <ZoneMap map={map} selected={selected} rubro={rubro} />

      {/* Cómo leerlo, justo después del mapa: primero se ve, después se matiza. */}
      <div className="map-rules">
        <Note icon="eye" title="Ojo al leer el mapa">
          <p>{map.nota_sesgo}</p>
        </Note>
        <Note icon="lock" title="Qué se muestra y qué no">
          <p>
            {THRESHOLD_RULE} Los casos van en rangos (5-9, 10-19, 20-49, 50+), nunca en cifras exactas, y no hay un total de la ciudad.
          </p>
        </Note>
      </div>

      <Section
        id="lista-distritos"
        title="Los 50 distritos, en una lista"
        margin="Lista"
        intro="La misma información del mapa, por área y en orden alfabético. Toca un distrito para ver su riesgo, sus avisos y sus consejos."
      >
        <ZoneTable map={map} selected={selected} rubro={rubro} />
      </Section>

      <div className="next">
        <p className="body-l strong">¿Y ahora qué hago?</p>
        <div className="next-actions">
          <Link className="btn btn-outline" to={{ pathname: "/si-te-pasa", search: choiceSearch({ distrito: selected?.id, rubro }) }}>
            <Icon name="shield" size={18} />
            Qué hacer si te pasa
          </Link>
          <Link className="btn btn-quiet" to={{ pathname: "/datos", search: choiceSearch({ distrito: selected?.id, rubro }) }}>
            Cómo se calcula el mapa
          </Link>
        </div>
      </div>
    </>
  );
}
