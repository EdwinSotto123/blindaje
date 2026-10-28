import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { Button, IconButton, Paper, Segmented, T } from "@/components/ui";
import { disguiseCopy as c } from "@/disguise/copy";
import { getDisguiseRepo } from "@/disguise/provider";
import type { Fiado, Venta } from "@/disguise/repo";
import { useSecretEntry } from "@/disguise/useSecretEntry";
import { longDate, soles } from "@/lib/format";
import { colors } from "@/theme/tokens";

type Tab = "ventas" | "fiados";

/** Disfraz principal: cuaderno de ventas y fiados que funciona de verdad. */
export function CuadernoHome() {
  const router = useRouter();
  const { hold } = useSecretEntry();
  const [tab, setTab] = useState<Tab>("ventas");
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [fiados, setFiados] = useState<Fiado[]>([]);

  const load = useCallback(async () => {
    const repo = getDisguiseRepo();
    const [v, f] = await Promise.all([repo.ventasDelDia(), repo.fiados()]);
    setVentas(v);
    setFiados(f);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const total = ventas.reduce((n, v) => n + v.cents, 0);
  const porCobrar = fiados.filter((f) => !f.pagado).reduce((n, f) => n + f.cents, 0);

  const borrarVenta = (v: Venta) =>
    Alert.alert(c.cuaderno.borrarConfirm, `${v.descripcion} · ${soles(v.cents)}`, [
      { text: c.cuaderno.cancelar, style: "cancel" },
      {
        text: c.cuaderno.borrar,
        style: "destructive",
        onPress: async () => {
          await getDisguiseRepo().deleteVenta(v.id);
          await load();
        },
      },
    ]);

  const toggleFiado = async (f: Fiado) => {
    await getDisguiseRepo().setFiadoPagado(f.id, !f.pagado);
    await load();
  };

  return (
    <Paper
      testID="disfraz-cuaderno"
      footer={
        <Button
          label={tab === "ventas" ? c.cuaderno.anotarVenta : c.cuaderno.anotarFiado}
          icon="plus"
          testID="anotar"
          onPress={() => router.push({ pathname: "/anotar", params: { tipo: tab === "ventas" ? "venta" : "fiado" } })}
        />
      }
    >
      <View style={s.header}>
        <Pressable
          onPressIn={hold.onPressIn}
          onPressOut={hold.onPressOut}
          accessibilityRole="header"
          accessibilityLabel={c.cuaderno.titleHint}
          testID="titulo"
          style={{ flexShrink: 1 }}
        >
          <T variant="title">{c.cuaderno.title}</T>
          <T variant="small">{longDate()}</T>
        </Pressable>
        <IconButton icon="calc" label={c.cuaderno.menuVuelto} onPress={() => router.push("/calculadora")} testID="calcular-vuelto" />
      </View>

      <View style={{ gap: 4 }}>
        <T variant="secondary">{c.cuaderno.ventasHoy}</T>
        <T variant="amount" testID="total">
          {soles(total)}
        </T>
        <View style={s.fiadoLine}>
          <T variant="secondary">{c.cuaderno.fiadosPorCobrar} </T>
          <View style={s.mark}>
            <T variant="bodyBold">{soles(porCobrar)}</T>
          </View>
        </View>
      </View>

      <Segmented<Tab>
        options={[
          { key: "ventas", label: c.cuaderno.tabVentas },
          { key: "fiados", label: c.cuaderno.tabFiados },
        ]}
        value={tab}
        onChange={setTab}
      />

      <View>
        {tab === "ventas" ? (
          ventas.length === 0 ? (
            <T variant="secondary" style={{ paddingVertical: 12 }}>
              {c.cuaderno.vacioVentas}
            </T>
          ) : (
            ventas.map((v) => (
              <Pressable
                key={v.id}
                onLongPress={() => borrarVenta(v)}
                accessibilityLabel={`${v.descripcion}, ${soles(v.cents)}`}
                accessibilityHint={c.cuaderno.borrarVenta}
                style={s.line}
              >
                <T variant="hand" style={{ flexShrink: 1 }}>
                  {v.descripcion}
                </T>
                <T variant="bodyBold">{soles(v.cents)}</T>
              </Pressable>
            ))
          )
        ) : fiados.length === 0 ? (
          <T variant="secondary" style={{ paddingVertical: 12 }}>
            {c.cuaderno.vacioFiados}
          </T>
        ) : (
          fiados.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => toggleFiado(f)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!f.pagado }}
              accessibilityLabel={`${f.nombre}, ${f.descripcion}, ${soles(f.cents)}`}
              accessibilityHint={c.cuaderno.marcarPagado}
              style={s.line}
            >
              <View style={{ flexShrink: 1 }}>
                <T variant="hand" style={f.pagado ? s.tachado : undefined}>
                  {f.nombre}
                </T>
                <T variant="small">{f.pagado ? c.cuaderno.pagado : f.descripcion}</T>
              </View>
              <T variant="bodyBold" style={f.pagado ? s.tachado : undefined}>
                {soles(f.cents)}
              </T>
            </Pressable>
          ))
        )}
      </View>

    </Paper>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  fiadoLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 6 },
  mark: { backgroundColor: colors.resaltador, paddingHorizontal: 6, borderRadius: 4 },
  line: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
    paddingVertical: 4,
  },
  tachado: { textDecorationLine: "line-through", color: colors.lapiz },
});
