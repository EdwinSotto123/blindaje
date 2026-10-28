import { Link } from "react-router";
import { useApi } from "../app/context";
import { ExpedientePanel } from "../components/ExpedientePanel";
import { Empty, ErrorBox, Loading, PageHead } from "../components/ui";
import { useAsync } from "../lib/useAsync";

export function ExpedientesView() {
  const api = useApi();
  const nets = useAsync(() => api.listNetworks(), "networks:expedientes");
  return (
    <>
      <PageHead title="Expedientes">
        Expedientes de red en PDF para la autoridad, con su huella SHA-256. Al descargar, la consola recalcula la huella del archivo y la compara.
      </PageHead>
      {nets.error ? <ErrorBox error={nets.error} onRetry={nets.reload} /> : null}
      {nets.loading && !nets.data ? <Loading /> : null}
      {nets.data && nets.data.length === 0 ? (
        <Empty title="No hay redes para expedientar">
          Confirma vínculos en la <Link to="/vinculos">cola</Link> para formar una red.
        </Empty>
      ) : null}
      <div className="stack">
        {nets.data?.map((n) => (
          <ExpedientePanel key={n.id} networkId={n.id} networkLabel={n.label} profileStatus={n.profile_status} />
        ))}
      </div>
    </>
  );
}
