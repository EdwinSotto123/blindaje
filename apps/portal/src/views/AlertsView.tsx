import { districtOfZone, type District, type VictimAlert } from "@blindaje/shared";
import { useState } from "react";
import { useApi } from "../app/context";
import { ChooseZone } from "../components/ChooseZone";
import { Empty, ErrorBox, Loading, PageHead } from "../components/ui";
import { useChoice } from "../lib/choice";
import { fmtDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function AlertsView() {
  const { distrito, rubro } = useChoice();
  return (
    <>
      <PageHead title={distrito ? `Alertas para ${distrito.name}` : "Alertas de tu zona"} margin="Avisos">
        <p>Los avisos que el equipo de Blindaje aprobó para tu distrito. Una persona del equipo revisa cada uno antes de publicarlo.</p>
      </PageHead>
      {distrito ? <Alerts distrito={distrito} /> : <ChooseZone what="avisos" rubro={rubro} />}
    </>
  );
}

function Alerts({ distrito }: { distrito: District }) {
  const api = useApi();
  const alerts = useAsync(() => api.alerts({ zona: distrito.id }), `alerts:${distrito.id}`);
  // "Nuevo" se calcula contra la hora en que se abrió la página, no en cada render.
  const [now] = useState(() => Date.now());
  return (
    <>
      {alerts.error ? <ErrorBox error={alerts.error} onRetry={alerts.reload} /> : null}
      {alerts.loading && !alerts.data ? <Loading label="Cargando las alertas…" /> : null}
      {alerts.data ? <AlertList alerts={alerts.data} district={distrito} now={now} /> : null}
    </>
  );
}

/** La lista ya cargada (sin llamadas a la API, para poder probarla con un render estático). */
export function AlertList({ alerts, district, now }: { alerts: VictimAlert[]; district: District; now: number }) {
  const sorted = [...alerts].sort((a, b) => b.approved_at.localeCompare(a.approved_at));
  if (sorted.length === 0) {
    return (
      <Empty title={`No hay alertas para ${district.name}`}>
        Cuando el equipo de Blindaje apruebe una para tu distrito, la verás aquí. Que no haya alertas no quiere decir que no pase nada.
      </Empty>
    );
  }
  return (
    <>
      <p className="answer-line">{alertsAnswer(sorted, district.name, now)}</p>
      <ul className="plain stack">
        {sorted.map((a) => (
          <li key={a.id}>
            <article className="sheet alert" aria-labelledby={`alerta-${a.id}`}>
              <h2 id={`alerta-${a.id}`}>
                {a.titulo} {isRecent(a, now) ? <span className="tag">Nuevo</span> : null}
              </h2>
              <p className="pencil small">
                Aprobado por el equipo de Blindaje el <time dateTime={a.approved_at}>{fmtDate(a.approved_at)}</time> · {districtOfZone(a.zona)?.name ?? a.zona}
              </p>
              <p className="measure">{a.cuerpo}</p>
              {a.que_hacer.length ? (
                <>
                  <p className="label">Qué hacer</p>
                  <ul className="checks">
                    {a.que_hacer.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}

const WEEK_MS = 7 * 86_400_000;

/** Aprobada en los últimos 7 días. */
export function isRecent(a: VictimAlert, now = Date.now()): boolean {
  const t = Date.parse(a.approved_at);
  return Number.isFinite(t) && now - t < WEEK_MS;
}

/** La respuesta a "¿hay algo nuevo?", en una frase. */
export function alertsAnswer(sorted: VictimAlert[], districtName: string, now = Date.now()): string {
  const nuevos = sorted.filter((a) => isRecent(a, now)).length;
  const total = sorted.length === 1 ? `Hay 1 aviso para ${districtName}.` : `Hay ${sorted.length} avisos para ${districtName}.`;
  const recientes = nuevos === 0 ? " Ninguno es de esta semana." : nuevos === 1 ? " 1 es de esta semana." : ` ${nuevos} son de esta semana.`;
  return `${total}${recientes}`;
}
