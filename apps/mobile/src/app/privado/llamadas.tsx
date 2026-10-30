import { useFocusEffect } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Alert, AppState, View } from "react-native";

import { Button, Card, Chip, Divider, Field, IconButton, Notice, Segmented, T } from "@/components/ui";
import { shortDateTime } from "@/lib/format";
import type { AccionMarcados, LlamadaAnotada, ModoLlamadas } from "@/native/cuaderno";
import { deleteFileQuietly, errorMessage } from "@/private/data";
import {
  abrirAjustesDelTelefono,
  activar,
  activarBurbuja,
  descartar,
  elegirGrabacion,
  type EstadoLlamadas,
  type Grabacion,
  guardarAjustes,
  guardarComoExtorsion,
  leerEstado,
  marcarNumero,
  mostrarNumero,
  quitarMarca,
} from "@/private/llamadas";
import { PrivateScreen } from "@/private/PrivateScreen";
import { colors } from "@/theme/tokens";

type Msg = { text: string; tone: "error" | "info" } | null;

const ACCION_AYUDA: Record<AccionMarcados, string> = {
  sonar: "Suena como siempre. Así puedes contestar y grabarla con tu celular.",
  silenciar: "Entra sin sonar y queda en tus llamadas perdidas.",
  rechazar: "Se corta sola. La verás en tus llamadas recientes.",
};

const ACCION_HECHA: Partial<Record<AccionMarcados, string>> = {
  silenciar: "Entró en silencio",
  rechazar: "Se rechazó",
};

/**
 * Llamadas (Android 10+, la persona lo enciende): revisa las llamadas de números desconocidos que
 * anotó el filtro, decide cuáles fueron extorsión y elige qué hace el filtro y si se ve la burbuja
 * durante la llamada. No graba la voz.
 */
export default function Llamadas() {
  const [estado, setEstado] = useState<EstadoLlamadas>(() => leerEstado());
  const [msg, setMsgState] = useState<Msg>(null);
  const setMsg = (text: string | null, tone: "error" | "info" = "info") => setMsgState(text ? { text, tone } : null);
  const [activando, setActivando] = useState(false);
  const [pidiendoBurbuja, setPidiendoBurbuja] = useState(false);
  const [nuevo, setNuevo] = useState("");

  const refrescar = useCallback(() => setEstado(leerEstado()), []);
  useFocusEffect(refrescar);
  // Al volver del diálogo de Android o de los ajustes del teléfono.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refrescar();
    });
    return () => sub.remove();
  }, [refrescar]);

  const encendido = estado.rol && estado.ajustes.activo;
  const { ajustes } = estado;

  const onActivar = async () => {
    setMsg(null);
    setActivando(true);
    try {
      const ok = await activar();
      setMsg(ok ? "Listo. Desde ahora anoto las llamadas de números que no tienes guardados." : "No se activó. Puedes intentarlo otra vez cuando quieras.", ok ? "info" : "error");
    } catch (e) {
      setMsg(errorMessage(e), "error");
    } finally {
      setActivando(false);
      refrescar();
    }
  };

  const onBurbuja = async () => {
    setMsg(null);
    setPidiendoBurbuja(true);
    try {
      const ok = await activarBurbuja();
      setMsg(
        ok ? "Listo. Verás el botón del cuaderno en las llamadas de números que no tienes guardados." : "No se dio el permiso, así que el botón no aparecerá.",
        ok ? "info" : "error",
      );
    } catch (e) {
      setMsg(errorMessage(e), "error");
    } finally {
      setPidiendoBurbuja(false);
      refrescar();
    }
  };

  const cambiar = (patch: { modo?: ModoLlamadas; accion?: AccionMarcados; burbuja?: boolean }) => {
    guardarAjustes(patch);
    refrescar();
  };

  const apagar = () =>
    Alert.alert(
      "¿Dejar de anotar llamadas?",
      "Las llamadas que ya anotaste siguen aquí hasta que las revises. Para que Cuaderno deje de aparecer como app de identificación de llamadas, quítalo en los ajustes del teléfono.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Apagar",
          onPress: () => {
            guardarAjustes({ activo: false });
            refrescar();
          },
        },
        {
          text: "Apagar y abrir ajustes",
          onPress: () => {
            guardarAjustes({ activo: false });
            refrescar();
            abrirAjustesDelTelefono();
          },
        },
      ],
    );

  const agregar = () => {
    const n = marcarNumero(nuevo);
    if (!n) return setMsg("Escribe el número completo, por ejemplo 987 654 321.", "error");
    setNuevo("");
    setMsg(`Marcaste el ${mostrarNumero(n)}.`);
    refrescar();
  };

  return (
    <PrivateScreen
      title="Llamadas"
      testID="llamadas"
      footer={
        estado.disponible && !encendido ? <Button label="Activar" icon="phone" onPress={onActivar} loading={activando} testID="activar-llamadas" /> : undefined
      }
    >
      {msg ? (
        <Notice tone={msg.tone} testID="llamadas-msg">
          {msg.text}
        </Notice>
      ) : null}

      {!estado.disponible ? (
        <Card>
          <T variant="h2">Tu celular no permite anotar llamadas</T>
          <T variant="secondary">Funciona desde Android 10. Igual puedes grabar tus llamadas con el teléfono de tu celular y guardarlas aquí.</T>
        </Card>
      ) : !encendido ? (
        <Card>
          <T variant="h2">Anota las llamadas de números que no conoces</T>
          <T>
            Cuando te llame un número que no tienes guardado, Cuaderno anota la hora y el número. Después tú decides cuáles fueron extorsión: solo esas se suman
            a tu denuncia.
          </T>
          {ajustes.activo && !estado.rol ? (
            <T variant="bodyBold" testID="rol-perdido">
              Cuaderno ya no es tu app de identificación de llamadas, así que dejó de anotarlas. Actívalo otra vez si quieres.
            </T>
          ) : null}
          <View style={{ gap: 8, marginTop: 4 }}>
            <T variant="bodyBold">Antes de activarlo</T>
            <Punto>No graba la voz: Android no lo permite a ninguna app. Abajo te explicamos cómo grabar con tu celular.</Punto>
            <Punto>Android te pedirá elegir a Cuaderno como app de identificación de llamadas. Ese nombre se verá en los ajustes del teléfono.</Punto>
            <Punto>Las llamadas que no marques quedan cifradas solo en este celular y se borran solas a los 30 días.</Punto>
            <Punto>Nunca silencia ni rechaza una llamada si tú no lo eliges.</Punto>
          </View>
        </Card>
      ) : (
        <>
          <Chip
            label={ajustes.modo === "marcados" ? "Anotando solo los números que marcaste" : "Anotando números desconocidos"}
            icon="phone"
            color={colors.resaltadorVerde}
            testID="chip-llamadas"
          />

          <View style={{ gap: 8 }}>
            <T variant="h2">Por revisar</T>
            {estado.llamadas.length === 0 ? (
              <T variant="secondary" testID="llamadas-vacio">
                No hay llamadas por revisar. Cuando te llame un número que no tienes guardado, aparecerá aquí.
              </T>
            ) : (
              estado.llamadas.map((l) => (
                <LlamadaItem
                  key={l.id}
                  llamada={l}
                  onGuardada={() => {
                    setMsg("Guardada en tu denuncia. El número quedó marcado.");
                    refrescar();
                  }}
                  onDescartada={() => {
                    setMsg("Listo. La borramos de este celular.");
                    refrescar();
                  }}
                  onError={(text) => setMsg(text, "error")}
                />
              ))
            )}
          </View>

          <Divider />

          {estado.burbuja.disponible ? (
            <View style={{ gap: 8 }} testID="burbuja">
              <T variant="h2">Durante la llamada</T>
              {ajustes.burbuja && estado.burbuja.permitida ? (
                <>
                  <T>
                    Cuando te llame un número que no tienes guardado, verás el botón del cuaderno sobre la llamada. Tócalo para anotarla sin colgar. También
                    te recuerda tocar Grabar en tu teléfono.
                  </T>
                  <Button label="Quitar el botón" kind="secondary" compact onPress={() => cambiar({ burbuja: false })} testID="apagar-burbuja" />
                </>
              ) : (
                <>
                  <T>
                    Muestra el botón del cuaderno sobre la llamada cuando te llama un número que no tienes guardado. Con él la anotas sin colgar, y te
                    recuerda tocar Grabar en tu teléfono para que quede la voz.
                  </T>
                  {ajustes.burbuja ? (
                    <T variant="bodyBold" testID="burbuja-sin-permiso">
                      Cuaderno ya no tiene permiso para mostrarse sobre otras apps, así que el botón no aparece.
                    </T>
                  ) : null}
                  <T variant="small">
                    Android te pedirá permitir que Cuaderno se muestre sobre otras apps; ese permiso se ve en los ajustes del teléfono. El botón no graba la
                    voz y no aparece en las llamadas que silencias o rechazas.
                  </T>
                  <Button
                    label={ajustes.burbuja ? "Dar el permiso otra vez" : "Mostrar el botón en las llamadas"}
                    kind="secondary"
                    icon="phone"
                    compact
                    onPress={onBurbuja}
                    loading={pidiendoBurbuja}
                    testID="activar-burbuja"
                  />
                </>
              )}
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            <T variant="h2">¿Qué llamadas anoto?</T>
            <Segmented<ModoLlamadas>
              kind="choice"
              label="¿Qué llamadas anoto?"
              options={[
                { key: "desconocidos", label: "Todas las desconocidas" },
                { key: "marcados", label: "Solo las marcadas" },
              ]}
              value={ajustes.modo}
              onChange={(modo) => cambiar({ modo })}
            />
          </View>

          <View style={{ gap: 8 }}>
            <T variant="h2">Si vuelve a llamar un número marcado</T>
            <Segmented<AccionMarcados>
              kind="choice"
              label="Si vuelve a llamar un número marcado"
              options={[
                { key: "sonar", label: "Que suene" },
                { key: "silenciar", label: "Silenciar" },
                { key: "rechazar", label: "Rechazar" },
              ]}
              value={ajustes.accion}
              onChange={(accion) => cambiar({ accion })}
            />
            <T variant="small">{ACCION_AYUDA[ajustes.accion]}</T>
          </View>

          <View style={{ gap: 8 }} testID="marcados">
            <T variant="h2">Números que marcaste</T>
            {ajustes.marcados.length === 0 ? (
              <T variant="secondary">Todavía ninguno. Se marcan solos cuando guardas una llamada como extorsión, o puedes escribirlos aquí.</T>
            ) : (
              ajustes.marcados.map((n) => (
                <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <T variant="bodyBold" style={{ flex: 1 }}>
                    {mostrarNumero(n)}
                  </T>
                  <IconButton
                    icon="trash"
                    label={`Quitar ${mostrarNumero(n)}`}
                    onPress={() => {
                      quitarMarca(n);
                      refrescar();
                    }}
                  />
                </View>
              ))
            )}
            <Field label="Marcar otro número" keyboardType="phone-pad" value={nuevo} onChangeText={setNuevo} placeholder="Ej.: 987 654 321" testID="nuevo-numero" />
            <Button label="Marcar este número" kind="secondary" compact onPress={agregar} disabled={!nuevo.trim()} testID="marcar-numero" />
          </View>
        </>
      )}

      <GuiaGrabar />

      {encendido ? <Button label="Dejar de anotar llamadas" kind="ghost" compact onPress={apagar} testID="apagar-llamadas" /> : null}
    </PrivateScreen>
  );
}

function LlamadaItem({
  llamada,
  onGuardada,
  onDescartada,
  onError,
}: {
  llamada: LlamadaAnotada;
  onGuardada: () => void;
  onDescartada: () => void;
  onError: (text: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [comentario, setComentario] = useState("");
  const [grabacion, setGrabacion] = useState<Grabacion | null>(null);
  const [busy, setBusy] = useState(false);
  const numero = mostrarNumero(llamada.numero);
  const hecho = ACCION_HECHA[llamada.accion];

  const elegir = async () => {
    try {
      const g = await elegirGrabacion();
      if (g) {
        deleteFileQuietly(grabacion?.uri);
        setGrabacion(g);
      }
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const cancelar = () => {
    deleteFileQuietly(grabacion?.uri);
    setGrabacion(null);
    setComentario("");
    setAbierto(false);
  };

  const guardar = async () => {
    setBusy(true);
    try {
      await guardarComoExtorsion(llamada, comentario, grabacion);
      onGuardada();
    } catch {
      setGrabacion(null);
      onError("No pudimos guardarla. Vuelve a intentarlo; si adjuntaste una grabación, elígela otra vez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ borderWidth: 2, borderColor: colors.tinta, borderRadius: 12, padding: 12, gap: 8, backgroundColor: colors.blanco }} testID={`llamada-${llamada.id}`}>
      <View style={{ gap: 2 }}>
        <T variant="bodyBold">{numero}</T>
        <T variant="small">{[shortDateTime(llamada.recibida), hecho].filter(Boolean).join(" · ")}</T>
      </View>
      {llamada.marcado ? <Chip label="Ya lo habías marcado" icon="alert" color={colors.resaltadorRosa} /> : null}
      {llamada.durante ? <Chip label="La anotaste durante la llamada" icon="clock" testID="anotada-durante" /> : null}

      {!abierto ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            label="Fue extorsión"
            accessibilityLabel={`${numero}: fue extorsión`}
            compact
            style={{ flex: 1 }}
            onPress={() => setAbierto(true)}
            testID="fue-extorsion"
          />
          <Button
            label="No era"
            accessibilityLabel={`${numero}: no era extorsión, borrar`}
            kind="secondary"
            compact
            style={{ flex: 1 }}
            onPress={() => {
              descartar(llamada.id);
              onDescartada();
            }}
            testID="no-era"
          />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Field label="¿Qué te dijeron? (opcional)" multiline value={comentario} onChangeText={setComentario} placeholder="Escribe lo que recuerdes" testID="comentario" />
          <Button
            label={grabacion ? `Grabación: ${grabacion.nombre}` : "Adjuntar la grabación"}
            kind="secondary"
            icon="mic"
            compact
            onPress={elegir}
            testID="adjuntar-grabacion"
          />
          <Button label="Guardar en mi denuncia" onPress={guardar} loading={busy} testID="guardar-llamada" />
          <Button label="Cancelar" kind="ghost" compact onPress={cancelar} disabled={busy} />
        </View>
      )}
    </View>
  );
}

/** Cómo grabar con el teléfono del celular: ninguna app puede hacerlo en Android. */
function GuiaGrabar() {
  return (
    <Card>
      <T variant="h2">Para grabar la voz</T>
      <T variant="secondary">
        Android no deja que ninguna app grabe llamadas, pero el teléfono de tu celular sí puede en muchas marcas. Los nombres cambian un poco según el modelo:
      </T>
      <View style={{ gap: 8 }}>
        <Punto>Samsung: en Teléfono, toca los tres puntos, luego Ajustes y Grabar llamadas. Activa la grabación automática de los números no guardados.</Punto>
        <Punto>Xiaomi, Redmi o POCO: en Teléfono, entra a Ajustes y Grabación de llamadas. Activa la grabación automática de números desconocidos.</Punto>
        <Punto>
          Teléfono de Google (Pixel, Motorola y otros), si te aparece la opción: en Ajustes y Grabación de llamadas, elige grabar siempre los números que no están
          en tus contactos. Este teléfono le avisa a la otra persona que la llamada se graba.
        </Punto>
        <Punto>Después, en la llamada que marques como extorsión, toca «Adjuntar la grabación». Guárdala tal como salió, sin cortarla.</Punto>
      </View>
    </Card>
  );
}

function Punto({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.tinta, marginTop: 9 }} />
      <T style={{ flex: 1 }}>{children}</T>
    </View>
  );
}
