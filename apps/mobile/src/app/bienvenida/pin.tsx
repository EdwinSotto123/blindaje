import { useRouter } from "expo-router";
import { useState } from "react";

import { Button, Field, Notice, T } from "@/components/ui";
import { draftStore } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import { isValidPin } from "@/security/pin";

/** Crear el PIN de las notas privadas. */
export default function Pin() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);

  const seguir = () => {
    if (!isValidPin(pin)) return setError("Usa de 4 a 8 números.");
    if (pin !== again) return setError("Los dos PIN no coinciden.");
    draftStore.set({ pin });
    router.push("/bienvenida/senuelo");
  };

  return (
    <Step n={1} title="Crea tu PIN" testID="crear-pin" footer={<Button label="Continuar" onPress={seguir} testID="continuar" />}>
      <T variant="body">Lo escribirás en la calculadora de vuelto para entrar a tus notas. Elige uno que no sea tu fecha de nacimiento.</T>
      <Field label="PIN (4 a 8 números)" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={8} testID="pin" />
      <Field label="Repite el PIN" value={again} onChangeText={setAgain} keyboardType="number-pad" secureTextEntry maxLength={8} testID="pin2" onSubmitEditing={seguir} />
      <Notice>{error}</Notice>
    </Step>
  );
}
