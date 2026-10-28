import { Linking, View } from "react-native";

import { Button } from "@/components/ui";
import { LINEA_DENUNCIAS, LINEA_EMERGENCIAS } from "@/shared";

/** 105 y Línea 1818 a mano. Se usa en las notas privadas y en los avisos del proveedor. */
export function LlamadasOficiales() {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button
        label={`Llamar al ${LINEA_EMERGENCIAS}`}
        accessibilityLabel={`Llamar al ${LINEA_EMERGENCIAS}, emergencias`}
        kind="danger"
        compact
        icon="phone"
        style={{ flex: 1 }}
        onPress={() => void Linking.openURL(`tel:${LINEA_EMERGENCIAS}`)}
      />
      <Button
        label={`Línea ${LINEA_DENUNCIAS}`}
        accessibilityLabel={`Llamar a la Línea ${LINEA_DENUNCIAS}, denuncias`}
        kind="secondary"
        compact
        icon="phone"
        style={{ flex: 1 }}
        onPress={() => void Linking.openURL(`tel:${LINEA_DENUNCIAS}`)}
      />
    </View>
  );
}
