import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Paper, T } from "@/components/ui";
import { disguiseCopy as c } from "@/disguise/copy";
import { getDisguiseRepo } from "@/disguise/provider";
import type { Vuelto } from "@/disguise/repo";
import { HOLD_MS, isSecretAmount } from "@/disguise/secret";
import { VueltoCalculator } from "@/disguise/VueltoCalculator";
import { parseSoles, shortDateTime, soles } from "@/lib/format";
import { onAccess } from "@/disguise/onAccess";
import { tryAccess } from "@/security/access";
import { configStore, useConfig } from "@/state/config";
import { colors } from "@/theme/tokens";

/**
 * Disfraz "Calculadora de vueltos". Entradas secretas: mantener presionado el título, o poner
 * el monto secreto como Total; después, el PIN se teclea en "Pagó con".
 */
export function VueltosHome() {
  const router = useRouter();
  const holdTitle = useConfig((x) => x.holdTitle);
  const [armedByHold, setArmedByHold] = useState(false);
  const [hist, setHist] = useState<Vuelto[]>([]);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => setHist(await getDisguiseRepo().vueltos()), []);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => setArmedByHold(false);
    }, [load]),
  );

  return (
    <Paper testID="disfraz-vueltos">
      <Pressable
        accessibilityRole="header"
        accessibilityLabel={c.vueltos.titleHint}
        testID="titulo"
        onPressIn={() => {
          if (!holdTitle) return;
          setTimer(setTimeout(() => setArmedByHold(true), HOLD_MS));
        }}
        onPressOut={() => {
          if (timer) clearTimeout(timer);
          setTimer(null);
        }}
      >
        <T variant="title">{c.vueltos.title}</T>
        <T variant="small">{c.vueltos.tocaCampo}</T>
      </Pressable>

      <VueltoCalculator
        armed={(s) => armedByHold || isSecretAmount(parseSoles(s.total), configStore.get())}
        tryAccess={tryAccess}
        onAccess={(r) => onAccess(router, r)}
        onCalculated={load}
      />

      <View style={{ gap: 4 }}>
        <T variant="h2">{c.vueltos.ultimos}</T>
        {hist.length === 0 ? (
          <T variant="secondary">{c.vueltos.vacio}</T>
        ) : (
          hist.map((h) => (
            <View key={h.id} style={st.line}>
              <T variant="handSmall">
                {soles(h.total_cents)} → {soles(h.pago_cents)}
              </T>
              <T variant="small">{shortDateTime(h.created_at)}</T>
            </View>
          ))
        )}
      </View>
    </Paper>
  );
}

const st = StyleSheet.create({
  line: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.borde },
});
