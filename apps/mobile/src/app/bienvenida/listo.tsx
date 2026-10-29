import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { Button, Card, Notice, T } from "@/components/ui";
import { disguiseCopy } from "@/disguise/copy";
import { finishOnboarding, useDraft } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import { soles } from "@/lib/format";
import { authStore } from "@/services";

/** Resumen de cómo entrar y fin del onboarding. */
export default function Listo() {
  const router = useRouter();
  const d = useDraft((x) => x);
  // El seudónimo sale de la sesión: el registro pudo terminar en "Empezar" o después, con la voz.
  // undefined: todavía se está leyendo; null: el celular aún no se registró.
  const [pseudonym, setPseudonym] = useState<string | null | undefined>(d.pseudonym ?? undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titulo = d.disguise === "lista" ? disguiseCopy.lista.title : d.disguise === "vueltos" ? disguiseCopy.vueltos.title : disguiseCopy.cuaderno.title;

  useEffect(() => {
    let vivo = true;
    void authStore.get().then((a) => {
      if (vivo) setPseudonym(a?.pseudonym ?? null);
    });
    return () => {
      vivo = false;
    };
  }, []);

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
    <Step n={6} title="Listo. Así entras a tus notas" testID="listo" footer={<Button label={`Ir a ${titulo}`} onPress={terminar} loading={busy} testID="terminar" />}>
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
      {pseudonym ? <T variant="small">Tu código: {pseudonym}</T> : null}
      {pseudonym === null ? <T variant="small">Todavía no hay conexión. Lo que guardes se subirá solo cuando tengas internet.</T> : null}
      <T variant="secondary">Si escribes otro número, la calculadora solo calcula el vuelto. Nadie notará nada.</T>
      <Notice>{error}</Notice>
    </Step>
  );
}
