import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { Card, T } from "@/components/ui";
import { refreshAlerts, usePrivate } from "@/private/data";
import { PrivateScreen } from "@/private/PrivateScreen";
import { shortDate } from "@/lib/format";

/**
 * Avisos aprobados por la organización de la persona, presentados con discreción como
 * "Avisos del proveedor". Nunca llegan como notificación: solo se ven aquí.
 */
export default function Avisos() {
  const alerts = usePrivate((s) => s.alerts);
  const state = usePrivate((s) => s.alertsState);

  useFocusEffect(
    useCallback(() => {
      void refreshAlerts();
    }, []),
  );

  return (
    <PrivateScreen title="Avisos del proveedor" testID="avisos">
      <T variant="secondary">Lo que tu asociación quiere que sepas. Nunca te llegará como notificación.</T>
      {alerts === null ? (
        <T variant="secondary">{state === "offline" ? "Sin conexión. Vuelve a intentarlo cuando tengas internet." : "Cargando…"}</T>
      ) : alerts.length === 0 ? (
        <T variant="secondary">No hay avisos nuevos.</T>
      ) : (
        alerts.map((a) => (
          <Card key={a.id}>
            <T variant="small">
              {a.zona} · {shortDate(a.approved_at)}
            </T>
            <T variant="h2" style={{ fontSize: 18, lineHeight: 24 }}>
              {a.titulo}
            </T>
            <T variant="body">{a.cuerpo}</T>
            {a.que_hacer.length ? (
              <View style={{ gap: 4 }}>
                <T variant="bodyBold">Qué hacer</T>
                {a.que_hacer.map((q) => (
                  <T key={q} variant="body">
                    — {q}
                  </T>
                ))}
              </View>
            ) : null}
          </Card>
        ))
      )}
    </PrivateScreen>
  );
}
