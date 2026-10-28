import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible";
import { Kalam_400Regular, Kalam_700Bold } from "@expo-google-fonts/kalam";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { ShareIntentProvider } from "expo-share-intent";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppGuard } from "@/components/AppGuard";
import { ShareIntake } from "@/components/ShareIntake";
import { loadConfig } from "@/state/config";
import { colors } from "@/theme/tokens";

loadConfig();
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Respeta "Quitar animaciones" del sistema. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
    Kalam_400Regular,
    Kalam_700Bold,
  });
  const ready = fontsLoaded || !!fontError;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <ShareIntentProvider options={{ resetOnBackground: false }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: reduceMotion ? "none" : "fade",
            animationDuration: 180,
            contentStyle: { backgroundColor: colors.papel },
          }}
        />
        <ShareIntake />
        <AppGuard />
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
