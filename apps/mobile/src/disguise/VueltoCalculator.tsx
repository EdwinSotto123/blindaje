import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { T } from "@/components/ui";
import { disguiseCopy as c } from "@/disguise/copy";
import { getDisguiseRepo } from "@/disguise/provider";
import { calculate, focus, initialVuelto, type Field, type Key, PinThrottle, pinCandidate, press, type VueltoState } from "@/disguise/vuelto";
import { parseSoles, soles } from "@/lib/format";
import type { AccessResult } from "@/security/access";
import { colors, fonts, MAX_FONT_SCALE, radius } from "@/theme/tokens";

type Props = {
  initialTotalCents?: number | null;
  /** Si es true (o devuelve true para el estado actual), "Calcular" prueba lo tecleado como PIN. */
  armed: boolean | ((s: VueltoState) => boolean);
  tryAccess: (digits: string) => Promise<AccessResult>;
  onAccess: (r: Exclude<AccessResult, null>) => void;
  onCalculated?: () => void;
};

const KEYS: Key[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  [".", "0", "back"],
];

const throttle = new PinThrottle();

function show(v: string): string {
  if (!v) return "S/ —";
  return `S/ ${v}`;
}

/**
 * Calculadora de vuelto de verdad. Es también el teclado del PIN: ver src/disguise/vuelto.ts.
 */
export function VueltoCalculator({ initialTotalCents, armed, tryAccess, onAccess, onCalculated }: Props) {
  const [st, setSt] = useState<VueltoState>(() => initialVuelto(initialTotalCents));
  const [busy, setBusy] = useState(false);
  const stRef = useRef(st);
  stRef.current = st;

  const tap = (k: Key) => setSt((s) => press(s, k));
  const pick = (f: Field) => setSt((s) => focus(s, f));

  const onCalcular = async () => {
    if (busy) return;
    const s = stRef.current;
    const isArmed = typeof armed === "function" ? armed(s) : armed;
    const cand = isArmed ? pinCandidate(s) : null;
    if (cand && throttle.canTry()) {
      setBusy(true);
      let r: AccessResult = null;
      try {
        r = await tryAccess(cand);
      } finally {
        setBusy(false);
      }
      if (r) {
        throttle.success();
        setSt(initialVuelto(null));
        onAccess(r);
        return;
      }
      throttle.fail();
    }
    const next = calculate(stRef.current);
    setSt(next);
    if (next.result !== null) {
      const total = parseSoles(next.total);
      const pago = parseSoles(next.pago);
      if (total !== null && pago !== null) {
        await getDisguiseRepo().addVuelto(total, pago);
        onCalculated?.();
      }
    }
  };

  const result = st.result;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 8 }}>
        {(["total", "pago"] as Field[]).map((f) => {
          const on = st.active === f;
          return (
            <Pressable
              key={f}
              onPress={() => pick(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${f === "total" ? c.vueltos.total : c.vueltos.pago}: ${st[f] || "vacío"}`}
              accessibilityHint={c.vueltos.tocaCampo}
              testID={`campo-${f}`}
              style={[s.field, on && s.fieldOn]}
            >
              <T variant="secondary">{f === "total" ? c.vueltos.total : c.vueltos.pago}</T>
              <Text maxFontSizeMultiplier={1.3} style={s.fieldValue} numberOfLines={1} adjustsFontSizeToFit>
                {show(st[f])}
              </Text>
            </Pressable>
          );
        })}
        <View style={s.result} accessibilityLiveRegion="polite" accessible accessibilityLabel={result === null ? "" : `${result >= 0 ? c.vueltos.vuelto : c.vueltos.falta} ${soles(Math.abs(result))}`}>
          {result !== null ? (
            <>
              <T variant="h2">{result >= 0 ? c.vueltos.vuelto : c.vueltos.falta}</T>
              <View style={s.mark}>
                <Text maxFontSizeMultiplier={1.3} style={s.resultValue} testID="resultado">
                  {soles(Math.abs(result))}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        {KEYS.map((row, i) => (
          <View key={i} style={s.row}>
            {row.map((k) => (
              <Pressable
                key={k}
                onPress={() => tap(k)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={k === "back" ? c.vueltos.borrar : k === "." ? c.vueltos.punto : k}
                testID={`tecla-${k}`}
                style={({ pressed }) => [s.key, pressed && s.keyPressed]}
              >
                {k === "back" ? <Icon name="back" size={26} /> : <Text maxFontSizeMultiplier={1.2} style={s.keyText}>{k}</Text>}
              </Pressable>
            ))}
          </View>
        ))}
        <View style={s.row}>
          <Pressable
            onPress={() => tap("clear")}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={c.vueltos.limpiar}
            testID="tecla-limpiar"
            style={({ pressed }) => [s.key, s.keyAlt, pressed && s.keyPressed]}
          >
            <Text maxFontSizeMultiplier={1.2} style={s.keyLabel}>
              {c.vueltos.limpiar}
            </Text>
          </Pressable>
          <Pressable
            onPress={onCalcular}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={c.vueltos.calcular}
            testID="tecla-calcular"
            style={({ pressed }) => [s.key, s.keyPrimary, { flex: 2 }, pressed && { opacity: 0.85 }]}
          >
            <Text maxFontSizeMultiplier={1.2} style={[s.keyLabel, { color: colors.blanco }]}>
              {c.vueltos.calcular}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  field: {
    minHeight: 64,
    borderWidth: 1.5,
    borderColor: colors.borde,
    borderRadius: radius.boton,
    backgroundColor: colors.blanco,
    paddingHorizontal: 14,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  fieldOn: { borderColor: colors.tinta, borderWidth: 2.5 },
  fieldValue: { fontFamily: fonts.textoBold, fontSize: 28, color: colors.tinta, flexShrink: 1, textAlign: "right" },
  result: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  mark: { backgroundColor: colors.resaltador, borderRadius: radius.marca, paddingHorizontal: 10, paddingVertical: 2 },
  resultValue: { fontFamily: fonts.textoBold, fontSize: 26, color: colors.tinta },
  row: { flexDirection: "row", gap: 8 },
  key: {
    flex: 1,
    minHeight: 60,
    borderRadius: radius.boton,
    borderWidth: 1.5,
    borderColor: colors.borde,
    backgroundColor: colors.papel,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: colors.cuadriculaSuave },
  keyAlt: { borderColor: colors.tinta },
  keyPrimary: { backgroundColor: colors.tinta, borderColor: colors.tinta },
  keyText: { fontFamily: fonts.textoBold, fontSize: 28, color: colors.tinta },
  keyLabel: { fontFamily: fonts.textoBold, fontSize: 18, color: colors.tinta },
});
