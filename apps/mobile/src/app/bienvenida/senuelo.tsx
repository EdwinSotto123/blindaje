import { useRouter } from "expo-router";
import { useState } from "react";

import { Button, Card, Field, Notice, T } from "@/components/ui";
import { draftStore } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import { isValidPin } from "@/security/pin";

/** PIN señuelo: abre unas notas privadas vacías y creíbles si alguien te obliga a abrir la app. */
export default function Senuelo() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const seguir = (skip = false) => {
    if (!skip) {
      if (!isValidPin(pin)) return setError("Usa de 4 a 8 números.");
      if (pin === draftStore.get().pin) return setError("Tiene que ser distinto de tu PIN.");
    }
    draftStore.set({ decoy: skip ? null : pin });
    router.push("/bienvenida/disfraz");
  };

  return (
    <Step
      n={2}
      title="Un PIN señuelo"
      testID="senuelo"
      footer={
        <>
          <Button label="Continuar" onPress={() => seguir()} testID="continuar" />
          <Button label="Ahora no" kind="ghost" compact onPress={() => seguir(true)} />
        </>
      }
    >
      <T variant="body">Si alguien te obliga a abrir la app, usa este PIN. Verá unas notas privadas vacías, como si nunca hubieras guardado nada.</T>
      <Field label="PIN señuelo (4 a 8 números)" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={8} testID="pin-senuelo" />
      <Notice>{error}</Notice>
      <Card>
        <T variant="small">Tu evidencia sigue a salvo en la nube. Con el PIN señuelo no se ve ni se borra nada.</T>
      </Card>
    </Step>
  );
}
