import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";

import { Button, Field, Segmented, T } from "@/components/ui";
import { utf8 } from "@/lib/bytes";
import { saveBytes } from "@/private/data";
import { PrivateScreen } from "@/private/PrivateScreen";
import { UploadStatus } from "@/private/UploadStatus";
import { useSessionMode } from "@/state/session";

type Cuando = "hoy" | "ayer" | "antes";

function capturedAt(c: Cuando): string {
  const d = new Date();
  if (c === "ayer") d.setDate(d.getDate() - 1);
  if (c === "antes") d.setDate(d.getDate() - 3);
  return d.toISOString();
}

/** Pegar un mensaje de texto (por ejemplo, copiado de WhatsApp o un SMS). */
export default function Pegar() {
  const decoy = useSessionMode() === "decoy";
  const [texto, setTexto] = useState("");
  const [cuando, setCuando] = useState<Cuando>("hoy");
  const [busy, setBusy] = useState(false);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const pegar = async () => {
    const t = await Clipboard.getStringAsync();
    if (t) setTexto((prev) => (prev ? `${prev}\n${t}` : t));
  };

  const guardar = async () => {
    const t = texto.trim();
    if (!t) return;
    setBusy(true);
    try {
      const item = await saveBytes(utf8(t), {
        tipo: "texto",
        mime: "text/plain; charset=utf-8",
        source: "pegado",
        capturedAt: capturedAt(cuando),
        preview: t.slice(0, 120),
      });
      setQueueId(item?.id ?? null);
      setSaved(true);
      setTexto("");
      // El portapapeles puede quedar a la vista de otras apps: se limpia.
      void Clipboard.setStringAsync("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PrivateScreen
      title="Pegar mensaje"
      testID="pegar"
      footer={saved ? undefined : <Button label="Guardar mensaje" onPress={guardar} loading={busy} disabled={!texto.trim()} testID="guardar-mensaje" />}
    >
      {saved ? (
        <View style={{ gap: 12 }}>
          <UploadStatus queueId={queueId} decoy={decoy} />
          <Button label="Pegar otro mensaje" kind="secondary" onPress={() => setSaved(false)} />
        </View>
      ) : (
        <>
          <T variant="secondary">Copia el mensaje en WhatsApp o en tus SMS y pégalo aquí, tal cual llegó.</T>
          <Button label="Pegar lo que copiaste" kind="secondary" icon="clipboard" compact onPress={pegar} testID="pegar-portapapeles" />
          <Field label="Mensaje" multiline value={texto} onChangeText={setTexto} placeholder="Escribe o pega el mensaje" testID="mensaje" />
          <View style={{ gap: 6 }}>
            <T variant="h2">¿Cuándo te llegó?</T>
            <Segmented<Cuando>
              options={[
                { key: "hoy", label: "Hoy" },
                { key: "ayer", label: "Ayer" },
                { key: "antes", label: "Antes" },
              ]}
              value={cuando}
              onChange={setCuando}
              kind="choice"
              label="¿Cuándo te llegó?"
            />
          </View>
        </>
      )}
    </PrivateScreen>
  );
}
