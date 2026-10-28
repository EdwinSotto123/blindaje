import type { ReactNode } from "react";
import { View } from "react-native";

import { T } from "@/components/ui";
import { PrivateScreen } from "@/private/PrivateScreen";
import { colors } from "@/theme/tokens";

export const TOTAL_STEPS = 7;

/** Paso del onboarding privado: sin capturas, con "Salir rápido" y barra de progreso. */
export function Step({ n, title, children, footer, testID }: { n: number; title: string; children: ReactNode; footer?: ReactNode; testID?: string }) {
  return (
    <PrivateScreen title="Configurar" kind="onboarding" footer={footer} testID={testID}>
      {n > 0 ? (
        <View style={{ gap: 6 }} accessible accessibilityLabel={`Paso ${n} de ${TOTAL_STEPS}`}>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i < n ? colors.tinta : colors.borde }} />
            ))}
          </View>
          <T variant="small">
            Paso {n} de {TOTAL_STEPS}
          </T>
        </View>
      ) : null}
      <T variant="titleSmall">{title}</T>
      {children}
    </PrivateScreen>
  );
}
