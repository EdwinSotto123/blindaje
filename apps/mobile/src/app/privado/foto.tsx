import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Button, T } from "@/components/ui";
import { evidenceTypeForMime } from "@/lib/mime";
import { deleteFileQuietly, saveFile } from "@/private/data";
import { PrivateScreen } from "@/private/PrivateScreen";
import { UploadStatus } from "@/private/UploadStatus";
import { endExternal, expectExternal, useSessionMode } from "@/state/session";
import { colors, radius } from "@/theme/tokens";

/**
 * Foto con la cámara dentro de la app: el archivo queda en la caché privada, se cifra, se sube
 * y se borra. Nunca pasa por la galería.
 */
export default function Foto() {
  const decoy = useSessionMode() === "decoy";
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const take = async () => {
    if (!cam.current || busy) return;
    setBusy(true);
    let uri: string | null = null;
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.8, exif: false, shutterSound: false });
      uri = pic?.uri ?? null;
      if (!uri) return;
      const item = await saveFile(uri, { tipo: "imagen", mime: "image/jpeg", source: "camara" });
      setQueueId(item?.id ?? null);
      setSaved(true);
    } finally {
      deleteFileQuietly(uri);
      setBusy(false);
    }
  };

  /** Elegir una foto que ya tienes (por ejemplo, la que te mandaron). Solo se lee: no se copia a la galería. */
  const pick = async () => {
    expectExternal();
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 1, exif: false, allowsEditing: false });
      if (r.canceled || !r.assets[0]) return;
      const a = r.assets[0];
      setBusy(true);
      const mime = a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/jpeg");
      const item = await saveFile(a.uri, { tipo: evidenceTypeForMime(mime), mime, source: "galeria", durationMs: a.duration ?? null });
      setQueueId(item?.id ?? null);
      setSaved(true);
    } finally {
      endExternal();
      setBusy(false);
    }
  };

  return (
    <PrivateScreen title="Foto" testID="foto">
      {!perm ? null : !perm.granted ? (
        <View style={{ gap: 12 }}>
          <T variant="body">Para tomar fotos aquí, permite el uso de la cámara. Las fotos no se guardan en tu galería.</T>
          <Button
            label="Permitir cámara"
            onPress={() => {
              expectExternal(30_000);
              void requestPerm().finally(endExternal);
            }}
          />
        </View>
      ) : saved ? null : (
        <View style={{ gap: 12 }}>
          <View style={s.frame}>
            <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} />
          </View>
          <View style={{ alignItems: "center" }}>
            <Pressable
              onPress={take}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Tomar foto"
              testID="disparar"
              style={({ pressed }) => [s.shutter, pressed && { opacity: 0.8 }]}
            >
              <Icon name="camera" size={34} color={colors.blanco} />
            </Pressable>
          </View>
          <T variant="small" style={{ textAlign: "center" }}>
            La foto no se guarda en tu galería.
          </T>
        </View>
      )}

      {saved ? (
        <View style={{ gap: 12 }}>
          <UploadStatus queueId={queueId} decoy={decoy} />
          <Button
            label="Tomar otra"
            kind="secondary"
            icon="camera"
            onPress={() => {
              setSaved(false);
              setQueueId(null);
            }}
          />
        </View>
      ) : null}

      <Button label="Elegir una foto que ya tienes" kind="secondary" icon="image" onPress={pick} disabled={busy} />
    </PrivateScreen>
  );
}

const s = StyleSheet.create({
  frame: { height: 360, borderRadius: radius.boton, overflow: "hidden", borderWidth: 1.5, borderColor: colors.borde, backgroundColor: colors.tinta },
  shutter: { width: 76, height: 76, borderRadius: 999, backgroundColor: colors.tinta, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: colors.cuadriculaSuave },
});
