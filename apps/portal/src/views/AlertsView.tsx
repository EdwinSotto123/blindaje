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
      {alerts.data && sorted.length === 0 ? (
        <Empty title="Tu gremio no ha enviado alertas">Cuando apruebe una para tu zona, la verás aquí.</Empty>
      ) : null}
      {sorted.length ? (
        <ul className="plain stack">
          {sorted.map((a) => (
            <li key={a.id}>
              <article className="sheet alert" aria-labelledby={`alerta-${a.id}`}>
                <h2 id={`alerta-${a.id}`}>{a.titulo}</h2>
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
