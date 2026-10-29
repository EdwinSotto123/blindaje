import type { District, PublicRiskOverview, VictimAlert } from "@blindaje/shared";
import { useId } from "react";
import { Link, useSearchParams } from "react-router";
import { useApi, useDemoData } from "../app/context";
import { BandLedger, bandTrendSummary, type BandRow } from "../components/Bands";
import { CallButtons } from "../components/CallButtons";
import { Icon } from "../components/Icons";
import { Empty, ErrorBox, Loading, Note, PageHead, Section, Threshold } from "../components/ui";
import { bandLabel, bandPhrase } from "../lib/bands";
import { choiceSearch, RUBRO_LABEL, RUBROS, useChoice, type Rubro } from "../lib/choice";
import { capitalize, fmtDayMonth, fmtShort, fmtUpdated, sectorKey, sectorLabel } from "../lib/format";
import { ESCALA, NIVEL_HINT, NIVEL_LABEL } from "../lib/risk";
import { useAsync } from "../lib/useAsync";
import { PickerView } from "./PickerView";

/** "/": Mi zona si la URL trae un distrito; si no, el selector (primera visita). */
export function HomeView() {
  const { distrito, params } = useChoice();
  if (!distrito) return <PickerView notFound={params.has("distrito")} />;
  return <ZoneView distrito={distrito} />;
}

export function ZoneView({ distrito }: { distrito: District }) {
  const api = useApi();
  const { rubro } = useChoice();
  const [, setParams] = useSearchParams();
  const selectId = useId();
  const key = `${distrito.id}:${rubro ?? ""}`;
  const risk = useAsync(() => api.risk({ zona: distrito.id, sector: rubro }), `risk:${key}`);
  const alerts = useAsync(() => api.alerts({ zona: distrito.id }), `alerts:${distrito.id}`);
  useDemoData(risk.data?.demo);
  const latest = alerts.data?.[0];

  // El rubro vive en la URL: cambiarlo reemplaza la entrada del historial (se puede compartir el enlace).
  const setRubro = (r: string) => {
    const next = (RUBROS as readonly string[]).includes(r) ? (r as Rubro) : null;
    setParams(new URLSearchParams(choiceSearch({ distrito: distrito.id, rubro: next })), { replace: true });
  };

  return (
    <>
      <div className="zone-top">
        <PageHead title={distrito.name} compact>
          <p>
            {distrito.area}. Casos que las personas registraron en Blindaje
            {risk.data ? ` en los últimos ${risk.data.periodo_dias} días.` : "."}
            {risk.data?.actualizado_at ? ` Actualizado el ${endSentence(fmtUpdated(risk.data.actualizado_at))}` : ""}
          </p>
        </PageHead>
        <div className="zone-controls">
          <div className="field">
            <label htmlFor={selectId}>Rubro</label>
            <select id={selectId} value={rubro ?? ""} onChange={(e) => setRubro(e.target.value)}>
              <option value="">Todos los rubros</option>
              {RUBROS.map((r) => (
                <option key={r} value={r}>
                  {RUBRO_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <Link className="btn btn-outline btn-sm" to={{ pathname: "/elegir", search: choiceSearch({ distrito: distrito.id, rubro }) }}>
            Otro distrito
          </Link>
        </div>
      </div>
      {risk.error ? <ErrorBox error={risk.error} onRetry={risk.reload} /> : null}
      {risk.loading && !risk.data ? <Loading label={`Cargando ${distrito.name}…`} /> : null}
      {risk.data ? <Panorama risk={risk.data} district={distrito} rubro={rubro} latestAlert={latest} /> : null}
    </>
  );
}

/** Cierra la frase con un punto, sin duplicarlo ("6:00 a. m."). */
function endSentence(s: string): string {
  return s.endsWith(".") ? s : `${s}.`;
}

/** true si no se cumple el umbral de 5 casos y 3 víctimas: no se muestra ningún rango. */
export function belowThreshold(risk: PublicRiskOverview): boolean {
  return risk.casos_periodo === null || risk.nivel_riesgo === "sin_datos";
}

function sectorPhrase(risk: PublicRiskOverview): string {
  return risk.sector ? sectorLabel(risk.sector) : "todos los rubros";
}

/** El panorama ya cargado (sin llamadas a la API, para poder probarlo con un render estático). */
export function Panorama({
  risk,
  district,
  rubro,
  latestAlert,
}: {
  risk: PublicRiskOverview;
  district: District;
  rubro: Rubro | null;
  latestAlert?: VictimAlert | undefined;
}) {
  const below = belowThreshold(risk);
  const search = choiceSearch({ distrito: district.id, rubro });
  const name = district.name;

  const next = (
    <div className="next">
      <p className="next-title">¿Y ahora qué hago?</p>
      <div className="next-actions">
        <Link className="btn btn-primary" to={{ pathname: "/recomendaciones", search }}>
          Ver los consejos para {name}
        </Link>
        <Link className="btn btn-outline" to={{ pathname: "/si-te-pasa", search }}>
          <Icon name="shield" size={18} />
          Qué hacer si te pasa
        </Link>
        <Link className="btn btn-quiet" to={{ pathname: "/mapa", search }}>
          <Icon name="map" size={18} />
          Ver el mapa
        </Link>
      </div>
    </div>
  );

  const alertLine = latestAlert ? (
    <p className="latest-alert">
      <span className="latest-alert-icon">
        <Icon name="megaphone" size={20} />
      </span>
      <span>
        Último aviso para {name}, aprobado por el equipo de Blindaje el {fmtDayMonth(latestAlert.approved_at)}:{" "}
        <Link to={{ pathname: "/alertas", search }}>{latestAlert.titulo}</Link>
      </span>
    </p>
  ) : null;

  // Bajo el umbral la página es corta: lo que sí sabemos y lo que sí puedes hacer.
  if (below) {
    return (
      <>
        <div className="answer">
          {/* Sin nivel, la tarjeta de la respuesta se dibuja punteada: la ausencia, no un hueco. */}
          <div className="answer-card" data-nivel="sin_datos">
            <p className="answer-text">
              En {name}, para {rubro ? sectorLabel(rubro) : "todos los rubros"}, todavía no podemos decirte el nivel de riesgo.
            </p>
            <Threshold detail={risk.aviso_umbral} />
            <p className="answer-facts">
              Eso no quiere decir que no pase nada: un distrito con pocos casos se ve igual que uno sin casos. Si te llega un mensaje que te pide
              dinero, sigue el protocolo.
            </p>
          </div>
          {alertLine}
          <Note icon="eye" title="Cuando haya datos, léelos así">
            <p>{risk.sesgo}</p>
          </Note>
        </div>
        <div className="pending">
          <p>Aquí verás el rango de casos por semana, cómo operan y qué rubros reciben casos cuando haya al menos 5 casos de 3 personas distintas.</p>
        </div>
        {next}
      </>
    );
  }

  const lastWeek = risk.tendencia[risk.tendencia.length - 1];
  const toToday = lastWeek ? new Date(`${lastWeek.semana}T00:00:00-05:00`).getTime() + 7 * 86_400_000 > Date.parse(risk.actualizado_at) : false;
  const weekRows: BandRow[] = risk.tendencia.map((t, i) => {
    const row: BandRow = { key: t.semana, label: fmtShort(t.semana), band: t.casos };
    if (i === risk.tendencia.length - 1 && toToday) row.mark = "hasta hoy";
    return row;
  });
  const sectorRows: BandRow[] = risk.sectores_afectados.map((s) => {
    const row: BandRow = { key: s.sector, label: capitalize(sectorLabel(s.sector)), band: s.casos };
    if (rubro && sectorKey(s.sector) === sectorKey(rubro)) row.mark = "tu rubro";
    return row;
  });

  return (
    <>
      <div className="answer">
        {/* La respuesta es la protagonista: la frase, el nivel en el color del mapa y la escala. */}
        <div className="answer-card" data-nivel={risk.nivel_riesgo}>
          <p className="answer-text">
            En {name}, el riesgo para {sectorPhrase(risk)} es{" "}
            <mark className="level" data-nivel={risk.nivel_riesgo}>
              {NIVEL_LABEL[risk.nivel_riesgo]}
            </mark>
            .
          </p>
          <div className="answer-detail">
            <ol className="scale" aria-label="Escala de riesgo">
              {ESCALA.map((l) => (
                <li key={l} aria-current={l === risk.nivel_riesgo ? "true" : undefined}>
                  {capitalize(l)}
                </li>
              ))}
            </ol>
            <p className="answer-facts">
              <strong>{capitalize(bandPhrase(risk.casos_periodo!))}</strong> en los últimos {risk.periodo_dias} días. {NIVEL_HINT[risk.nivel_riesgo]}
            </p>
          </div>
        </div>
        {/* Con cifras del distrito, el aviso explica un límite (por ejemplo, que tu rubro no alcanza el mínimo). */}
        {risk.aviso_umbral ? (
          <Note icon="info">
            <p>{risk.aviso_umbral}</p>
          </Note>
        ) : null}
        {alertLine}
        <Note icon="eye" title="Ojo al leer estos datos">
          <p>{risk.sesgo}</p>
        </Note>
      </div>

      <Section id="tendencia" title="Cómo cambió semana a semana">
        <BandLedger
          rows={weekRows}
          labelHead="Semana del"
          summary={bandTrendSummary(risk.tendencia)}
          tableCaption={`Casos por semana en ${name}, ${sectorPhrase(risk)}, en rangos`}
          tableToggle="Ver los rangos por semana en una tabla"
        />
      </Section>

      <Section id="modalidades" title="Lo que está circulando">
        {risk.modalidades_activas.length === 0 ? (
          <Empty title="No hay modalidades que mostrar">En este periodo no se repitió ninguna forma de operar en {name}.</Empty>
        ) : (
          <ul className="plain stack">
            {risk.modalidades_activas.map((m) => (
              <li key={m.descripcion} className="sheet modalidad">
                <p className="modalidad-desc">{m.descripcion}</p>
                {m.desde ? <p className="muted small">Activa desde el {fmtDayMonth(m.desde)}.</p> : null}
                {m.senales_de_alerta.length ? (
                  <>
                    <p className="label">Cómo reconocerla</p>
                    <ul className="signals">
                      {m.senales_de_alerta.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {risk.escalamiento ? (
        <Section id="escalamiento" title="No esperes a que venza el plazo">
          <p className="measure body-l strong">Guarda todo y denuncia apenas te llegue el primer mensaje.</p>
          <p className="measure">{risk.escalamiento}</p>
          <CallButtons />
        </Section>
      ) : null}

      {sectorRows.length ? (
        <Section id="sectores" title={`Qué rubros reciben casos en ${name}`}>
          <BandLedger
            rows={sectorRows}
            labelHead="Rubro"
            summary={sectorSummary(risk)}
            tableCaption={`Casos por rubro en ${name}, últimos ${risk.periodo_dias} días, en rangos`}
            tableToggle="Ver los rangos por rubro en una tabla"
          />
        </Section>
      ) : null}

      {next}
    </>
  );
}

function sectorSummary(risk: PublicRiskOverview): string {
  const names = risk.sectores_afectados.map((s) => `${sectorLabel(s.sector)} (${bandLabel(s.casos)})`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `En los últimos ${risk.periodo_dias} días llegan al mínimo: ${list}. Los rubros con menos de 5 casos de 3 personas no aparecen, ni sumados.`;
}
