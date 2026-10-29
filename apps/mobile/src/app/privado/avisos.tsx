import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { Button, Card, T } from "@/components/ui";
import { LlamadasOficiales } from "@/private/Ayuda";
import { refreshAlerts, refreshRecommendations, usePrivate } from "@/private/data";
import { PrivateScreen } from "@/private/PrivateScreen";
import { RecomendacionCard } from "@/private/Recomendacion";
import { nombreDeZona } from "@/private/recomendaciones";
import { shortDate } from "@/lib/format";
import { districtOfZone } from "@/shared";
import { useConfig } from "@/state/config";
import { useSessionMode } from "@/state/session";

/**
 * Avisos y recomendaciones de prevención de la zona de la persona (su distrito), aprobados por el
 * equipo central y presentados con discreción como "Avisos del proveedor". Nunca llegan como
 * notificación: solo se ven aquí, detrás del PIN.
 */
export default function Avisos() {
  const alerts = usePrivate((s) => s.alerts);
  const state = usePrivate((s) => s.alertsState);
  const recs = usePrivate((s) => s.recommendations);
  const recsState = usePrivate((s) => s.recommendationsState);
  const distrito = useConfig((c) => districtOfZone(c.zona));
  // Con el PIN señuelo no se muestra el distrito real: diría algo del caso.
  const decoy = useSessionMode() === "decoy";

  useFocusEffect(
    useCallback(() => {
      void refreshAlerts();
      void refreshRecommendations();
    }, []),
  );

  return (
    <PrivateScreen
      title="Avisos del proveedor"
      testID="avisos"
      footer={
        <View style={{ gap: 8 }} testID="no-pagues">
          <T variant="bodyBold">No pagues ni negocies. Si estás en peligro, llama.</T>
          <LlamadasOficiales />
        </View>
      }
    >
      <T variant="secondary" testID="avisos-zona">
        {decoy ? "Avisos de tu zona." : distrito ? `Avisos de ${distrito.name}, tu zona.` : "Elige tu distrito en Ajustes para ver los avisos de tu zona."}{" "}
        Los revisa nuestro equipo. Nunca te llegará nada como notificación.
      </T>
      {alerts === null ? (
        <T variant="secondary">
          {state === "offline"
            ? "Sin conexión. Vuelve a intentarlo cuando tengas internet."
            : state === "error"
              ? "No pudimos cargar los avisos. Inténtalo de nuevo en un momento."
              : "Cargando…"}
        </T>
      ) : alerts.length === 0 ? (
        <T variant="secondary">No hay avisos nuevos.</T>
      ) : (
        alerts.map((a) => (
          <Card key={a.id}>
            <T variant="small">
              {nombreDeZona(a)} · {shortDate(a.approved_at)}
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

      <View style={{ gap: 12, paddingTop: 8 }} testID="recomendaciones">
        <View style={{ gap: 2 }}>
          <T variant="h2" accessibilityRole="header" style={{ fontSize: 18, lineHeight: 24 }}>
            Recomendaciones para tu zona
          </T>
          <T variant="secondary">Consejos de prevención para negocios como el tuyo. Nuestro equipo los revisó antes de mostrártelos.</T>
        </View>
        {recs === null ? (
          recsState === "offline" || recsState === "error" ? (
            <View style={{ gap: 8 }}>
              <T variant="secondary" accessibilityLiveRegion="polite" testID="recomendaciones-error">
                {recsState === "offline"
                  ? "Sin conexión. Vuelve a intentarlo cuando tengas internet."
                  : "No pudimos cargar las recomendaciones. Inténtalo de nuevo en un momento."}
              </T>
              <Button label="Volver a intentar" kind="secondary" compact style={{ alignSelf: "flex-start" }} onPress={() => void refreshRecommendations()} />
            </View>
          ) : (
            <T variant="secondary">Cargando…</T>
          )
        ) : recs.length === 0 ? (
          <T variant="secondary" testID="recomendaciones-vacio">
            Todavía no hay recomendaciones para tu zona. Cuando las haya, las verás aquí.
          </T>
        ) : (
          recs.map((r) => <RecomendacionCard key={r.id} r={r} />)
        )}
      </View>
    </PrivateScreen>
  );
}
