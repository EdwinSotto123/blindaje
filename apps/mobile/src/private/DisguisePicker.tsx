import { Pressable, View } from "react-native";

import { Icon } from "@/components/Icon";
import { T } from "@/components/ui";
import { disguiseCopy } from "@/disguise/copy";
import type { DisguiseKind } from "@/state/config";
import { colors } from "@/theme/tokens";

const DISFRACES: { key: DisguiseKind; label: string }[] = [
  { key: "cuaderno", label: disguiseCopy.disfraces.cuaderno },
  { key: "lista", label: disguiseCopy.disfraces.lista },
  { key: "vueltos", label: disguiseCopy.disfraces.vueltos },
];

export function DisguisePicker({ value, onChange }: { value: DisguiseKind; onChange: (d: DisguiseKind) => void }) {
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup">
      {DISFRACES.map((d) => {
        const on = d.key === value;
        return (
          <Pressable
            key={d.key}
            onPress={() => onChange(d.key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={d.label}
            style={{
              minHeight: 52,
              borderRadius: 12,
              borderWidth: on ? 2.5 : 1.5,
              borderColor: on ? colors.tinta : colors.borde,
              backgroundColor: colors.blanco,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 14,
            }}
          >
            <Icon name={d.key === "cuaderno" ? "file" : d.key === "lista" ? "list" : "calc"} />
            <T variant="bodyBold" style={{ flex: 1 }}>
              {d.label}
            </T>
            {on ? <Icon name="check" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

