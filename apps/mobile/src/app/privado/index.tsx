import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";

import { Icon } from "@/components/Icon";
import { ActionTile, Button, Card, Chip, Mark, T } from "@/components/ui";
import { LlamadasOficiales } from "@/private/Ayuda";
import { loadDecoy, refreshQueue, refreshReport, syncNow, usePrivate } from "@/private/data";
import { NoteListItem } from "@/private/NoteList";
import { PrivateScreen } from "@/private/PrivateScreen";
import { buildRows, type NoteRow, overallSafety, safetyLabel, titleFor } from "@/private/rows";
import { shortDateTime } from "@/lib/format";
import { useSessionMode } from "@/state/session";
import { colors } from "@/theme/tokens";
import { usePolling } from "@/private/usePolling";

/** Notas privadas (design/cuaderno/cuaderno-boveda.dc.html). */
export default function NotasPrivadas() {
  const router = useRouter();
  const mode = useSessionMode();
  const decoy = mode === "decoy";
  const report = usePrivate((s) => s.report);
  const reportState = usePrivate((s) => s.reportState);
  const queueItems = usePrivate((s) => s.queue);
  const online = usePrivate((s) => s.online);
  const decoyItems = usePrivate((s) => s.decoy);

  useFocusEffect(
    useCallback(() => {
      if (decoy) void loadDecoy();
      else {
        void refreshQueue();
        void refreshReport();
        void syncNow();
      }
    }, [decoy]),
  );

  const rows: NoteRow[] = useMemo(() => {
    if (decoy)
      return decoyItems.map((d) => ({
        key: `d:${d.id}`,
        tipo: d.tipo,
        title: titleFor(d.tipo, d.duration_ms, "camara"),
        subtitle: d.tipo === "texto" && d.preview ? `“${d.preview.slice(0, 40)}”` : "Guardado",
        when: shortDateTime(d.created_at),
        state: "nube" as const,
        evidenceId: null,
        queueId: null,
        sortAt: d.created_at,
      }));
    return buildRows(report, queueItems);
  }, [decoy, decoyItems, report, queueItems]);

  const held = decoy ? [] : queueItems.filter((q) => q.status === "retenido");
  const safety = overallSafety(decoy ? [] : queueItems, online, (report?.evidencia.length ?? 0) > 0);
  const hallazgos = decoy ? [] : (report?.hallazgos ?? []);
  const processing = !decoy && (rows.some((r) => r.state === "procesando" || r.state === "subiendo") || queueItems.some((q) => q.status === "pendiente"));

  usePolling(async () => {
    await syncNow();
    await refreshReport();
  }, processing ? 4000 : null);

  return (
    <PrivateScreen
      title="Notas privadas"
      home
      testID="notas-privadas"
      footer={<Button label="Preparar mi denuncia" onPress={() => router.push("/privado/denuncia")} testID="preparar" />}
    >
      <Chip
        label={safetyLabel(safety)}
        icon={safety.kind === "esperando" ? "clock" : safety.kind === "subiendo" ? "upload" : "lock"}
        color={safety.kind === "esperando" ? colors.resaltador : colors.resaltadorVerde}
        testID="chip-seguridad"
      />

      {held.length > 0 ? (
        <Pressable
          onPress={() => router.push("/privado/recibido")}
          accessibilityRole="button"
          style={{ borderWidth: 2, borderColor: colors.tinta, borderRadius: 12, padding: 12, flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: colors.blanco }}
        >
          <Icon name="file" />
          <View style={{ flex: 1 }}>
            <T variant="bodyBold">{held.length === 1 ? "Recibiste 1 archivo" : `Recibiste ${held.length} archivos`}</T>
            <T variant="small">Revísalo y decide si lo guardas.</T>
          </View>
          <Icon name="chevron" />
        </Pressable>
      ) : null}

      <View style={{ gap: 4 }}>
        <T variant="h2">Lo que recibiste</T>
        {rows.length === 0 ? (
          <T variant="secondary" style={{ paddingVertical: 8 }}>
            {reportState === "loading" ? "Cargando…" : reportState === "offline" ? "Sin conexión. Lo que ya subiste está a salvo en la nube y se verá cuando vuelva la señal." : "Todavía no guardas nada. Graba un audio, toma una foto o pega un mensaje."}
          </T>
        ) : (
          rows.map((r) => (
            <NoteListItem
              key={r.key}
              row={r}
              onPress={
                decoy
                  ? undefined
                  : r.state === "error" || r.state === "pendiente"
                    ? () => void syncNow(true)
                    : r.evidenceId
                      ? () => router.push({ pathname: "/privado/nota", params: { id: r.evidenceId! } })
                      : undefined
              }
            />
          ))
        )}
      </View>

      <Card>
        <T variant="h2">Lo que encontramos</T>
        {hallazgos.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} testID="hallazgos">
            {hallazgos.map((h) => (
              <Mark key={h} label={h} />
            ))}
          </View>
        ) : (
          <T variant="secondary">
            {processing ? "Estamos revisando lo que subiste…" : "Aquí verás los datos que detectemos: montos, plazos, números y nombres de grupos."}
          </T>
        )}
      </Card>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <ActionTile label="Grabar" icon="mic" onPress={() => router.push("/privado/grabar")} testID="accion-grabar" />
        <ActionTile label="Foto" icon="camera" onPress={() => router.push("/privado/foto")} testID="accion-foto" />
        <ActionTile label="Pegar mensaje" icon="clipboard" onPress={() => router.push("/privado/pegar")} testID="accion-pegar" />
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          label="Avisos del proveedor"
          accessibilityHint="Avisos y recomendaciones de tu asociación"
          kind="secondary"
          compact
          icon="megaphone"
          style={{ flex: 1 }}
          onPress={() => router.push("/privado/avisos")}
        />
        <Button label="Ajustes" kind="secondary" compact icon="gear" onPress={() => router.push("/privado/ajustes")} />
      </View>

      <View style={{ gap: 8 }} testID="ayuda">
        <T variant="h2">Si estás en peligro</T>
        <LlamadasOficiales />
      </View>
    </PrivateScreen>
  );
}
