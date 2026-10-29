import { useRouter } from "expo-router";
import { Pressable, Switch, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Button, Card, T } from "@/components/ui";
import { draftStore, useDraft } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import { CONSENT_COMPARE, CONSENT_WHO } from "@/private/consent";
import { DistrictPicker } from "@/private/DistrictPicker";
import type { Sector } from "@/shared";
import { colors, layout } from "@/theme/tokens";

const SECTORES: { key: Sector; label: string }[] = [
  { key: "bodega", label: "Bodega" },
  { key: "mercado", label: "Mercado" },
  { key: "mototaxi", label: "Mototaxi" },
  { key: "transporte", label: "Transporte" },
  { key: "restaurante", label: "Restaurante" },
  { key: "construccion", label: "Construcción" },
  { key: "otro", label: "Otro" },
];

/**
 * Los dos niveles de consentimiento, explicados con honestidad ("Solo mi denuncia" por defecto), y
 * el rubro y el distrito, opcionales. El distrito sale de una lista fija: nunca una dirección.
 */
export default function Consentimiento() {
  const router = useRouter();
  const consent = useDraft((d) => d.consent);
  const sector = useDraft((d) => d.sector);
  const zona = useDraft((d) => d.zona);
  const comunitario = consent === "comunitario";

  return (
    <Step n={5} title="Tú decides qué se comparte" testID="consentimiento" footer={<Button label="Continuar" onPress={() => router.push("/bienvenida/listo")} testID="continuar" />}>
      <Card style={{ borderColor: colors.tinta, borderWidth: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="lock" />
          <T variant="h2">Solo mi denuncia (siempre activo)</T>
        </View>
        <T variant="body">Te ayudamos a ordenar tu evidencia y a armar tu denuncia. Tu caso no se compara con otros.</T>
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
        <T variant="body">{CONSENT_COMPARE}</T>
        <T variant="body">{CONSENT_WHO}</T>
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
                  minHeight: layout.toqueMin,
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
      </View>

      <DistrictPicker
        label="Tu distrito (opcional)"
        hint="Donde está tu negocio o donde trabajas. Solo el distrito, nunca tu dirección. Así ves los avisos de tu zona."
        value={zona}
        onChange={(id) => draftStore.set({ zona: id })}
      />
    </Step>
  );
}
