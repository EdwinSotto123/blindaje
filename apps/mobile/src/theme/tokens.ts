/**
 * Sistema visual Cuaderno (PROMPT 6.5 y design/cuaderno/*.dc.html).
 * Contraste verificado en test/contrast.test.ts (mínimo 4.5:1 para texto).
 */
export const colors = {
  papel: "#FBFCFE",
  cuadricula: "#E3EBF5",
  cuadriculaSuave: "#DCE6F2",
  borde: "#C9D6E6",
  tinta: "#1E3A70",
  tintaFuerte: "#122650",
  lapiz: "#4A5B7A",
  /** Línea de margen: siempre con opacidad 0.6, decorativa. */
  margen: "#D64545",
  resaltador: "#FFE066",
  resaltadorVerde: "#B8F2C9",
  resaltadorRosa: "#FFC7D9",
  blanco: "#FFFFFF",
} as const;

export const fonts = {
  texto: "AtkinsonHyperlegible_400Regular",
  textoBold: "AtkinsonHyperlegible_700Bold",
  mano: "Kalam_400Regular",
  manoBold: "Kalam_700Bold",
} as const;

export const radius = {
  boton: 12,
  botonChico: 10,
  marca: 8,
  chip: 999,
} as const;

export const layout = {
  /** Lado de cada cuadro del papel. */
  grid: 22,
  /** Posición de la línea de margen. */
  margenX: 40,
  padLeft: 60,
  padRight: 24,
  padTop: 20,
  /** Alto del botón primario. */
  botonPrimario: 56,
  /** Tamaño mínimo de cualquier toque. */
  toqueMin: 44,
} as const;

/** Límite de escalado de letra del sistema para que el layout no se rompa. */
export const MAX_FONT_SCALE = 1.6;

export type Resaltador = typeof colors.resaltador | typeof colors.resaltadorVerde | typeof colors.resaltadorRosa;
