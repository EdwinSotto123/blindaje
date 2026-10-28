import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Button, Field, IconButton, Paper, T } from "@/components/ui";
import { disguiseCopy as c } from "@/disguise/copy";
import { getDisguiseRepo } from "@/disguise/provider";
import type { Compra } from "@/disguise/repo";
import { useSecretEntry } from "@/disguise/useSecretEntry";
import { longDate, parseSoles, soles } from "@/lib/format";
import { colors, radius } from "@/theme/tokens";

/** Disfraz "Lista de compras": funciona de verdad. */
export function ListaHome() {
  const { hold, checkAmount } = useSecretEntry();
  const [items, setItems] = useState<Compra[]>([]);
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");

  const load = useCallback(async () => setItems(await getDisguiseRepo().compras()), []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const agregar = async () => {
    const cents = precio.trim() ? parseSoles(precio) : null;
    if (checkAmount(cents)) {
      setNombre("");
      setPrecio("");
      return;
    }
    if (!nombre.trim()) return;
    await getDisguiseRepo().addCompra(nombre.trim(), cents);
    setNombre("");
    setPrecio("");
    await load();
  };

  const total = items.filter((i) => !i.hecho).reduce((n, i) => n + (i.cents ?? 0), 0);

  return (
    <Paper testID="disfraz-lista">
      <Pressable onPressIn={hold.onPressIn} onPressOut={hold.onPressOut} accessibilityRole="header" accessibilityLabel={c.lista.titleHint} testID="titulo">
        <T variant="title">{c.lista.title}</T>
        <T variant="small">
          {c.lista.subtitulo} · {longDate()}
        </T>
      </Pressable>

      <View style={{ gap: 10 }}>
        <Field label={c.lista.producto} placeholder={c.lista.productoPlaceholder} value={nombre} onChangeText={setNombre} hand returnKeyType="next" />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Field label={c.lista.precio} placeholder="0.00" keyboardType="decimal-pad" value={precio} onChangeText={setPrecio} />
          </View>
          <Button label={c.lista.agregar} icon="plus" onPress={agregar} compact style={{ minHeight: 52 }} testID="agregar" />
        </View>
      </View>

      <View>
        {items.length === 0 ? (
          <T variant="secondary">{c.lista.vacio}</T>
        ) : (
          items.map((i) => (
            <View key={i.id} style={s.line}>
              <Pressable
                onPress={async () => {
                  await getDisguiseRepo().toggleCompra(i.id);
                  await load();
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!i.hecho }}
                accessibilityLabel={i.nombre}
                accessibilityHint={i.hecho ? c.lista.desmarcar : c.lista.marcar}
                style={s.check}
              >
                <View style={[s.box, i.hecho ? s.boxOn : null]}>{i.hecho ? <Icon name="check" size={18} color={colors.blanco} /> : null}</View>
                <T variant="hand" style={[{ flexShrink: 1 }, i.hecho ? s.tachado : null]}>
                  {i.nombre}
                </T>
              </Pressable>
              {i.cents != null ? <T variant="bodyBold">{soles(i.cents)}</T> : null}
              <IconButton
                icon="close"
                label={`${c.lista.quitar} ${i.nombre}`}
                onPress={async () => {
                  await getDisguiseRepo().deleteCompra(i.id);
                  await load();
                }}
              />
            </View>
          ))
        )}
      </View>

      {items.length > 0 ? (
        <View style={{ gap: 10 }}>
          <View style={s.totalRow}>
            <T variant="secondary">{c.lista.total}</T>
            <T variant="bodyBold">{soles(total)}</T>
          </View>
          {items.some((i) => i.hecho) ? (
            <Button
              label={c.lista.limpiar}
              kind="secondary"
              compact
              onPress={async () => {
                await getDisguiseRepo().limpiarCompradas();
                await load();
              }}
            />
          ) : null}
        </View>
      ) : null}
    </Paper>
  );
}

const s = StyleSheet.create({
  line: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: colors.borde },
  check: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.tinta, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.tinta },
  tachado: { textDecorationLine: "line-through", color: colors.lapiz },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderRadius: radius.boton, backgroundColor: colors.cuadriculaSuave },
});
