import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Linking, View } from "react-native";

import { ActionTile, Button, Card, Field, Mark, Notice, T } from "@/components/ui";
import { errorMessage, refreshReport, syncNow, usePrivate } from "@/private/data";
import { NoteListItem } from "@/private/NoteList";
import { PrivateScreen } from "@/private/PrivateScreen";
import { buildRows } from "@/private/rows";
import { api, currentCaseId } from "@/services";
import { LINEA_DENUNCIAS, LINEA_EMERGENCIAS } from "@/shared";
import { useSessionMode } from "@/state/session";
import { colors } from "@/theme/tokens";

const PASOS = ["Guarda lo que recibiste", "Cuéntanos qué pasó", "Revisa tu denuncia", "Decide a dónde llevarla"] as const;

const PREGUNTAS = [
  "¿Cuándo empezó y cómo te contactaron?",
  "¿Qué te pidieron, cuánto y por qué medio?",
  "¿Qué plazo te dieron?",
  "¿Pasó algo más? (visitas, fotos de tu local, disparos)",
];

/** "Preparar mi denuncia": recorrido de 4 pasos en el estilo Cuaderno. */
export default function Denuncia() {
  const router = useRouter();
  const decoy = useSessionMode() === "decoy";
  const [paso, setPaso] = useState(0);
  const [relato, setRelato] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = usePrivate((s) => s.report);
  const queueItems = usePrivate((s) => s.queue);
  const decoyItems = usePrivate((s) => s.decoy);

  useFocusEffect(
    useCallback(() => {
      if (!decoy) {
        void syncNow();
        void refreshReport();
      }
    }, [decoy]),
  );

  const rows = useMemo(() => (decoy ? [] : buildRows(report, queueItems)), [decoy, report, queueItems]);
  const pendientes = rows.filter((r) => r.state === "pendiente" || r.state === "error" || r.state === "subiendo").length;
  const total = decoy ? decoyItems.length : rows.length;

  const enviar = async () => {
    setError(null);
    setBusy(true);
    try {
      if (decoy) throw new Error("sin conexión");
      await syncNow(true);
      const caseId = await currentCaseId();
      if (!caseId) {
        setError("Primero guarda al menos un audio, una foto o un mensaje, y espera a que se suba.");
        return;
      }
      await api.submitCase(caseId, relato.trim() || undefined);
      setRelato("");
      void refreshReport();
      setPaso(3);
    } catch (e) {
      setError(decoy ? "No pudimos conectarnos. Inténtalo más tarde." : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = (() => {
    if (paso === 0)
      return <Button label="Siguiente" onPress={() => setPaso(1)} disabled={total === 0 && !decoy} testID="siguiente" />;
    if (paso === 1) return <Button label="Siguiente" onPress={() => setPaso(2)} testID="siguiente" />;
    if (paso === 2) return <Button label="Preparar mi denuncia" onPress={enviar} loading={busy} testID="enviar" />;
    return <Button label="Ver mi denuncia" onPress={() => router.replace("/privado/lista")} testID="ver-denuncia" />;
  })();

  return (
    <PrivateScreen title="Preparar mi denuncia" testID="denuncia" footer={footer}>
      <View style={{ flexDirection: "row", gap: 6 }} accessibilityLabel={`Paso ${paso + 1} de 4`}>
        {PASOS.map((p, i) => (
          <View key={p} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= paso ? colors.tinta : colors.borde }} />
        ))}
      </View>
      <View style={{ gap: 2 }}>
        <T variant="small">Paso {paso + 1} de 4</T>
        <T variant="titleSmall">{PASOS[paso]}</T>
      </View>

      {paso === 0 ? (
        <>
          <T variant="secondary">Junta aquí los audios, mensajes y fotos que recibiste. Todo se guarda cifrado y fuera de este celular.</T>
          <View>
            {rows.length === 0 && !decoy ? <T variant="secondary">Todavía no guardas nada.</T> : null}
            {decoy && decoyItems.length === 0 ? <T variant="secondary">Todavía no guardas nada.</T> : null}
            {rows.map((r) => (
              <NoteListItem key={r.key} row={r} />
            ))}
          </View>
          {pendientes > 0 ? (
            <T variant="small">{pendientes === 1 ? "1 nota espera conexión." : `${pendientes} notas esperan conexión.`} Se incluirán apenas se suban.</T>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionTile label="Grabar" icon="mic" onPress={() => router.push("/privado/grabar")} />
            <ActionTile label="Foto" icon="camera" onPress={() => router.push("/privado/foto")} />
            <ActionTile label="Pegar mensaje" icon="clipboard" onPress={() => router.push("/privado/pegar")} />
          </View>
        </>
      ) : null}

      {paso === 1 ? (
        <>
          <T variant="secondary">Con tus palabras. Si no quieres escribir ahora, puedes pasar al siguiente paso.</T>
          <Card>
            {PREGUNTAS.map((q) => (
              <T key={q} variant="handSmall">
                {q}
              </T>
            ))}
          </Card>
          <Field label="Lo que pasó" multiline value={relato} onChangeText={setRelato} placeholder="Escribe aquí" testID="relato" />
          <Button label="Volver" kind="ghost" compact onPress={() => setPaso(0)} />
        </>
      ) : null}

      {paso === 2 ? (
        <>
          <Card>
            <T variant="h2">Lo que encontramos</T>
            {report?.hallazgos.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {report.hallazgos.map((h) => (
                  <Mark key={h} label={h} />
                ))}
              </View>
            ) : (
              <T variant="secondary">Todavía no detectamos datos. Igual puedes preparar tu denuncia.</T>
            )}
          </Card>
          <View style={{ gap: 4 }}>
            <T variant="h2">Tu evidencia</T>
            {(report?.evidencia ?? []).map((e) => (
              <View key={e.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, minHeight: 32, alignItems: "center" }}>
                <T variant="bodyBold">{e.label}</T>
                <T variant="small" style={{ fontFamily: "monospace" }}>
                  {e.sha256.slice(0, 16)}…
                </T>
              </View>
            ))}
            {pendientes ? <T variant="small">Y {pendientes} por subir.</T> : null}
          </View>
          {relato.trim() ? (
            <Card>
              <T variant="h2">Lo que contaste</T>
              <T variant="body">{relato.trim()}</T>
            </Card>
          ) : null}
          <T variant="small">Al prepararla, ordenamos tu evidencia y armamos un borrador para la comisaría. Solo tú decides a dónde llevarla.</T>
          <Notice>{error}</Notice>
          <Button label="Volver" kind="ghost" compact onPress={() => setPaso(1)} />
        </>
      ) : null}

      {paso === 3 ? (
        <>
          <T variant="body">Estamos ordenando tu denuncia. En un momento la verás lista para descargar.</T>
          <Card>
            <T variant="h2">Puedes llevarla a</T>
            <T variant="body">La comisaría de tu distrito, con el PDF que te preparamos.</T>
            <T variant="body">La Línea {LINEA_DENUNCIAS}, gratuita, para denuncias.</T>
            <Button label={`Llamar a la Línea ${LINEA_DENUNCIAS}`} kind="secondary" icon="phone" compact onPress={() => void Linking.openURL(`tel:${LINEA_DENUNCIAS}`)} />
          </Card>
          <Button label={`Si estás en peligro ahora, llama al ${LINEA_EMERGENCIAS}`} kind="danger" icon="phone" onPress={() => void Linking.openURL(`tel:${LINEA_EMERGENCIAS}`)} />
        </>
      ) : null}
    </PrivateScreen>
  );
}
