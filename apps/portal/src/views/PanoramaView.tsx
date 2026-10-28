import type { BusinessMe, RiskOverview } from "@blindaje/shared";
import { Link } from "react-router";
import { useApi, useMe } from "../app/context";
import { Icon } from "../components/Icons";
import { Ledger, trendSummary, type LedgerRow } from "../components/Ledger";
import { Empty, ErrorBox, Loading, Note, PageHead, Section, Threshold } from "../components/ui";
import { capitalize, casos, fmtDayMonth, fmtShort, fmtUpdated } from "../lib/format";
import { ESCALA, NIVEL_HINT, NIVEL_LABEL } from "../lib/risk";
import { useAsync } from "../lib/useAsync";

export function PanoramaView() {
  const api = useApi();
  const me = useMe();
  const risk = useAsync(() => api.risk(), `risk:${me.id}`);

  return (
    <>
      <PageHead title="Mi panorama" margin="Tu zona">
        <p>
          Cómo está la extorsión en {me.zona} para {me.sector}, con los casos que registraron los gremios.
          {risk.data ? ` Últimos ${risk.data.periodo_dias} días. Actualizado el ${endSentence(fmtUpdated(risk.data.actualizado_at))}` : ""}
        </p>
      </PageHead>
      {risk.error ? <ErrorBox error={risk.error} onRetry={risk.reload} /> : null}
      {risk.loading && !risk.data ? <Loading label="Cargando el panorama de tu zona…" /> : null}
      {risk.data ? <Panorama risk={risk.data} me={me} /> : null}
    </>
  );
}

/** Cierra la frase con un punto, sin duplicarlo ("6:00 a. m."). */
function endSentence(s: string): string {
  return s.endsWith(".") ? s : `${s}.`;
}

/** true si no se cumple el umbral de 5 casos y 3 víctimas: no se muestra ninguna cifra. */
export function belowThreshold(risk: RiskOverview): boolean {
  return risk.casos_periodo === null || risk.nivel_riesgo === "sin_datos";
}

function sectorPhrase(risk: RiskOverview): string {
  return risk.sector ? risk.sector : "todos los sectores";
}

/** El panorama ya cargado (sin llamadas a la API, para poder probarlo con un render estático). */
export function Panorama({ risk, me }: { risk: RiskOverview; me: BusinessMe }) {
  const below = belowThreshold(risk);
  const lastWeek = risk.tendencia[risk.tendencia.length - 1];
  const inProgress = lastWeek ? new Date(`${lastWeek.semana}T00:00:00-05:00`).getTime() + 7 * 86_400_000 > Date.parse(risk.actualizado_at) : false;

  const weekRows: LedgerRow[] = risk.tendencia.map((t, i) => {
    const row: LedgerRow = { key: t.semana, label: fmtShort(t.semana), value: below ? null : t.casos };
    if (i === risk.tendencia.length - 1 && inProgress) row.mark = "en curso";
    return row;
  });
  const sectorRows: LedgerRow[] = risk.sectores_afectados.map((s) => {
    const row: LedgerRow = { key: s.sector, label: capitalize(s.sector), value: s.casos };
    if (s.sector === me.sector) row.mark = "tu sector";
    return row;
  });

  return (
    <>
      <div className="answer">
        {below ? (
          <>
            <p className="answer-text">
              En {risk.zona}, para {sectorPhrase(risk)}, todavía no podemos decirte el nivel de riesgo.
            </p>
            <Threshold detail={risk.aviso_umbral} />
          </>
        ) : (
          <>
            <p className="answer-text">
              En {risk.zona}, el riesgo para {sectorPhrase(risk)} es <mark className="hl sweep">{NIVEL_LABEL[risk.nivel_riesgo]}</mark>.
            </p>
            <ol className="scale" aria-label="Escala de riesgo">
              {ESCALA.map((l) => (
                <li key={l} aria-current={l === risk.nivel_riesgo ? "true" : undefined}>
                  {capitalize(l)}
                </li>
              ))}
            </ol>
            <p className="answer-facts">
              <strong className="num">{casos(risk.casos_periodo ?? 0)}</strong> en los últimos {risk.periodo_dias} días. {NIVEL_HINT[risk.nivel_riesgo]}
            </p>
            {risk.aviso_umbral ? <Threshold detail={risk.aviso_umbral} /> : null}
          </>
        )}
        <Note icon="eye" title="Ojo al leer estas cifras">
          <p>{risk.sesgo}</p>
        </Note>
      </div>

      <Section id="tendencia" title="Cómo cambió semana a semana" margin="Tendencia">
        <Ledger
          rows={weekRows}
          labelHead="Semana del"
          summary={below ? "Todavía no hay semanas con casos suficientes para mostrar cifras." : trendSummary(risk.tendencia)}
          tableCaption={`Casos por semana en ${risk.zona}, ${sectorPhrase(risk)}`}
        />
      </Section>

      <Section id="modalidades" title="Lo que está circulando" margin="Modalidades">
        {risk.modalidades_activas.length === 0 ? (
          <Empty title="No hay modalidades que mostrar">
            {below
              ? "Cuando haya casos suficientes, aquí verás cómo opera cada modalidad y cómo reconocerla."
              : "En este periodo no se repitió ninguna forma de operar en tu zona."}
          </Empty>
        ) : (
          <ul className="plain stack">
            {risk.modalidades_activas.map((m) => (
              <li key={m.descripcion} className="sheet modalidad">
                <p className="modalidad-desc">{m.descripcion}</p>
                {m.desde ? <p className="pencil small">Activa desde el {fmtDayMonth(m.desde)}.</p> : null}
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
        <Section id="escalamiento" title="Cómo suele escalar" margin="Escalamiento">
          <p className="measure body-l">{risk.escalamiento}</p>
          <p className="measure">No esperes a que venza el plazo: avisa a tu gremio y denuncia apenas te llegue el primer mensaje.</p>
        </Section>
      ) : null}

      {sectorRows.length ? (
        <Section id="sectores" title={`Qué sectores reciben casos en ${risk.zona}`} margin="Sectores">
          <Ledger
            rows={sectorRows}
            labelHead="Sector"
            summary={sectorSummary(risk)}
            tableCaption={`Casos por sector en ${risk.zona}, últimos ${risk.periodo_dias} días`}
          />
        </Section>
      ) : null}

      <div className="next">
        <p className="body-l strong">¿Y ahora qué hago?</p>
        <div className="next-actions">
          <Link className="btn btn-primary" to="/recomendaciones">
            Ver lo que recomienda tu gremio
          </Link>
          <Link className="btn btn-outline" to="/si-te-pasa">
            <Icon name="shield" size={18} />
            Qué hacer si te pasa
          </Link>
        </div>
      </div>
    </>
  );
}

function sectorSummary(risk: RiskOverview): string {
  const known = risk.sectores_afectados.filter((s): s is { sector: string; casos: number } => s.casos !== null);
  if (known.length === 0) return "Ningún sector alcanza todavía el mínimo de casos para mostrar cifras.";
  const top = [...known].sort((a, b) => b.casos - a.casos)[0]!;
  const hidden = risk.sectores_afectados.length - known.length;
  return `En los últimos ${risk.periodo_dias} días, ${top.sector} tiene más casos registrados (${casos(top.casos)}).${hidden ? ` ${hidden === 1 ? "Un sector no alcanza" : `${hidden} sectores no alcanzan`} el mínimo para mostrar su cifra.` : ""}`;
}
