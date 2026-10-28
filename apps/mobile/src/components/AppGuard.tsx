import * as Network from "expo-network";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";

import { GridPaper, T } from "@/components/ui";
import { disguiseCopy } from "@/disguise/copy";
import { syncNow } from "@/private/data";
import { quickExit } from "@/security/quickExit";
import { cleanupTempFiles } from "@/security/wipe";
import { endExternal, onLock, sessionStore, shouldLockOnBackground } from "@/state/session";
import { layout } from "@/theme/tokens";

const SYNC_EVERY_MS = 20_000;

/**
 * Guardián de la app:
 * - Al pasar a segundo plano, bloquea y vuelve al disfraz (salvo que la app misma haya abierto
 *   el selector de fotos o la hoja de compartir).
 * - Cuando la ventana pierde el foco (selector de apps, cortina de notificaciones) tapa la
 *   pantalla con una cubierta neutra. En Android, FLAG_SECURE además deja en blanco la miniatura.
 * - Reintenta la cola de subida al volver la conexión y cada 20 segundos mientras la app está
 *   abierta, aun en el disfraz.
 */
export function AppGuard() {
  const router = useRouter();
  const [covered, setCovered] = useState(false);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        if (shouldLockOnBackground()) quickExit(routerRef.current);
        if (sessionStore.get().mode !== "locked") setCovered(true);
      } else if (next === "active") {
        setCovered(false);
        endExternal();
        void syncNow();
      }
    });
    const blur = AppState.addEventListener("blur", () => {
      if (sessionStore.get().mode !== "locked") setCovered(true);
    });
    const focus = AppState.addEventListener("focus", () => setCovered(false));
    const net = Network.addNetworkStateListener((s) => {
      if (s.isConnected) void syncNow();
    });
    const offLock = onLock(cleanupTempFiles);
    cleanupTempFiles();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void syncNow();
    }, SYNC_EVERY_MS);
    void syncNow();
    return () => {
      sub.remove();
      blur.remove();
      focus.remove();
      net.remove();
      offLock();
      clearInterval(timer);
    };
  }, []);

  if (!covered) return null;
  return (
    <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <GridPaper />
      <View style={{ paddingTop: 64, paddingLeft: layout.padLeft }}>
        <T variant="title">{disguiseCopy.privacidad.cubierta}</T>
      </View>
    </View>
  );
}
