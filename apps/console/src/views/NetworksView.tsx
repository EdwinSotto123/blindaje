import { Link } from "react-router";
import { useApi } from "../app/context";
import { Empty, ErrorBox, Loading, PageHead, StatusBadge } from "../components/ui";
import { SECTOR_LABEL, fmtDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function NetworksView() {
  const api = useApi();
  const nets = useAsync(() => api.listNetworks(), "networks");
  return (
    <>
      <PageHead title="Redes">
        Grupos de casos unidos por vínculos confirmados por una persona. Abre una red para ver su grafo, su línea de tiempo y su perfil.
      </PageHead>
      {nets.error ? <ErrorBox error={nets.error} onRetry={nets.reload} /> : null}
      {nets.loading && !nets.data ? <Loading /> : null}
      {nets.data && nets.data.length === 0 ? (
        <Empty title="Aún no hay redes">Las redes aparecen cuando se confirman vínculos en la cola.</Empty>
      ) : null}
      {nets.data && nets.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Red</th>
                <th scope="col" className="num">
                  Casos
                </th>
                <th scope="col">Sectores</th>
                <th scope="col">Periodo</th>
                <th scope="col">Perfil</th>
                <th scope="col">Actualizada</th>
              </tr>
            </thead>
            <tbody>
              {nets.data.map((n) => (
                <tr key={n.id}>
                  <td>
                    <Link to={`/redes/${encodeURIComponent(n.id)}`} className="strong">
                      {n.label}
                    </Link>
                  </td>
                  <td className="num">{n.n_cases}</td>
                  <td>{n.sectores.map((s) => SECTOR_LABEL[s] ?? s).join(", ")}</td>
                  <td className="nowrap">{n.periodo ?? "—"}</td>
                  <td>{n.profile_status ? <StatusBadge status={n.profile_status} /> : <span className="muted">Sin perfil</span>}</td>
                  <td className="nowrap">{fmtDateTime(n.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
