import { useRouter } from "expo-router";
import { Pressable, Switch, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Button, Card, Field, T } from "@/components/ui";
import { draftStore, useDraft } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import type { Sector } from "@/shared";
import { colors } from "@/theme/tokens";

const SECTORES: { key: Sector; label: string }[] = [
  { key: "bodega", label: "Bodega" },
  { key: "mercado", label: "Mercado" },
  { key: "mototaxi", label: "Mototaxi" },
  { key: "transporte", label: "Transporte" },
  { key: "restaurante", label: "Restaurante" },
  { key: "construccion", label: "Construcción" },
  { key: "otro", label: "Otro" },
];

/** Los dos niveles de consentimiento, explicados con honestidad. "Solo mi denuncia" por defecto. */
export default function Consentimiento() {
  const router = useRouter();
  const consent = useDraft((d) => d.consent);
  const sector = useDraft((d) => d.sector);
  const zona = useDraft((d) => d.zona);
  const comunitario = consent === "comunitario";

  return (
    <Step n={6} title="Tú decides qué se comparte" testID="consentimiento" footer={<Button label="Continuar" onPress={() => router.push("/bienvenida/listo")} testID="continuar" />}>
      <Card style={{ borderColor: colors.tinta, borderWidth: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="lock" />
          <T variant="h2">Solo mi denuncia (siempre activo)</T>
        </View>
        <T variant="body">Te ayudamos a ordenar tu evidencia y a armar tu denuncia. Nada sale de tu caso.</T>
      </Card>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <T variant="h2" style={{ flex: 1 }}>
            Modo comunitario
          </T>
          <Switch
            value={comunitario}
            onValueChange={(v) => draftStore.set({ consent: v ? "comunitario" : "solo_denuncia" })}
            accessibilityLabel="Modo comunitario"
            trackColor={{ false: colors.borde, true: colors.tinta }}
            thumbColor={colors.blanco}
            testID="modo-comunitario"
          />
        </View>
        <T variant="body">
          Si lo activas, señales cifradas de tu caso (la huella de la voz, números y cuentas cifrados, la forma en que te contactaron) se comparan con
          otros casos de tu gremio para encontrar a la misma red. Nadie ve tus audios ni tus datos personales. Solo analistas autorizados ven los
          resultados, y nunca te avisaremos por el celular.
        </T>
        <T variant="small">Está {comunitario ? "encendido" : "apagado"}. Puedes cambiarlo cuando quieras en Ajustes.</T>
      </Card>

      <View style={{ gap: 8 }}>
        <T variant="h2">¿A qué te dedicas? (opcional)</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {SECTORES.map((s) => {
            const on = sector === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => draftStore.set({ sector: on ? null : s.key })}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={{
                  minHeight: 44,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: on ? colors.tinta : colors.borde,
                  backgroundColor: on ? colors.tinta : colors.papel,
                  justifyContent: "center",
                }}
              >
                <T variant="bodyBold" style={{ color: on ? colors.blanco : colors.tinta }}>
                  {s.label}
                </T>
              </Pressable>
            );
          })}
        </View>
        <Field label="Distrito (opcional)" hint="Solo el distrito, nunca tu dirección." value={zona} onChangeText={(t) => draftStore.set({ zona: t })} placeholder="Ej.: San Juan de Miraflores" />
      </View>
    </Step>
  );
}
