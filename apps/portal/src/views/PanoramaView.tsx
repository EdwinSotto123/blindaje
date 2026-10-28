import type { BusinessMe, RiskOverview, VictimAlert } from "@blindaje/shared";
import { Link, useSearchParams } from "react-router";
import { useApi, useMe } from "../app/context";
import { CallButtons } from "../components/CallButtons";
import { Icon } from "../components/Icons";
import { Ledger, trendSummary, type LedgerRow } from "../components/Ledger";
import { Empty, ErrorBox, Loading, Note, PageHead, Section, Threshold } from "../components/ui";
import { capitalize, casos, fmtDayMonth, fmtShort, fmtUpdated, sectorKey, sectorLabel } from "../lib/format";
import { ESCALA, NIVEL_HINT, NIVEL_LABEL } from "../lib/risk";
import { useAsync } from "../lib/useAsync";

type Scope = "rubro" | "zona";

export function PanoramaView() {
  const api = useApi();
  const me = useMe();
  // La vista elegida vive en la URL (?vista=zona): se puede volver a ella y compartirla.
  const [params, setParams] = useSearchParams();
  const scope: Scope = params.get("vista") === "zona" ? "zona" : "rubro";
  const setScope = (s: Scope) => setParams(s === "zona" ? { vista: "zona" } : {}, { replace: true });
  // Toda la zona: la API da todos los rubros cuando se pide la zona sin rubro.
  const risk = useAsync(() => (scope === "zona" ? api.risk({ zona: me.zona }) : api.risk()), `risk:${me.id}:${scope}`);
  const alerts = useAsync(() => api.alerts(), `alerts:${me.id}`);
  const latest = [...(alerts.data ?? [])].sort((a, b) => b.approved_at.localeCompare(a.approved_at))[0];

  return (
    <>
      <PageHead title="Mi panorama" margin="Tu zona">
        <p>
          Con los casos que registraron los gremios
          {risk.data ? ` en los últimos ${risk.data.periodo_dias} días. Actualizado el ${endSentence(fmtUpdated(risk.data.actualizado_at))}` : "."}
        </p>
      </PageHead>
      <div className="segmented" role="group" aria-label="Qué panorama ver">
        <button type="button" aria-pressed={scope === "rubro"} onClick={() => setScope("rubro")}>
          Solo {sectorLabel(me.sector)}
        </button>
        <button type="button" aria-pressed={scope === "zona"} onClick={() => setScope("zona")}>
          Toda la zona
        </button>
      </div>
      {risk.error ? <ErrorBox error={risk.error} onRetry={risk.reload} /> : null}
      {risk.loading && !risk.data ? <Loading label="Cargando el panorama de tu zona…" /> : null}
      {risk.data ? <Panorama risk={risk.data} me={me} latestAlert={latest} /> : null}
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
  return risk.sector ? sectorLabel(risk.sector) : "todos los rubros";
}

/** El panorama ya cargado (sin llamadas a la API, para poder probarlo con un render estático). */
export function Panorama({ risk, me, latestAlert }: { risk: RiskOverview; me: BusinessMe; latestAlert?: VictimAlert | undefined }) {
  const below = belowThreshold(risk);

  const next = (
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
  );

  const alertLine = latestAlert ? (
    <p className="latest-alert">
      <Icon name="megaphone" size={20} />
      <span>
        Último aviso de tu gremio, del {fmtDayMonth(latestAlert.approved_at)}: <Link to="/alertas">{latestAlert.titulo}</Link>
      </span>
    </p>
  ) : null;

  // Bajo el umbral la página es corta: lo que sí sabemos y lo que sí puedes hacer.
  if (below) {
    return (
      <>
        <div className="answer">
          <p className="answer-text">
            En {risk.zona}, para {sectorPhrase(risk)}, todavía no podemos decirte el nivel de riesgo.
          </p>
          <Threshold detail={risk.aviso_umbral} />
          <p className="answer-facts">Eso no quiere decir que no pase nada. Si te llega un mensaje que te pide dinero, sigue el protocolo.</p>
          {alertLine}
          <Note icon="eye" title="Cuando haya cifras, léelas así">
            <p>{risk.sesgo}</p>
          </Note>
        </div>
        <div className="pending">
          <p>Aquí verás la tendencia por semana, cómo operan y qué rubros reciben casos cuando haya al menos 5 casos de 3 personas distintas.</p>
        </div>
        {next}
      </>
    );
  }

  const lastWeek = risk.tendencia[risk.tendencia.length - 1];
  const toToday = lastWeek ? new Date(`${lastWeek.semana}T00:00:00-05:00`).getTime() + 7 * 86_400_000 > Date.parse(risk.actualizado_at) : false;
  const weekRows: LedgerRow[] = risk.tendencia.map((t, i) => {
    const row: LedgerRow = { key: t.semana, label: fmtShort(t.semana), value: t.casos };
    if (i === risk.tendencia.length - 1 && toToday) row.mark = "hasta hoy";
    return row;
  });
  const sectorRows: LedgerRow[] = risk.sectores_afectados.map((s) => {
    const row: LedgerRow = { key: s.sector, label: capitalize(sectorLabel(s.sector)), value: s.casos };
    if (sectorKey(s.sector) === sectorKey(me.sector)) row.mark = "tu rubro";
    return row;
  });

  return (
    <>
      <div className="answer">
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
        {/* Con cifras de la zona, el aviso explica un límite (por ejemplo, que tu rubro no alcanza el mínimo). */}
        {risk.aviso_umbral ? (
          <Note icon="info">
            <p>{risk.aviso_umbral}</p>
          </Note>
        ) : null}
        {alertLine}
        <Note icon="eye" title="Ojo al leer estas cifras">
          <p>{risk.sesgo}</p>
        </Note>
      </div>

      <Section id="tendencia" title="Cómo cambió semana a semana" margin="Tendencia">
        <Ledger
          rows={weekRows}
          labelHead="Semana del"
          summary={trendSummary(risk.tendencia)}
          tableCaption={`Casos por semana en ${risk.zona}, ${sectorPhrase(risk)}`}
          tableToggle="Ver los casos por semana en una tabla"
        />
      </Section>

      <Section id="modalidades" title="Lo que está circulando" margin="Modalidades">
        {risk.modalidades_activas.length === 0 ? (
          <Empty title="No hay modalidades que mostrar">En este periodo no se repitió ninguna forma de operar en tu zona.</Empty>
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
        <Section id="escalamiento" title="No esperes a que venza el plazo" margin="Escalamiento">
          <p className="measure body-l strong">Avisa a tu gremio y denuncia apenas te llegue el primer mensaje.</p>
          <p className="measure">{risk.escalamiento}</p>
          <CallButtons />
        </Section>
      ) : null}

      {sectorRows.length ? (
        <Section id="sectores" title={`Qué rubros reciben casos en ${risk.zona}`} margin="Rubros">
          <Ledger
            rows={sectorRows}
            labelHead="Rubro"
            summary={sectorSummary(risk)}
            tableCaption={`Casos por rubro en ${risk.zona}, últimos ${risk.periodo_dias} días`}
            tableToggle="Ver los casos por rubro en una tabla"
          />
        </Section>
      ) : null}

      {next}
    </>
  );
}

function sectorSummary(risk: RiskOverview): string {
  const known = risk.sectores_afectados.filter((s): s is { sector: string; casos: number } => s.casos !== null);
  if (known.length === 0) return "Ningún rubro alcanza todavía el mínimo de casos para mostrar cifras.";
  const top = [...known].sort((a, b) => b.casos - a.casos)[0]!;
  return `En los últimos ${risk.periodo_dias} días, ${sectorLabel(top.sector)} tiene más casos registrados (${casos(top.casos)}). Los rubros con menos de 5 casos van juntos, sin nombre.`;
}
