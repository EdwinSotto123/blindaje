import type { ComponentRef, ReactNode, Ref } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type PressableProps,
  ScrollView,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";

import { Icon, type IconName } from "@/components/Icon";
import { colors, fonts, layout, MAX_FONT_SCALE, radius } from "@/theme/tokens";

// ---------------------------------------------------------------------------
// Papel cuadriculado con línea de margen
// ---------------------------------------------------------------------------

export function GridPaper() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="cuadricula" width={layout.grid} height={layout.grid} patternUnits="userSpaceOnUse">
            <Path d={`M ${layout.grid} 0 L 0 0 0 ${layout.grid}`} stroke={colors.cuadricula} strokeWidth={1} fill="none" />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={colors.papel} />
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#cuadricula)" />
      </Svg>
      <View style={styles.margen} />
    </View>
  );
}

/**
 * Con edge-to-edge (Android 15+) el sistema ya no achica la ventana al abrir el teclado: hay que
 * apartar el contenido a mano. En versiones anteriores lo hace adjustResize.
 */
const KEYBOARD_BEHAVIOR = Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) >= 35) ? "padding" : undefined;

type PaperProps = {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Pantalla con papel cuadriculado. El contenido respeta la línea de margen. */
export function Paper({ children, scroll = true, footer, contentStyle, testID }: PaperProps) {
  return (
    <View style={styles.root} testID={testID}>
      <GridPaper />
      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={styles.flex} behavior={KEYBOARD_BEHAVIOR}>
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, styles.content, contentStyle]}>{children}</View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

type Variant = "title" | "titleSmall" | "h2" | "body" | "bodyBold" | "small" | "secondary" | "amount" | "hand" | "handSmall" | "button";

const variantStyle: Record<Variant, object> = {
  title: { fontFamily: fonts.manoBold, fontSize: 32, lineHeight: 38, color: colors.tinta },
  titleSmall: { fontFamily: fonts.manoBold, fontSize: 26, lineHeight: 32, color: colors.tinta },
  h2: { fontFamily: fonts.textoBold, fontSize: 16, lineHeight: 22, color: colors.tinta },
  body: { fontFamily: fonts.texto, fontSize: 16, lineHeight: 24, color: colors.tinta },
  bodyBold: { fontFamily: fonts.textoBold, fontSize: 16, lineHeight: 22, color: colors.tinta },
  small: { fontFamily: fonts.texto, fontSize: 14, lineHeight: 20, color: colors.lapiz },
  secondary: { fontFamily: fonts.texto, fontSize: 15, lineHeight: 21, color: colors.lapiz },
  amount: { fontFamily: fonts.textoBold, fontSize: 42, lineHeight: 48, color: colors.tinta },
  hand: { fontFamily: fonts.mano, fontSize: 21, lineHeight: 28, color: colors.tinta },
  handSmall: { fontFamily: fonts.mano, fontSize: 18, lineHeight: 24, color: colors.tinta },
  button: { fontFamily: fonts.textoBold, fontSize: 17, lineHeight: 22, color: colors.tinta },
};

export function T({ variant = "body", style, ...rest }: TextProps & { variant?: Variant }) {
  return <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[variantStyle[variant], style]} {...rest} />;
}

/** Mensaje de error o de resultado: el lector de pantalla lo anuncia sin mover el foco. */
export function Notice({ children, testID }: { children: ReactNode; testID?: string }) {
  if (!children) return null;
  return (
    <T variant="bodyBold" accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      {children}
    </T>
  );
}

// ---------------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------------

type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
};

export function Button({ label, kind = "primary", icon, loading, disabled, style, compact, ...rest }: ButtonProps) {
  const primary = kind === "primary" || kind === "danger";
  const fg = primary ? colors.blanco : colors.tinta;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        kind === "primary" && styles.primary,
        kind === "danger" && styles.danger,
        kind === "secondary" && styles.secondary,
        kind === "ghost" && styles.ghost,
        pressed && { opacity: 0.85 },
        (disabled || loading) && { opacity: 0.55 },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={20} /> : null}
      <Text maxFontSizeMultiplier={1.4} style={[styles.buttonText, compact && styles.buttonTextCompact, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Botón grande de acción (Grabar, Foto, Pegar mensaje). */
export function ActionTile({ label, icon, onPress, testID }: { label: string; icon: IconName; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.cuadriculaSuave }]}
    >
      <Icon name={icon} size={24} />
      <Text maxFontSizeMultiplier={1.3} style={styles.tileText} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Chips y marcas
// ---------------------------------------------------------------------------

export function Chip({ label, icon, color = colors.resaltador, testID }: { label: string; icon?: IconName; color?: string; testID?: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color }]} testID={testID} accessible accessibilityLabel={label}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <Text maxFontSizeMultiplier={1.4} style={styles.chipText}>
        {label}
      </Text>
    </View>
  );
}

/** Dato detectado, resaltado como con plumón. */
export function Mark({ label, color = colors.resaltador }: { label: string; color?: string }) {
  return (
    <View style={[styles.mark, { backgroundColor: color }]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.markText}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  hand?: boolean;
  inputRef?: Ref<ComponentRef<typeof TextInput>>;
};

export function Field({ label, hint, hand, style, inputRef, ...rest }: FieldProps) {
    return (
      <View style={{ gap: 6 }}>
        <T variant="h2">{label}</T>
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={colors.lapiz}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.input, hand && styles.inputHand, rest.multiline && styles.inputMulti, style]}
          {...rest}
        />
        {hint ? <T variant="small">{hint}</T> : null}
      </View>
    );
}

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.borde }} />;
}

/** Selector de dos o tres opciones con el estilo de las pestañas Ventas / Fiados. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.key)}
            style={[styles.segment, on ? styles.segmentOn : styles.segmentOff]}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.segmentText, { color: on ? colors.blanco : colors.tinta }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function IconButton({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.cuadriculaSuave }]}
    >
      <Icon name={icon} size={24} />
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.papel },
  flex: { flex: 1 },
  margen: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: layout.margenX,
    width: 2,
    backgroundColor: colors.margen,
    opacity: 0.6,
  },
  content: {
    paddingLeft: layout.padLeft,
    paddingRight: layout.padRight,
    paddingTop: layout.padTop,
    paddingBottom: 28,
    gap: 16,
    flexGrow: 1,
  },
  footer: {
    paddingLeft: layout.padLeft,
    paddingRight: layout.padRight,
    paddingBottom: 16,
    paddingTop: 8,
    gap: 10,
  },
  button: {
    minHeight: layout.botonPrimario,
    borderRadius: radius.boton,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonCompact: { minHeight: layout.toqueMin, borderRadius: radius.botonChico, paddingHorizontal: 14 },
  primary: { backgroundColor: colors.tinta },
  danger: { backgroundColor: colors.tintaFuerte },
  secondary: { borderWidth: 2, borderColor: colors.tinta, backgroundColor: colors.papel },
  ghost: { backgroundColor: "transparent" },
  buttonText: { fontFamily: fonts.textoBold, fontSize: 18, lineHeight: 24, textAlign: "center" },
  buttonTextCompact: { fontSize: 15, lineHeight: 20 },
  tile: {
    flex: 1,
    minHeight: 72,
    borderWidth: 1.5,
    borderColor: colors.tinta,
    borderRadius: radius.boton,
    backgroundColor: colors.papel,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tileText: { fontFamily: fonts.textoBold, fontSize: 15, lineHeight: 19, color: colors.tinta, textAlign: "center" },
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.chip,
  },
  chipText: { fontFamily: fonts.textoBold, fontSize: 14, lineHeight: 18, color: colors.tinta },
  mark: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.marca },
  markText: { fontFamily: fonts.textoBold, fontSize: 14, lineHeight: 18, color: colors.tinta },
  input: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: colors.borde,
    borderRadius: radius.botonChico,
    backgroundColor: colors.blanco,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.texto,
    fontSize: 17,
    color: colors.tinta,
  },
  inputHand: { fontFamily: fonts.mano, fontSize: 21 },
  inputMulti: { minHeight: 140, textAlignVertical: "top" },
  card: {
    gap: 10,
    padding: 14,
    borderWidth: 1.5,
    borderColor: colors.borde,
    borderRadius: radius.boton,
    backgroundColor: colors.blanco,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  segmented: { flexDirection: "row", gap: 8 },
  segment: {
    flex: 1,
    minHeight: layout.toqueMin,
    borderRadius: radius.botonChico,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  segmentOn: { backgroundColor: colors.tinta },
  segmentOff: { backgroundColor: colors.papel, borderWidth: 1.5, borderColor: colors.borde },
  segmentText: { fontFamily: fonts.textoBold, fontSize: 16, lineHeight: 20 },
  iconButton: {
    width: layout.toqueMin,
    height: layout.toqueMin,
    borderRadius: radius.botonChico,
    alignItems: "center",
    justifyContent: "center",
  },
});
