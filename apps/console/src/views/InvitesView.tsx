import { PageHead } from "../components/ui";
import { InvitesPanel } from "./AdminView";

export function InvitesView() {
  return (
    <>
      <PageHead title="Invitaciones">Genera códigos para que los miembros verificados de tu organización registren la app.</PageHead>
      <InvitesPanel orgs={[]} />
    </>
  );
}
