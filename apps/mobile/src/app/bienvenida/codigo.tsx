import { useRouter } from "expo-router";
import { useState } from "react";

import { Button, Card, Field, Notice, T } from "@/components/ui";
import { draftStore } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import { errorMessage } from "@/private/data";
import { getOrCreateDeviceKey } from "@/security/device";
import { api, platform } from "@/services";

/** Código de invitación: registra este celular con su llave P-256 (la privada no sale del celular). */
export default function Codigo() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registrar = async () => {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,32}$/.test(c)) return setError("El código tiene letras y números, por ejemplo BODEGA-2026.");
    setBusy(true);
    setError(null);
    try {
      const { jwk } = await getOrCreateDeviceKey();
      const auth = await api.registerDevice(c, jwk, platform);
      draftStore.set({ registered: true, pseudonym: auth.pseudonym, orgName: auth.org.name });
      router.push("/bienvenida/pin");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step n={1} title="Tu código de invitación" testID="codigo" footer={<Button label="Continuar" onPress={registrar} loading={busy} testID="continuar" />}>
      <T variant="body">Te lo da tu asociación o gremio. Sirve para saber que vienes de un grupo de confianza.</T>
      <Field
        label="Código"
        value={code}
        onChangeText={(t) => {
          setCode(t);
          setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="Ej.: BODEGA-2026"
        testID="campo-codigo"
        onSubmitEditing={registrar}
      />
      <Notice>{error}</Notice>
      <Card>
        <T variant="small">No pedimos tu nombre, tu DNI ni tu número. Tu asociación te conoce; el sistema solo ve un código como V-7F3K.</T>
      </Card>
    </Step>
  );
}
