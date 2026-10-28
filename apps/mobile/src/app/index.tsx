import { Redirect } from "expo-router";

import { CuadernoHome } from "@/disguise/CuadernoHome";
import { ListaHome } from "@/disguise/ListaHome";
import { VueltosHome } from "@/disguise/VueltosHome";
import { useConfig } from "@/state/config";

/** Pantalla de inicio: siempre el disfraz elegido. La primera vez, la configuración privada. */
export default function Inicio() {
  const onboarded = useConfig((c) => c.onboarded);
  const discreet = useConfig((c) => c.wiped);
  const disguise = useConfig((c) => c.disguise);

  if (!onboarded && !discreet) return <Redirect href="/bienvenida" />;
  if (disguise === "lista") return <ListaHome />;
  if (disguise === "vueltos") return <VueltosHome />;
  return <CuadernoHome />;
}
