import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { Button, Card, T } from "@/components/ui";
import { refreshQueue, syncNow, usePrivate } from "@/private/data";
import { NoteListItem } from "@/private/NoteList";
import { PrivateScreen } from "@/private/PrivateScreen";
import { titleFor } from "@/private/rows";
import { shortDateTime } from "@/lib/format";
import { queue } from "@/services";
import { useSessionMode } from "@/state/session";

/**
 * Archivos compartidos desde otra app (por ejemplo, un audio reenviado desde WhatsApp). Llegaron
 * cifrados y retenidos; aquí la persona decide si los guarda (y entonces se suben) o los descarta.
 */
export default function Recibido() {
  const router = useRouter();
  const decoy = useSessionMode() === "decoy";
  const all = usePrivate((s) => s.queue);
  const held = useMemo(() => all.filter((q) => q.status === "retenido"), [all]);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshQueue();
    }, []),
  );

  const guardarTodo = async () => {
    setBusy(true);
    try {
      for (const h of held) await queue.release(h.id);
      await refreshQueue();
      void syncNow();
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <PrivateScreen
      title="Archivos recibidos"
      testID="recibido"
      footer={
        !decoy && held.length ? (
          <>
            <Button label={held.length === 1 ? "Guardar en mis notas" : `Guardar los ${held.length}`} onPress={guardarTodo} loading={busy} testID="guardar-recibidos" />
          </>
        ) : undefined
      }
    >
      {decoy || held.length === 0 ? (
        <T variant="secondary">No tienes archivos por revisar.</T>
      ) : (
        <>
          <T variant="secondary">Llegaron desde otra app y están guardados cifrados en este celular. Si los guardas, se suben a la nube y se borran de aquí.</T>
          <View>
            {held.map((h) => (
              <View key={h.id} style={{ gap: 6 }}>
                <NoteListItem
                  row={{
                    key: h.id,
                    tipo: h.tipo,
                    title: titleFor(h.tipo, h.duration_ms, h.source),
                    subtitle: h.preview ? `“${h.preview.slice(0, 50)}”` : `${Math.max(1, Math.round(h.size / 1024))} KB`,
                    when: shortDateTime(h.captured_at ?? h.created_at),
                    state: "pendiente",
                    evidenceId: null,
                    queueId: h.id,
                    sortAt: h.created_at,
                  }}
                />
                <Button
                  label="Descartar"
                  kind="ghost"
                  compact
                  icon="trash"
                  onPress={async () => {
                    await queue.discard(h.id);
                    await refreshQueue();
                  }}
                />
              </View>
            ))}
          </View>
          <Card>
            <T variant="small">Consejo: después de guardarlo aquí, puedes borrar el audio o la foto del chat si te preocupa que alguien revise tu celular.</T>
          </Card>
        </>
      )}
    </PrivateScreen>
  );
}
