import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { Button, Card, Chip, Notice, T } from "@/components/ui";
import { draftStore } from "@/onboarding/draft";
import { Step } from "@/onboarding/Step";
import { deleteFileQuietly, errorMessage } from "@/private/data";
import { duration } from "@/lib/format";
import { api } from "@/services";
import { colors } from "@/theme/tokens";

const SAMPLE_MS = 10_000;

/**
 * Muestra de voz de 10 segundos: sirve para que el sistema reconozca la voz de la persona y no
 * la confunda con la de quien la amenaza. Se sube a /v1/me/voice-sample (el servidor guarda solo
 * un vector cifrado) y la grabación se borra del celular.
 */
export default function Voz() {
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const st = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<"idle" | "rec" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      try {
        if (recorder.isRecording) void recorder.stop().then(() => deleteFileQuietly(recorder.uri));
      } catch {
        // liberado
      }
    },
    [recorder],
  );

  const terminar = async () => {
    timer.current = null;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const uri = recorder.uri;
    if (!uri) return setPhase("error");
    setPhase("sending");
    try {
      const bytes = await new File(uri).bytes();
      await api.uploadVoiceSample(bytes, "audio/mp4");
      draftStore.set({ voiceDone: true });
      setPhase("done");
    } catch (e) {
      setMsg(errorMessage(e));
      setPhase("error");
    } finally {
      deleteFileQuietly(uri);
    }
  };

  const grabar = async () => {
    setMsg(null);
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) {
      setMsg("Para grabar, permite el uso del micrófono.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase("rec");
    timer.current = setTimeout(() => void terminar(), SAMPLE_MS);
  };

  return (
    <Step
      n={5}
      title="Una muestra de tu voz"
      testID="voz"
      footer={
        phase === "done" ? (
          <Button label="Continuar" onPress={() => router.push("/bienvenida/consentimiento")} testID="continuar" />
        ) : (
          <>
            <Button label={phase === "rec" ? `Grabando… ${duration(st.durationMillis)}` : "Grabar 10 segundos"} icon="mic" onPress={grabar} disabled={phase === "rec" || phase === "sending"} loading={phase === "sending"} testID="grabar-muestra" />
            <Button label="Saltar por ahora" kind="ghost" compact onPress={() => router.push("/bienvenida/consentimiento")} testID="saltar" />
          </>
        )
      }
    >
      <T variant="body">Así el sistema reconoce tu voz y no la confunde con la de quien te amenaza, por ejemplo cuando grabas una llamada.</T>
      <Card>
        <T variant="small">Lee en voz alta:</T>
        <T variant="hand">“Hola, esta es mi voz. Hoy es un día tranquilo en la tienda. Vendo pan, leche y gaseosa a mis vecinos.”</T>
      </Card>
      {phase === "rec" ? (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.borde, overflow: "hidden" }}>
          <View style={{ width: `${Math.min(100, (st.durationMillis / SAMPLE_MS) * 100)}%`, height: 8, backgroundColor: colors.tinta }} />
        </View>
      ) : null}
      {phase === "done" ? <Chip label="Listo. La grabación se borró de este celular" icon="check" color={colors.resaltadorVerde} /> : null}
      <T variant="small">Solo se guarda una huella cifrada de tu voz, no la grabación.</T>
      <Notice>{msg}</Notice>
    </Step>
  );
}
