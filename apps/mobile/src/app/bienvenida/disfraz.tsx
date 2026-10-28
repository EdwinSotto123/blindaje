import { useRouter } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";

import { Button, Field, Notice, T } from "@/components/ui";
import { draftStore, useDraft } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import { DisguisePicker } from "@/private/DisguisePicker";
import { parseSoles } from "@/lib/format";
import { colors } from "@/theme/tokens";

/** Elegir el disfraz y las entradas secretas. */
export default function Disfraz() {
  const router = useRouter();
  const disguise = useDraft((d) => d.disguise);
  const hold = useDraft((d) => d.holdTitle);
  const [monto, setMonto] = useState("18.18");
  const [montoOn, setMontoOn] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seguir = () => {
    const cents = montoOn ? parseSoles(monto) : null;
    if (montoOn && (cents === null || cents <= 0)) return setError("Escribe un monto, por ejemplo 18.18");
    if (!montoOn && !hold) return setError("Deja al menos una forma de entrar encendida.");
    draftStore.set({ secretAmountCents: cents });
    router.push("/bienvenida/voz");
  };

  return (
    <Step n={4} title="Cómo se verá la app" testID="disfraz" footer={<Button label="Continuar" onPress={seguir} testID="continuar" />}>
      <T variant="body">Elige el disfraz. Todos funcionan de verdad. Si muchas personas usan el mismo, es más difícil saber qué buscar.</T>
      <DisguisePicker value={disguise} onChange={(d) => draftStore.set({ disguise: d })} />
      <T variant="h2">Cómo entrarás a tus notas</T>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <T variant="body" style={{ flex: 1 }}>
          Mantener presionado el título 2 segundos
        </T>
        <Switch value={hold} onValueChange={(v) => draftStore.set({ holdTitle: v })} accessibilityLabel="Mantener presionado el título" trackColor={{ false: colors.borde, true: colors.tinta }} thumbColor={colors.blanco} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <T variant="body" style={{ flex: 1 }}>
          Anotar una venta con un monto secreto
        </T>
        <Switch value={montoOn} onValueChange={setMontoOn} accessibilityLabel="Monto secreto" trackColor={{ false: colors.borde, true: colors.tinta }} thumbColor={colors.blanco} />
      </View>
      {montoOn ? <Field label="Monto secreto" hint="Una venta con este monto no se anota: abre la calculadora." keyboardType="decimal-pad" value={monto} onChangeText={setMonto} /> : null}
      <Notice>{error}</Notice>
    </Step>
  );
}
