import { File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import { Alert, Linking, Switch, View } from "react-native";

import { Button, Card, Chip, Mark, Notice, T } from "@/components/ui";
import { errorMessage, privateStore, refreshReport, usePrivate } from "@/private/data";
import { PrivateScreen } from "@/private/PrivateScreen";
import { titleFor } from "@/private/rows";
import { usePolling } from "@/private/usePolling";
import { shortDate, shortDateTime, soles } from "@/lib/format";
import { api } from "@/services";
import { LINEA_DENUNCIAS, LINEA_EMERGENCIAS } from "@/shared";
import { endExternal, expectExternal, useSessionMode } from "@/state/session";
import { colors } from "@/theme/tokens";

const CANAL: Record<string, string> = { yape: "Yape", plin: "Plin", transferencia: "Transferencia", efectivo: "Efectivo", otro: "Otro" };
const TIPO_ID: Record<string, string> = {
  telefono: "Teléfono",
  cuenta_yape: "Cuenta Yape",
  cuenta_plin: "Cuenta Plin",
  cuenta_bancaria: "Cuenta bancaria",
  placa: "Placa",
};

/** "Denuncia lista": resumen, cronología, evidencia con huella, consentimiento comunitario y PDF. */
export default function DenunciaLista() {
  const decoy = useSessionMode() === "decoy";
  const report = usePrivate((s) => s.report);
  const reportState = usePrivate((s) => s.reportState);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!decoy) void refreshReport();
    }, [decoy]),
  );
  usePolling(refreshReport, !decoy && report?.status !== "listo" ? 2500 : null);

  const listo = report?.status === "listo";
  const comunitario = report?.consent_mode === "comunitario";

  const cambiarConsentimiento = (on: boolean) => {
    if (!report) return;
    const apply = async () => {
      setConsentBusy(true);
      setMsg(null);
      try {
        const c = await api.setConsent(report.case_id, on ? "comunitario" : "solo_denuncia");
        privateStore.set({ report: { ...report, consent_mode: c.consent_mode } });
      } catch (e) {
        setMsg(errorMessage(e));
      } finally {
        setConsentBusy(false);
      }
    };
    if (!on) return void apply();
    Alert.alert(
      "¿Sumar tu caso a la red de tu gremio?",
      "Se compararán señales cifradas de tu caso con las de otros casos. Nadie ve tus audios ni tus datos personales. Puedes apagarlo cuando quieras.",
      [
        { text: "Ahora no", style: "cancel" },
        { text: "Sumar mi caso", onPress: () => void apply() },
      ],
    );
  };

  const descargar = async () => {
    if (!report) return;
    setPdfBusy(true);
    setMsg(null);
    const file = new File(Paths.cache, `denuncia-${report.code}.pdf`);
    try {
      const bytes = await api.getReportPdf(report.case_id);
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);
      expectExternal();
      await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: "Denuncia para la comisaría", UTI: "com.adobe.pdf" });
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      endExternal();
      // El PDF no se queda en el celular.
      try {
        if (file.exists) file.delete();
      } catch {
        // nada
      }
      setPdfBusy(false);
    }
  };

  const ficha = report?.ficha ?? null;

  return (
    <PrivateScreen
      title="Denuncia lista"
      testID="denuncia-lista"
      footer={
        <Button
          label={`Si estás en peligro ahora, llama al ${LINEA_EMERGENCIAS}`}
          kind="danger"
          icon="phone"
          onPress={() => void Linking.openURL(`tel:${LINEA_EMERGENCIAS}`)}
          testID="llamar-105"
        />
      }
    >
      {decoy || !report ? (
        <T variant="secondary">{reportState === "offline" || decoy ? "Sin conexión. Inténtalo cuando tengas internet." : "Cargando…"}</T>
      ) : (
        <>
          <Chip
            label={listo ? `Lista · caso ${report.code}` : "Preparando tu denuncia…"}
            icon={listo ? "check" : "clock"}
            color={listo ? colors.resaltadorVerde : colors.resaltador}
            testID="estado-denuncia"
          />

          <Card>
            <T variant="h2">Resumen</T>
            <T variant="body">{ficha?.resumen ?? "Estamos ordenando tu evidencia. Esto toma unos segundos."}</T>
            {report.hallazgos.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {report.hallazgos.map((h) => (
                  <Mark key={h} label={h} />
                ))}
              </View>
            ) : null}
            {ficha ? (
              <View style={{ gap: 4 }}>
                {ficha.monto_soles != null ? <T variant="body">Monto que piden: {soles(ficha.monto_soles * 100)}</T> : null}
                {ficha.plazo ? <T variant="body">Plazo: {ficha.plazo}</T> : null}
                {ficha.canal_pago ? <T variant="body">Medio de pago: {CANAL[ficha.canal_pago] ?? ficha.canal_pago}</T> : null}
                {ficha.grupo_que_dice_ser ? <T variant="body">Dice ser de: “{ficha.grupo_que_dice_ser}”</T> : null}
                {ficha.identificadores.map((i) => (
                  <T key={`${i.tipo}-${i.valor}`} variant="body">
                    {TIPO_ID[i.tipo] ?? i.tipo}: {i.valor}
                  </T>
                ))}
                {ficha.frases_firma.length ? <T variant="body">Frases que repiten: {ficha.frases_firma.map((f) => `“${f}”`).join(", ")}</T> : null}
              </View>
            ) : null}
          </Card>

          {report.cronologia.length ? (
            <View style={{ gap: 6 }}>
              <T variant="h2">Cronología</T>
              {report.cronologia.map((c, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                  <T variant="handSmall" style={{ width: 92 }}>
                    {shortDate(c.fecha)}
                  </T>
                  <T variant="body" style={{ flex: 1 }}>
                    {c.texto} <T variant="small">({c.evidencia.join(", ")})</T>
                  </T>
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ gap: 6 }}>
            <T variant="h2">Evidencia y huella de integridad</T>
            {report.evidencia.map((e) => (
              <View key={e.id} style={{ gap: 2, borderBottomWidth: 1, borderBottomColor: colors.borde, paddingVertical: 6 }}>
                <T variant="bodyBold">
                  {e.label} · {titleFor(e.tipo, e.duration_ms)}
                </T>
                <T variant="small">Recibido: {shortDateTime(e.received_utc)}</T>
                <T variant="small" selectable style={{ fontFamily: "monospace", fontSize: 12 }} accessibilityLabel={`Huella SHA-256 que empieza con ${e.sha256.slice(0, 8)}`}>
                  SHA-256 {e.sha256}
                </T>
              </View>
            ))}
          </View>

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <T variant="h2" style={{ flex: 1 }}>
                Sumar mi caso a la red de mi gremio
              </T>
              <Switch
                value={comunitario}
                onValueChange={cambiarConsentimiento}
                disabled={consentBusy}
                accessibilityLabel="Sumar mi caso a la red de mi gremio"
                trackColor={{ false: colors.borde, true: colors.tinta }}
                thumbColor={colors.blanco}
                testID="consentimiento"
              />
            </View>
            <T variant="small">
              {comunitario ? "Está encendido. " : "Está apagado. "}Si lo activas, comparamos señales cifradas de tu caso (la huella de la voz, los números y cuentas cifrados, la forma en que te
              contactaron) con las de otros casos. Nadie ve tus audios ni tus datos personales, y solo analistas autorizados ven los resultados. No te
              avisaremos por el celular: si hay novedades, tu gremio te buscará en persona. Puedes apagarlo cuando quieras.
            </T>
          </Card>

          <Button label="Descargar para la comisaría" icon="download" onPress={descargar} loading={pdfBusy} disabled={!listo} testID="descargar-pdf" />
          <Button label={`Llamar a la Línea ${LINEA_DENUNCIAS}`} kind="secondary" icon="phone" onPress={() => void Linking.openURL(`tel:${LINEA_DENUNCIAS}`)} />
          <Notice>{msg}</Notice>
        </>
      )}
    </PrivateScreen>
  );
}
