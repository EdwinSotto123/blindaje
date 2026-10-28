import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { IconButton, Paper, T } from "@/components/ui";
import { disguiseCopy as c } from "@/disguise/copy";
import { onAccess } from "@/disguise/onAccess";
import { VueltoCalculator } from "@/disguise/VueltoCalculator";
import { tryAccess } from "@/security/access";

/**
 * Calculadora de vuelto. Abierta por una entrada secreta (e=1) también es el teclado del PIN;
 * abierta desde el menú del cuaderno es solo una calculadora.
 */
export default function Calculadora() {
  const router = useRouter();
  const { e, venta } = useLocalSearchParams<{ e?: string; venta?: string }>();
  const ventaCents = venta && /^\d+$/.test(venta) ? Number(venta) : null;

  return (
    <Paper testID="calculadora">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -12 }}>
        <IconButton icon="back" label={c.vueltos.volver} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} testID="volver" />
        <T variant="title">{c.vueltos.title}</T>
      </View>
      <VueltoCalculator
        initialTotalCents={ventaCents}
        armed={e === "1"}
        tryAccess={tryAccess}
        onAccess={(r) => onAccess(router, r)}
      />
    </Paper>
  );
}
