import { useCallback, useRef } from "react";
import { View } from "react-native";

import { Card, Chip, Mark, T } from "@/components/ui";
import { refreshReport, syncNow, usePrivate } from "@/private/data";
import { termsFromReport, Transcript } from "@/private/Transcript";
import { usePolling } from "@/private/usePolling";
import { colors } from "@/theme/tokens";

/**
 * Qué pasó con lo que acabas de guardar: espera conexión, se está subiendo, ya está en la nube
 * y, cuando el servidor lo procesa, la transcripción con los datos resaltados.
 */
export function UploadStatus({ queueId, decoy, showTranscript = true }: { queueId: string | null; decoy: boolean; showTranscript?: boolean }) {
  const item = usePrivate((s) => s.queue.find((q) => q.id === queueId) ?? null);
  const report = usePrivate((s) => s.report);
  // La fila de la cola se borra cuando el reporte ya incluye la evidencia: se recuerda su id.
  const evRef = useRef<string | null>(null);
  if (item?.evidence_id) evRef.current = item.evidence_id;
  const evidenceId = evRef.current;
  const ev = evidenceId ? (report?.evidencia.find((e) => e.id === evidenceId) ?? null) : null;
  const gone = !!queueId && !item; // ya se quitó de la cola porque el reporte la incluye
  const done = ev?.status === "procesado";

  const tick = useCallback(async () => {
    await syncNow();
    await refreshReport();
  }, []);
  usePolling(tick, decoy || done ? null : 2500);

  if (decoy) return <Chip label="Guardado cifrado, fuera de este celular" icon="lock" color={colors.resaltadorVerde} />;

  let label = "Guardando…";
  let icon: "clock" | "upload" | "lock" | "alert" = "clock";
  let color: string = colors.resaltador;
  if (item?.status === "pendiente") label = "Guardado cifrado. Se subirá cuando haya conexión";
  if (item?.status === "subiendo") {
    label = "Subiendo, cifrado…";
    icon = "upload";
  }
  if (item?.status === "error") {
    label = "No se pudo subir. Lo reintentaremos";
    icon = "alert";
  }
  if (item?.status === "subido" || gone || ev) {
    label = "Guardado cifrado, fuera de este celular";
    icon = "lock";
    color = colors.resaltadorVerde;
  }

  const hallazgos = report?.hallazgos ?? [];

  return (
    <View style={{ gap: 12 }} accessibilityLiveRegion="polite">
      <Chip label={label} icon={icon} color={color} testID="estado-subida" />
      {showTranscript && (item?.status === "subido" || ev) ? (
        <Card>
          <T variant="h2">{done ? (ev?.transcripcion?.length ? "Lo que dice" : "Revisado") : "Revisando lo que subiste…"}</T>
          {done && ev?.transcripcion?.length ? <Transcript turns={ev.transcripcion} terms={termsFromReport(report)} /> : null}
          {done && ev?.nota ? <T variant="secondary">{ev.nota}</T> : null}
          {done && hallazgos.length ? (
            <View style={{ gap: 8 }}>
              <T variant="h2">Lo que encontramos</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {hallazgos.map((h) => (
                  <Mark key={h} label={h} />
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}
