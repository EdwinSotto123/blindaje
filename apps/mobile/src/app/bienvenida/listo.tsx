import { useRouter } from "expo-router";
import { useState } from "react";

import { Button, Card, Notice, T } from "@/components/ui";
import { disguiseCopy } from "@/disguise/copy";
import { finishOnboarding, useDraft } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import { soles } from "@/lib/format";

/** Resumen de cómo entrar y fin del onboarding. */
export default function Listo() {
  const router = useRouter();
  const d = useDraft((x) => x);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titulo = d.disguise === "lista" ? disguiseCopy.lista.title : d.disguise === "vueltos" ? disguiseCopy.vueltos.title : disguiseCopy.cuaderno.title;

  const terminar = async () => {
    setBusy(true);
    try {
      await finishOnboarding();
      router.dismissAll();
      router.replace("/");
    } catch {
      setError("Falta crear tu PIN.");
      setBusy(false);
    }
  };

  return (
    <Step n={7} title="Listo. Así entras a tus notas" testID="listo" footer={<Button label={`Ir a ${titulo}`} onPress={terminar} loading={busy} testID="terminar" />}>
      <Card>
        {d.holdTitle ? <T variant="body">1. Mantén presionado el título “{titulo}” por 2 segundos.</T> : null}
        {d.secretAmountCents != null ? (
          <T variant="body">
            {d.holdTitle ? "O anota" : "1. Anota"} una venta de {soles(d.secretAmountCents)}.
          </T>
        ) : null}
        <T variant="body">2. Se abre la calculadora de vuelto. Escribe tu PIN en “Pagó con” y toca “Calcular”.</T>
      </Card>
      {d.decoy ? <T variant="secondary">Con tu PIN señuelo se abren unas notas vacías.</T> : null}
      {d.pseudonym ? <T variant="small">Tu código: {d.pseudonym}{d.orgName ? ` · ${d.orgName}` : ""}</T> : null}
      <T variant="secondary">Si escribes otro número, la calculadora solo calcula el vuelto. Nadie notará nada.</T>
      <Notice>{error}</Notice>
    </Step>
  );
}
