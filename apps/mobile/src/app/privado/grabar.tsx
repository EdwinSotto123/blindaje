import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Linking, Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Button, T } from "@/components/ui";
import { deleteFileQuietly, saveFile } from "@/private/data";
import { PrivateScreen } from "@/private/PrivateScreen";
import { UploadStatus } from "@/private/UploadStatus";
import { duration } from "@/lib/format";
import { endExternal, expectExternal, useSessionMode } from "@/state/session";
import { colors, fonts } from "@/theme/tokens";

const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const BARS = 32;
const MIN_MS = 800;

type Phase = "idle" | "recording" | "saving" | "saved" | "denied";

/** Grabar: mantener presionado el botón grande; al soltar, se cifra, se sube y se transcribe. */
export default function Grabar() {
  const decoy = useSessionMode() === "decoy";
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, 80);
  const [phase, setPhase] = useState<Phase>("idle");
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.05));
  const [queueId, setQueueId] = useState<string | null>(null);
  const [toggleMode, setToggleMode] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const starting = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setToggleMode);
    // El diálogo de permisos pausa la app: se avisa para que no se bloquee.
    expectExternal(30_000);
    void requestRecordingPermissionsAsync()
      .then((p) => {
        if (!p.granted) setPhase("denied");
      })
      .finally(endExternal);
  }, []);

  useEffect(() => {
    if (!state.isRecording) return;
    const db = state.metering ?? -60;
    const lvl = Math.max(0.05, Math.min(1, (db + 60) / 60));
    setLevels((l) => [...l.slice(1), lvl]);
  }, [state.durationMillis, state.isRecording, state.metering]);

  // Si la pantalla se cierra grabando (salir rápido, segundo plano), se descarta la grabación.
  useEffect(
    () => () => {
      try {
        if (recorder.isRecording) void recorder.stop().then(() => deleteFileQuietly(recorder.uri));
      } catch {
        // ya liberado
      }
    },
    [recorder],
  );

  const start = async (): Promise<boolean> => {
    setHint(null);
    try {
      const perm = await getRecordingPermissionsAsync();
      if (!perm.granted) {
        setPhase("denied");
        return false;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setLevels(Array(BARS).fill(0.05));
      setPhase("recording");
      return true;
    } catch {
      setPhase("idle");
      setHint("No pudimos usar el micrófono. Inténtalo de nuevo.");
      return false;
    }
  };

  const stop = async () => {
    const ok = await starting.current?.catch(() => false);
    starting.current = null;
    if (!ok) return;
    const ms = recorder.getStatus().durationMillis;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const uri = recorder.uri;
    if (!uri || ms < MIN_MS) {
      deleteFileQuietly(uri);
      setPhase("idle");
      setHint("Mantén presionado mientras hablas o acercas el celular al audio.");
      return;
    }
    setPhase("saving");
    try {
      const item = await saveFile(uri, { tipo: "audio", mime: "audio/mp4", source: "grabacion", durationMs: ms });
      setQueueId(item?.id ?? null);
      setPhase("saved");
    } catch {
      setPhase("idle");
      setHint("No se pudo guardar la grabación. Inténtalo de nuevo.");
    }
  };

  const onPressIn = () => {
    if (toggleMode || phase === "saving") return;
    starting.current = start();
  };
  const onPressOut = () => {
    if (toggleMode) return;
    if (starting.current) void stop();
  };
  const onPress = () => {
    if (!toggleMode) return;
    if (phase === "recording") void stop();
    else {
      starting.current = start();
    }
  };

  const recording = phase === "recording";

  return (
    <PrivateScreen title="Grabar" testID="grabar">
      <T variant="secondary">
        {toggleMode
          ? "Toca dos veces para empezar a grabar y otra vez para terminar."
          : "Mantén presionado el botón mientras grabas. Al soltar, se guarda cifrado y se sube."}
      </T>

      <View style={s.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {levels.map((l, i) => (
          <View key={i} style={[s.bar, { height: 6 + l * 70, opacity: recording ? 1 : 0.35 }]} />
        ))}
      </View>

      <T variant="amount" style={{ textAlign: "center" }} accessibilityLabel={`Tiempo ${duration(state.durationMillis)}`} testID="tiempo">
        {duration(recording ? state.durationMillis : phase === "idle" ? 0 : state.durationMillis)}
      </T>

      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          onPress={onPress}
          disabled={phase === "saving" || phase === "denied"}
          accessibilityRole="button"
          accessibilityLabel={recording ? "Terminar grabación" : "Grabar"}
          accessibilityHint={toggleMode ? undefined : "Mantén presionado para grabar"}
          accessibilityState={{ busy: phase === "saving" }}
          testID="boton-grabar"
          style={[s.mic, recording && s.micOn]}
        >
          <Icon name="mic" size={56} color={recording ? colors.blanco : colors.tinta} strokeWidth={2} />
        </Pressable>
        <T variant="bodyBold" style={{ marginTop: 10 }}>
          {recording ? "Suelta para guardar" : phase === "saving" ? "Guardando…" : "Mantén presionado"}
        </T>
      </View>

      {hint ? <T variant="secondary">{hint}</T> : null}

      {phase === "denied" ? (
        <View style={{ gap: 10 }}>
          <T variant="body">Para grabar, permite el uso del micrófono en los ajustes del celular.</T>
          <Button label="Abrir ajustes" kind="secondary" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}

      {phase === "saved" ? <UploadStatus queueId={queueId} decoy={decoy} /> : null}
    </PrivateScreen>
  );
}

const s = StyleSheet.create({
  wave: { height: 84, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 2 },
  bar: { flex: 1, borderRadius: 3, backgroundColor: colors.tinta },
  mic: {
    width: 168,
    height: 168,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: colors.tinta,
    backgroundColor: colors.papel,
    alignItems: "center",
    justifyContent: "center",
  },
  micOn: { backgroundColor: colors.tinta },
  label: { fontFamily: fonts.textoBold },
});
