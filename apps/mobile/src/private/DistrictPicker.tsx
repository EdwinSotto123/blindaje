import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { Icon } from "@/components/Icon";
import { styles as ui, T } from "@/components/ui";
import { type District, DISTRICTS, districtById, districtOfZone, ZONE_AREAS, type ZoneArea } from "@/shared";
import { colors, fonts, layout, MAX_FONT_SCALE, radius } from "@/theme/tokens";

/** Sin tildes, en minúsculas y sin signos: "Rímac", "rimac" y "RIMAC" se encuentran igual. */
export function plano(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Distritos que coinciden con lo escrito: por nombre, por nombre corto (SJL, SMP, VES) o por el
 * nombre con que se conoce (Surco, Chosica, Cercado de Lima). Vacío: los 50.
 */
export function buscarDistritos(q: string): District[] {
  const t = plano(q);
  if (!t) return [...DISTRICTS];
  const conocido = districtOfZone(q);
  return DISTRICTS.filter((d) => d === conocido || plano(d.name).includes(t) || plano(d.short).includes(t));
}

/** Agrupa por área (Lima Norte, Lima Este, Lima Centro, Lima Sur y Callao) y ordena por nombre. */
export function porArea(list: readonly District[]): { area: ZoneArea; distritos: District[] }[] {
  return ZONE_AREAS.map((area) => ({
    area,
    distritos: list.filter((d) => d.area === area).sort((a, b) => a.name.localeCompare(b.name, "es")),
  })).filter((g) => g.distritos.length > 0);
}

function Opcion({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={({ pressed }) => [s.opcion, on && s.opcionOn, pressed && { backgroundColor: colors.cuadriculaSuave }]}
    >
      <T variant={on ? "bodyBold" : "body"} style={{ flex: 1 }}>
        {label}
      </T>
      {on ? <Icon name="check" /> : null}
    </Pressable>
  );
}

type Props = {
  /** Id del distrito elegido o null. */
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  hint?: string;
  testID?: string;
};

/**
 * Elegir el distrito de una lista fija (los 50 de Lima Metropolitana y el Callao), con búsqueda y
 * agrupada por área. Funciona sin internet: la lista viene en la app. "Prefiero no decirlo" deja la
 * zona vacía. Nunca pide una dirección. Se abre dentro de la pantalla (no en un Modal, que en Android
 * es otra ventana y podría quedar fuera de la prevención de capturas).
 */
export function DistrictPicker({ value, onChange, label, hint, testID = "distrito" }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [declined, setDeclined] = useState(false);
  const elegido = districtById(value);
  const grupos = useMemo(() => porArea(buscarDistritos(q)), [q]);
  const total = grupos.reduce((n, g) => n + g.distritos.length, 0);
  const resumen = elegido ? elegido.name : declined ? "Prefiero no decirlo" : "Sin elegir";
  const buscando = q.trim().length > 0;

  const elegir = (id: string | null) => {
    setDeclined(id === null);
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <View style={{ gap: 8 }}>
      <T variant="h2">{label}</T>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${resumen}`}
        accessibilityHint={open ? "Cierra la lista de distritos" : "Abre la lista de distritos"}
        accessibilityState={{ expanded: open }}
        testID={testID}
        style={({ pressed }) => [s.resumen, pressed && { backgroundColor: colors.cuadriculaSuave }]}
      >
        <View style={{ flex: 1 }}>
          <T variant="bodyBold">{resumen}</T>
          {elegido ? <T variant="small">{elegido.area}</T> : null}
        </View>
        <T variant="bodyBold" style={{ textDecorationLine: "underline" }}>
          {open ? "Cerrar" : elegido ? "Cambiar" : "Elegir"}
        </T>
      </Pressable>
      {hint ? <T variant="small">{hint}</T> : null}

      {open ? (
        <View style={s.panel} testID={`${testID}-lista`}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Escribe tu distrito, por ejemplo Comas"
            placeholderTextColor={colors.lapiz}
            accessibilityLabel="Busca tu distrito"
            autoCorrect={false}
            autoCapitalize="none"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            returnKeyType="search"
            style={ui.input}
            testID={`${testID}-buscar`}
          />
          <T variant="small" accessibilityLiveRegion="polite">
            {!buscando
              ? "Lima Metropolitana y el Callao"
              : total === 0
                ? "No encontramos ese distrito. Revisa cómo se escribe."
                : `${total} ${total === 1 ? "distrito" : "distritos"}`}
          </T>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={label}>
              <Opcion label="Prefiero no decirlo" on={!elegido && declined} onPress={() => elegir(null)} />
              {grupos.map((g) => (
                <View key={g.area}>
                  <T variant="small" accessibilityRole="header" style={s.area}>
                    {g.area}
                  </T>
                  {g.distritos.map((d) => (
                    <Opcion key={d.id} label={d.name} on={d.id === elegido?.id} onPress={() => elegir(d.id)} />
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  resumen: {
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: colors.tinta,
    borderRadius: radius.botonChico,
    backgroundColor: colors.blanco,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  panel: {
    gap: 8,
    padding: 10,
    borderWidth: 1.5,
    borderColor: colors.borde,
    borderRadius: radius.boton,
    backgroundColor: colors.blanco,
  },
  opcion: {
    minHeight: Math.max(layout.toqueMin, 52),
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.cuadricula,
  },
  opcionOn: { backgroundColor: colors.resaltador },
  area: { fontFamily: fonts.textoBold, color: colors.tinta, paddingTop: 14, paddingBottom: 4, paddingHorizontal: 10 },
});
