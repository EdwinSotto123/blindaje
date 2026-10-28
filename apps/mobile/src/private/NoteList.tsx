import { Pressable, StyleSheet, View } from "react-native";

import { Icon, type IconName } from "@/components/Icon";
import { T } from "@/components/ui";
import type { NoteRow, RowState } from "@/private/rows";
import type { EvidenceType } from "@/shared";
import { colors } from "@/theme/tokens";

const ICON: Record<EvidenceType, IconName> = { audio: "mic", texto: "message", imagen: "image", video: "camera" };

const STATE_ICON: Record<RowState, IconName> = {
  nube: "lock",
  procesando: "clock",
  subiendo: "upload",
  pendiente: "clock",
  error: "alert",
};

export function NoteListItem({ row, onPress }: { row: NoteRow; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${row.title}. ${row.subtitle}. ${row.when}`}
      style={({ pressed }) => [s.item, pressed && { backgroundColor: colors.cuadriculaSuave }]}
    >
      <View style={s.icon}>
        <Icon name={ICON[row.tipo]} size={20} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="bodyBold">{row.title}</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {row.state !== "nube" || row.subtitle === "Guardado en la nube" ? <Icon name={STATE_ICON[row.state]} size={14} color={colors.lapiz} /> : null}
          <T variant="small" numberOfLines={2} style={{ flexShrink: 1 }}>
            {row.subtitle}
          </T>
        </View>
      </View>
      <T variant="small" style={{ fontSize: 13 }}>
        {row.when}
      </T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  item: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.borde, paddingVertical: 6 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.tinta,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.papel,
  },
});
