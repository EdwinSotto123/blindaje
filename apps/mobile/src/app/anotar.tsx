import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Button, Field, IconButton, Notice, Paper, T } from "@/components/ui";
import { disguiseCopy as c } from "@/disguise/copy";
import { getDisguiseRepo } from "@/disguise/provider";
import { useSecretEntry } from "@/disguise/useSecretEntry";
import { parseSoles } from "@/lib/format";

/** Anotar venta o fiado: formularios simples y reales. */
export default function Anotar() {
  const router = useRouter();
  const { tipo } = useLocalSearchParams<{ tipo?: string }>();
  const fiado = tipo === "fiado";
  const { checkAmount } = useSecretEntry();
  const [desc, setDesc] = useState("");
  const [nombre, setNombre] = useState("");
  const [monto, setMonto] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Desde el widget de la pantalla de inicio se llega aquí sin nada detrás: volver lleva al cuaderno.
  const volver = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const guardar = async () => {
    const cents = parseSoles(monto);
    // Entrada secreta: una venta con el monto secreto no se guarda; abre la calculadora de vuelto.
    if (!fiado && checkAmount(cents, true)) return;
    if (cents === null || cents <= 0) return setError(c.anotar.errorMonto);
    if (fiado && !nombre.trim()) return setError(c.anotar.errorNombre);
    if (!fiado && !desc.trim()) return setError(c.anotar.errorTexto);
    const repo = getDisguiseRepo();
    if (fiado) await repo.addFiado(nombre.trim(), desc.trim(), cents);
    else await repo.addVenta(desc.trim(), cents);
    volver();
  };

  return (
    <Paper footer={<Button label={c.anotar.guardar} onPress={guardar} testID="guardar" />}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -12 }}>
        <IconButton icon="back" label={c.anotar.volver} onPress={volver} />
        <T variant="titleSmall">{fiado ? c.anotar.tituloFiado : c.anotar.tituloVenta}</T>
      </View>
      {fiado ? (
        <Field label={c.anotar.quien} placeholder={c.anotar.quienPlaceholder} value={nombre} onChangeText={setNombre} hand autoFocus testID="nombre" />
      ) : null}
      <Field
        label={fiado ? c.anotar.queFiado : c.anotar.que}
        placeholder={c.anotar.quePlaceholder}
        value={desc}
        onChangeText={setDesc}
        hand
        autoFocus={!fiado}
        testID="descripcion"
      />
      <Field
        label={c.anotar.monto}
        placeholder={c.anotar.montoPlaceholder}
        hint={c.anotar.montoHint}
        keyboardType="decimal-pad"
        value={monto}
        onChangeText={(t) => {
          setMonto(t);
          setError(null);
        }}
        testID="monto"
        onSubmitEditing={guardar}
      />
      <Notice>{error}</Notice>
    </Paper>
  );
}
