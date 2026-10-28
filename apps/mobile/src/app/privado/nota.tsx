import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Card, Chip, T } from "@/components/ui";
import { usePrivate } from "@/private/data";
import { PrivateScreen } from "@/private/PrivateScreen";
import { titleFor } from "@/private/rows";
import { termsFromReport, Transcript } from "@/private/Transcript";
import { shortDateTime } from "@/lib/format";
import { colors } from "@/theme/tokens";

/** Detalle de una nota: transcripción con datos resaltados y huella de integridad. */
export default function Nota() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = usePrivate((s) => s.report);
  const ev = report?.evidencia.find((e) => e.id === id) ?? null;

  return (
    <PrivateScreen title={ev ? titleFor(ev.tipo, ev.duration_ms) : "Nota"} testID="nota">
      {!ev ? (
        <T variant="secondary">No pudimos cargar esta nota. Revisa tu conexión.</T>
      ) : (
        <>
          <Chip label="Guardado cifrado, fuera de este celular" icon="lock" color={colors.resaltadorVerde} />
          <T variant="secondary">
            {ev.label} · {shortDateTime(ev.captured_at ?? ev.received_utc)}
          </T>
          {ev.transcripcion?.length ? (
            <Card>
              <T variant="h2">{ev.tipo === "texto" ? "El mensaje" : "Lo que dice"}</T>
              <Transcript turns={ev.transcripcion} terms={termsFromReport(report)} />
            </Card>
          ) : ev.status !== "procesado" ? (
            <T variant="secondary">Estamos revisando esta nota…</T>
          ) : null}
          {ev.nota ? (
            <Card>
              <T variant="h2">Nota</T>
              <T variant="body">{ev.nota}</T>
            </Card>
          ) : null}
          <View style={{ gap: 4 }}>
            <T variant="h2">Huella de integridad (SHA-256)</T>
            <T variant="small" selectable style={{ fontFamily: "monospace" }}>
              {ev.sha256}
            </T>
            <T variant="small">Si alguien cambiara el archivo, esta huella ya no coincidiría.</T>
          </View>
        </>
      )}
    </PrivateScreen>
  );
}
