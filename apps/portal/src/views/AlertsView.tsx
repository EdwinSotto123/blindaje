import type { VictimAlert } from "@blindaje/shared";
import { useApi, useMe } from "../app/context";
import { Empty, ErrorBox, Loading, PageHead } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function AlertsView() {
  const api = useApi();
  const me = useMe();
  const alerts = useAsync(() => api.alerts(), `alerts:${me.id}`);
  const sorted = [...(alerts.data ?? [])].sort((a, b) => b.approved_at.localeCompare(a.approved_at));

  return (
    <>
      <PageHead title="Alertas del gremio" margin="Avisos">
        <p>Los avisos que {me.org.name} aprobó para sus asociados. Una persona del gremio revisa cada uno antes de enviarlo.</p>
      </PageHead>
      {alerts.error ? <ErrorBox error={alerts.error} onRetry={alerts.reload} /> : null}
      {alerts.loading && !alerts.data ? <Loading label="Cargando las alertas…" /> : null}
      {sorted.length ? <p className="answer-line">{alertsAnswer(sorted)}</p> : null}
      {alerts.data && sorted.length === 0 ? (
        <Empty title="Tu gremio no ha enviado alertas">Cuando apruebe una para tu zona, la verás aquí.</Empty>
      ) : null}
      {sorted.length ? (
        <ul className="plain stack">
          {sorted.map((a) => (
            <li key={a.id}>
              <article className="sheet alert" aria-labelledby={`alerta-${a.id}`}>
                <h2 id={`alerta-${a.id}`}>
                  {a.titulo} {isRecent(a) ? <span className="tag">Nuevo</span> : null}
                </h2>
                <p className="pencil small">
                  <time dateTime={a.approved_at}>{fmtDate(a.approved_at)}</time> · {a.zona}
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
      ) : null}
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
export function alertsAnswer(sorted: VictimAlert[], now = Date.now()): string {
  const nuevos = sorted.filter((a) => isRecent(a, now)).length;
  const total = sorted.length === 1 ? "Tu gremio te envió 1 aviso." : `Tu gremio te envió ${sorted.length} avisos.`;
  const recientes = nuevos === 0 ? " Ninguno es de esta semana." : nuevos === 1 ? " 1 es de esta semana." : ` ${nuevos} son de esta semana.`;
  return `${total}${recientes}`;
}
