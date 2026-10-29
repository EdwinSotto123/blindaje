import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Switch, View } from "react-native";

import type { AuthState } from "@/api/client";
import { Button, Card, Divider, Field, Notice, Segmented, T } from "@/components/ui";
import { CONSENT_CONFIRM_BODY, CONSENT_CONFIRM_TITLE, CONSENT_SHORT } from "@/private/consent";
import { errorMessage, privateStore } from "@/private/data";
import { DisguisePicker } from "@/private/DisguisePicker";
import { DistrictPicker } from "@/private/DistrictPicker";
import { PrivateScreen } from "@/private/PrivateScreen";
import { parseSoles, soles } from "@/lib/format";
import { changePins } from "@/security/access";
import { isValidPin } from "@/security/pin";
import { quickExit } from "@/security/quickExit";
import { emergencyWipe } from "@/security/wipe";
import { api, authStore, currentCaseId, forgetCase } from "@/services";
import { type ConsentMode, districtOfZone } from "@/shared";
import { updateConfig, useConfig } from "@/state/config";
import { useSessionMode } from "@/state/session";
import { colors, fonts } from "@/theme/tokens";

/** Ajustes privados: PIN, disfraz, entradas secretas, distrito, consentimiento y borrado de emergencia. */
export default function Ajustes() {
  const router = useRouter();
  const decoy = useSessionMode() === "decoy";
  const cfg = useConfig((c) => c);
  // Acepta también el texto libre de versiones anteriores, si corresponde a un distrito.
  const distrito = districtOfZone(cfg.zona);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [actual, setActual] = useState("");
  const [nuevo, setNuevo] = useState("");
  const [senuelo, setSenuelo] = useState("");
  const [monto, setMonto] = useState(cfg.secretAmountCents != null ? (cfg.secretAmountCents / 100).toFixed(2) : "");
  // Mensaje de resultado o de error (el error va sobre resaltador rosado).
  const [msg, setMsgState] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const setMsg = (text: string | null, tone: "error" | "info" = "error") => setMsgState(text ? { text, tone } : null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void authStore.get().then(setAuth);
    }, []),
  );

  const guardarPin = async () => {
    setMsg(null);
    if (!isValidPin(nuevo)) return setMsg("El PIN nuevo debe tener de 4 a 8 números.");
    if (senuelo && (!isValidPin(senuelo) || senuelo === nuevo)) return setMsg("El PIN señuelo debe tener de 4 a 8 números y ser distinto.");
    setBusy(true);
    try {
      if (decoy) {
        setMsg("PIN cambiado.", "info");
        return;
      }
      const ok = await changePins(actual, nuevo, senuelo || null);
      setMsg(ok ? "PIN cambiado." : "El PIN actual no coincide.", ok ? "info" : "error");
      if (ok) {
        setActual("");
        setNuevo("");
        setSenuelo("");
      }
    } finally {
      setBusy(false);
    }
  };

  const guardarMonto = async (enabled: boolean, text = monto) => {
    const cents = parseSoles(text);
    if (enabled && (cents === null || cents <= 0)) return setMsg("Escribe un monto, por ejemplo 18.18");
    if (!enabled && !cfg.holdTitle) return setMsg("Deja al menos una forma de entrar encendida.");
    await updateConfig({ secretAmountCents: enabled ? cents : null });
    setMsg(enabled ? `Monto secreto: ${soles(cents!)}` : "Monto secreto apagado.", "info");
  };

  const cambiarHold = async (on: boolean) => {
    if (!on && cfg.secretAmountCents === null) return setMsg("Deja al menos una forma de entrar encendida.");
    await updateConfig({ holdTitle: on });
  };

  /**
   * El distrito vale para los casos que se creen desde ahora y para los avisos de la zona. El caso
   * actual conserva el suyo: no hay ruta para cambiarlo.
   */
  const cambiarDistrito = async (id: string | null) => {
    await updateConfig({ zona: id });
    privateStore.set({ alerts: null, alertsState: "idle", recommendations: null, recommendationsState: "idle" });
    setMsg(id ? `Distrito guardado: ${districtOfZone(id)?.name ?? id}.` : "Listo. No se enviará tu distrito.", "info");
  };

  const aplicarConsentimiento = async (mode: ConsentMode) => {
    setMsg(null);
    const previo = cfg.consent;
    await updateConfig({ consent: mode });
    if (decoy) return;
    const caseId = await currentCaseId();
    if (!caseId) return;
    try {
      const c = await api.setConsent(caseId, mode);
      const r = privateStore.get().report;
      if (r) privateStore.set({ report: { ...r, consent_mode: c.consent_mode } });
    } catch (e) {
      // Si el servidor no lo registró, el interruptor vuelve a como estaba: nunca mostrar un estado falso.
      await updateConfig({ consent: previo });
      setMsg(errorMessage(e));
    }
  };

  // El modo comunitario se activa a propósito (PRODUCT.md, principio 4): se confirma, como en la denuncia.
  const cambiarConsentimiento = (mode: ConsentMode) => {
    if (mode === cfg.consent) return;
    if (mode !== "comunitario") return void aplicarConsentimiento(mode);
    Alert.alert(CONSENT_CONFIRM_TITLE, CONSENT_CONFIRM_BODY, [
      { text: "Ahora no", style: "cancel" },
      { text: "Sumar mi caso", onPress: () => void aplicarConsentimiento(mode) },
    ]);
  };

  const borrarCaso = () =>
    Alert.alert("¿Borrar tu caso de la nube?", "Se borran tus audios, fotos, mensajes y tu denuncia del servidor. No se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar mi caso",
        style: "destructive",
        onPress: async () => {
          if (decoy) return;
          try {
            const caseId = await currentCaseId();
            if (caseId) await api.deleteCase(caseId);
            await forgetCase();
            privateStore.set({ report: null });
            setMsg("Tu caso se borró de la nube.", "info");
          } catch (e) {
            setMsg(errorMessage(e));
          }
        },
      },
    ]);

  const borrarTodo = () =>
    Alert.alert(
      "¿Borrar todo de este celular?",
      "Se borran tu PIN, las llaves, lo que espera conexión y se cierra tu sesión. La app quedará como una app común. Lo que ya subiste sigue a salvo en la nube.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar todo",
          style: "destructive",
          onPress: async () => {
            await emergencyWipe();
            quickExit(router);
          },
        },
      ],
    );

  return (
    <PrivateScreen title="Ajustes" testID="ajustes">
      {auth && !decoy ? (
        <T variant="small">Tu código: {auth.pseudonym}</T>
      ) : null}

      <View style={{ gap: 10 }}>
        <T variant="h2">Cómo se ve la app</T>
        <DisguisePicker value={cfg.disguise} onChange={(d) => void updateConfig({ disguise: d })} />
      </View>

      <Divider />

      <View style={{ gap: 10 }}>
        <T variant="h2">Cómo entras aquí</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <T variant="body" style={{ flex: 1 }}>
            Mantener presionado el título 2 segundos
          </T>
          <Switch value={cfg.holdTitle} onValueChange={(v) => void cambiarHold(v)} accessibilityLabel="Mantener presionado el título" trackColor={{ false: colors.borde, true: colors.tinta }} thumbColor={colors.blanco} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <T variant="body" style={{ flex: 1 }}>
            Anotar una venta con el monto secreto
          </T>
          <Switch
            value={cfg.secretAmountCents !== null}
            onValueChange={(v) => void guardarMonto(v)}
            accessibilityLabel="Monto secreto"
            trackColor={{ false: colors.borde, true: colors.tinta }}
            thumbColor={colors.blanco}
          />
        </View>
        {cfg.secretAmountCents !== null ? (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Field label="Monto secreto" keyboardType="decimal-pad" value={monto} onChangeText={setMonto} />
            </View>
            <Button label="Guardar" compact kind="secondary" onPress={() => void guardarMonto(true)} style={{ minHeight: 52 }} />
          </View>
        ) : null}
        <T variant="small">Las dos abren la calculadora de vuelto. Ahí escribes tu PIN en “Pagó con” y tocas “Calcular”.</T>
      </View>

      {!decoy ? (
        <>
          <Divider />
          <View style={{ gap: 10 }}>
            <T variant="h2">Cambiar PIN</T>
            <Field label="PIN actual" value={actual} onChangeText={setActual} keyboardType="number-pad" secureTextEntry maxLength={8} />
            <Field label="PIN nuevo" value={nuevo} onChangeText={setNuevo} keyboardType="number-pad" secureTextEntry maxLength={8} />
            <Field
              label="PIN señuelo nuevo (opcional)"
              hint="Abre unas notas vacías. Úsalo si alguien te obliga a abrir la app."
              value={senuelo}
              onChangeText={setSenuelo}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
            />
            <Button label="Cambiar PIN" kind="secondary" onPress={guardarPin} loading={busy} />
          </View>

          <Divider />
          <DistrictPicker
            label="Tu distrito"
            hint="Se usa en tus próximos casos y para mostrarte los avisos de tu zona. Solo el distrito, nunca tu dirección."
            value={distrito?.id ?? null}
            onChange={(id) => void cambiarDistrito(id)}
            testID="ajustes-distrito"
          />

          <Divider />
          <View style={{ gap: 10 }}>
            <T variant="h2">Tu consentimiento</T>
            <Segmented<ConsentMode>
              options={[
                { key: "solo_denuncia", label: "Solo mi denuncia" },
                { key: "comunitario", label: "Comunitario" },
              ]}
              value={cfg.consent}
              onChange={cambiarConsentimiento}
              kind="choice"
              label="Tu consentimiento"
            />
            <Card>
              <T variant="small">
                <T variant="small" style={{ fontFamily: fonts.textoBold, color: colors.tinta }}>
                  Solo mi denuncia:{" "}
                </T>
                te ayudamos a ordenar tu evidencia y armar tu denuncia. Tu caso no se compara con otros.
              </T>
              <T variant="small">
                <T variant="small" style={{ fontFamily: fonts.textoBold, color: colors.tinta }}>
                  Comunitario:{" "}
                </T>
                además, {CONSENT_SHORT.charAt(0).toLowerCase() + CONSENT_SHORT.slice(1)} Puedes apagarlo cuando quieras.
              </T>
            </Card>
          </View>
        </>
      ) : null}

      <Divider />
      <View style={{ gap: 10 }}>
        <T variant="h2">Borrar</T>
        {!decoy ? <Button label="Borrar mi caso de la nube" kind="secondary" icon="trash" onPress={borrarCaso} /> : null}
        <Button label="Borrar todo de este celular" kind="danger" icon="trash" onPress={borrarTodo} testID="borrado-emergencia" />
        <T variant="small">Borra el PIN, las llaves, la base cifrada y lo que espera conexión, y cierra tu sesión. Lo que ya subiste sigue a salvo en la nube.</T>
      </View>

      <Notice tone={msg?.tone}>{msg?.text}</Notice>
    </PrivateScreen>
  );
}
