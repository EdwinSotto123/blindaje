import { usePreventScreenCapture } from "expo-screen-capture";
import { useFocusEffect, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useId } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";

import { IconButton, Paper, T } from "@/components/ui";
import { ALLOW_SCREENSHOTS } from "@/config";
import { quickExit } from "@/security/quickExit";
import { configStore, updateConfig } from "@/state/config";
import { sessionStore, useSessionMode } from "@/state/session";
import { colors, fonts, layout, radius } from "@/theme/tokens";

/**
 * Prevención de capturas (FLAG_SECURE en Android, que además deja en blanco la miniatura del
 * selector de apps). EXPO_PUBLIC_ALLOW_SCREENSHOTS=1 la desactiva SOLO para las capturas del demo.
 */
const useNoCapture: () => void = ALLOW_SCREENSHOTS
  ? () => undefined
  : () => {
      const id = useId();
      usePreventScreenCapture(`privado-${id}`);
    };

export function SalirRapido() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        // Durante la configuración inicial, salir rápido también evita que se vuelva a abrir sola.
        if (!configStore.get().onboarded) void updateConfig({ wiped: true });
        quickExit(router);
      }}
      accessibilityRole="button"
      accessibilityLabel="Salir rápido"
      accessibilityHint="Vuelve al cuaderno y bloquea las notas"
      testID="salir-rapido"
      hitSlop={4}
      style={({ pressed }) => [s.exit, pressed && { backgroundColor: colors.cuadriculaSuave }]}
    >
      <Text maxFontSizeMultiplier={1.3} style={s.exitText}>
        Salir rápido
      </Text>
    </Pressable>
  );
}

type Props = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  back?: boolean;
  scroll?: boolean;
  /** "onboarding": no exige sesión (todavía no hay PIN). */
  kind?: "private" | "onboarding";
  /** Pantalla principal privada: "atrás" bloquea y vuelve al disfraz. */
  home?: boolean;
  testID?: string;
};

/** Pantalla privada: exige sesión abierta, bloquea capturas y siempre muestra "Salir rápido". */
export function PrivateScreen({ title, children, footer, back = true, scroll = true, kind = "private", home = false, testID }: Props) {
  useNoCapture();
  const router = useRouter();
  const mode = useSessionMode();
  const guarded = kind === "private";

  // En la pantalla principal, el botón "atrás" del sistema equivale a salir rápido.
  useFocusEffect(
    useCallback(() => {
      if (!home) return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        quickExit(router);
        return true;
      });
      return () => sub.remove();
    }, [home, router]),
  );

  // Si se llega aquí sin sesión (por ejemplo, con un enlace), se vuelve al disfraz.
  useEffect(() => {
    if (guarded && sessionStore.get().mode === "locked") quickExit(router);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (guarded && mode === "locked") return <View style={{ flex: 1, backgroundColor: colors.papel }} />;

  return (
    <Paper footer={footer} scroll={scroll} testID={testID}>
      <View style={s.header}>
        <View style={s.titleRow}>
          {back && !home && router.canGoBack() ? (
            <View style={{ marginLeft: -12 }}>
              <IconButton icon="back" label="Volver" onPress={() => router.back()} testID="volver" />
            </View>
          ) : null}
          <T variant="titleSmall" accessibilityRole="header" style={{ flexShrink: 1 }}>
            {title}
          </T>
        </View>
        <SalirRapido />
      </View>
      {children}
    </Paper>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1 },
  exit: {
    minHeight: layout.toqueMin,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: colors.tinta,
    borderRadius: radius.botonChico,
    backgroundColor: colors.papel,
    alignItems: "center",
    justifyContent: "center",
  },
  exitText: { fontFamily: fonts.textoBold, fontSize: 15, color: colors.tinta },
});
