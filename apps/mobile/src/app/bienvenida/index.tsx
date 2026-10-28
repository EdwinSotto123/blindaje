import { Redirect, useRouter } from "expo-router";

import { Button, Card, T } from "@/components/ui";
import { Step } from "@/onboarding/Step";
import { useConfig } from "@/state/config";

/** Onboarding privado, primera pantalla. Solo se ve al instalar o después de un borrado. */
export default function Bienvenida() {
  const router = useRouter();
  const onboarded = useConfig((c) => c.onboarded);
  if (onboarded) return <Redirect href="/" />;

  return (
    <Step n={0} title="Un lugar seguro para guardar lo que recibes" testID="bienvenida" footer={<Button label="Empezar" onPress={() => router.push("/bienvenida/codigo")} testID="empezar" />}>
      <T variant="body">
        Por fuera, esta app es un cuaderno de ventas que funciona de verdad. Por dentro tiene tus notas privadas: ahí guardas audios, mensajes y fotos de
        amenazas, y preparas tu denuncia.
      </T>
      <Card>
        <T variant="bodyBold">Cómo te protege</T>
        <T variant="body">— Se abre solo con tu PIN, escondido en el cuaderno.</T>
        <T variant="body">— Lo que guardas se cifra y se sube a la nube. No queda en tu galería ni en este celular.</T>
        <T variant="body">— Nunca te envía notificaciones.</T>
        <T variant="body">— “Salir rápido” te devuelve al cuaderno al instante.</T>
      </Card>
      <T variant="secondary">Para volver aquí más tarde: mantén presionado el título del cuaderno por 2 segundos.</T>
      <T variant="small">Necesitas el código de invitación que te dio tu asociación o gremio.</T>
    </Step>
  );
}
