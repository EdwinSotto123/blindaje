---
name: Blindaje
description: Cuaderno, modo camuflaje. Un cuaderno de ventas cuadriculado que, por dentro, protege.
colors:
  paper: "#FBFCFE"
  sheet: "#FFFFFF"
  grid-line: "#E3EBF5"
  grid-fill: "#DCE6F2"
  rule: "#C9D6E6"
  ink: "#1E3A70"
  ink-deep: "#122650"
  pencil: "#4A5B7A"
  margin-red: "#D64545"
  highlighter: "#FFE066"
  highlighter-mint: "#B8F2C9"
  highlighter-pink: "#FFC7D9"
typography:
  notebook-title:
    fontFamily: "Kalam, cursive"
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 1.05
  screen-title:
    fontFamily: "Kalam, cursive"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.1
  annotation:
    fontFamily: "Kalam, cursive"
    fontSize: "21px"
    fontWeight: 400
    lineHeight: 1.2
  figure:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 1.1
  title:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.3
  caption:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  mark: "4px"
  tag: "8px"
  control: "10px"
  block: "12px"
  icon: "16px"
  pill: "999px"
spacing:
  grid: "22px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "28px"
  margin-gutter: "60px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    typography: "{typography.label}"
    rounded: "{rounded.block}"
    height: "56px"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.sheet}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "48px"
    padding: "0 14px"
  chip-highlight:
    backgroundColor: "{colors.highlighter}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "7px 12px"
  tag-found:
    backgroundColor: "{colors.highlighter}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "6px 10px"
  tab-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    height: "44px"
  tab-unselected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
  card-sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    padding: "14px"
  action-tile:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    height: "72px"
---

<!-- Documentado con `impeccable document` (modo scan) el 28/10/2026 a partir de design/cuaderno/*.dc.html.
     Las tres pantallas de referencia son la autoridad visual. -->

# Design System: Blindaje

## Overview

**Creative North Star: "El cuaderno de la bodega"**

Todo Blindaje está escrito en un cuaderno cuadriculado de los que se venden en cualquier librería de
barrio del Perú: papel casi blanco con cuadrícula azul pálida cada 22 px, una línea de margen roja a
la izquierda, tinta azul de lapicero para todo lo importante y resaltador amarillo para lo que hay que
ver. No es una metáfora decorativa: en la app es el camuflaje literal (por fuera, un cuaderno de
ventas que funciona; por dentro, las notas privadas), y en la web es el mismo papel tratado con más
aire.

La densidad es la de una página escrita a mano con orden: una columna, renglones de 46 a 64 px con
divisor fino, títulos en letra de mano (Kalam) y todo lo que hay que leer sin esfuerzo en Atkinson
Hyperlegible. Plano, sin sombras, sin degradados: la profundidad la da el papel (una hoja blanca sobre
el cuadriculado) y el trazo de 1.5 a 2 px en tinta.

**Key Characteristics:**
- Papel cuadriculado de 22 px con línea de margen roja vertical al 60 %.
- Tinta azul como único color de acción; lápiz azul grisáceo para lo secundario.
- Resaltador (amarillo, con alternativas menta y rosado) solo detrás de datos detectados y estados,
  siempre con texto en tinta.
- Kalam para lo "escrito a mano" (anotaciones y títulos de cuaderno); Atkinson Hyperlegible para
  todo lo demás, incluidas las cifras.
- Íconos de trazo simple en tinta, 2 px, extremos redondeados. Sin emojis.

## Colors

Un azul de lapicero sobre papel frío, con un rojo de margen que nunca actúa y un resaltador que
señala.

### Primary
- **Tinta de lapicero** (#1E3A70): texto principal, botones primarios, bordes de controles, íconos.
  Contraste 10.8:1 sobre papel.
- **Tinta cargada** (#122650): hover de enlaces y del botón primario.

### Secondary
- **Resaltador amarillo** (#FFE066): chips de estado ("Guardado solo en este celular"), datos
  detectados ("Pide pago por Yape") y la marca de una cifra dentro de una frase. Alternativas
  aprobadas: **menta** (#B8F2C9) y **rosado** (#FFC7D9).

### Tertiary
- **Rojo de margen** (#D64545): solo la línea vertical del margen, al 60 % de opacidad. Decorativo;
  nunca texto, nunca botones, nunca error.

### Neutral
- **Papel** (#FBFCFE): fondo de todas las superficies.
- **Hoja** (#FFFFFF): tarjetas que se separan del cuadriculado ("Lo que encontramos") y texto sobre
  tinta.
- **Cuadrícula** (#E3EBF5): líneas de 1 px cada 22 px.
- **Cuadrícula rellena** (#DCE6F2): rellenos suaves.
- **Renglón** (#C9D6E6): divisores de lista y bordes de controles secundarios.
- **Lápiz** (#4A5B7A): texto secundario, fechas, ayudas. Contraste 6.7:1 sobre papel.

### Named Rules
**The Ink-Only Action Rule.** Todo lo que se puede tocar está en tinta (#1E3A70): relleno en el
primario, trazo de 1.5 a 2 px en el secundario. Ningún otro color marca una acción.

**The Highlighter Rule.** El resaltador va detrás de un dato, nunca como fondo de una región ni de un
botón, y el texto encima es siempre tinta.

**The Red Margin Rule.** El rojo existe solo como línea de margen. Un rojo en texto o en un botón
rompe el cuaderno y además se lee como alarma.

## Typography

**Display Font:** Kalam (con cursive)
**Body Font:** Atkinson Hyperlegible (con system-ui, sans-serif)

**Character:** la letra de mano de quien lleva el cuaderno (Kalam) contra una letra hecha para leer
con baja visión (Atkinson Hyperlegible). Lo escrito a mano cuenta; lo impreso informa.

### Hierarchy
- **Título de cuaderno** (Kalam 700, 42px, 1.05): el nombre del cuaderno en la portada.
- **Título de pantalla** (Kalam 700, 30 a 32px, 1.1): "Cuaderno", "Notas privadas".
- **Anotación** (Kalam 400, 21 a 23px, 1.2): renglones del cuaderno ("2 leches", "Pan, 10 unidades").
- **Cifra** (Atkinson 700, 42px, 1.1): totales ("S/ 128.50").
- **Título** (Atkinson 700, 26px, 1.2): titulares de bloque.
- **Cuerpo** (Atkinson 400, 16px, 1.5): texto corrido.
- **Etiqueta** (Atkinson 700, 15px): encabezados de sección ("Lo que recibiste") y botones.
- **Leyenda** (Atkinson 400, 13 a 14px): fechas y ayudas, en lápiz.

### Named Rules
**The Handwriting Budget Rule.** Kalam solo para anotaciones y títulos de cuaderno. Párrafos,
cifras, botones, formularios y avisos de seguridad van en Atkinson Hyperlegible.

## Layout

Una columna que respeta el margen: el contenido empieza a la derecha de la línea roja (línea a 40 px,
texto desde 60 px en móvil) y deja 24 a 28 px a la derecha. El ritmo vertical se apoya en la
cuadrícula de 22 px: separaciones de 4, 8, 12, 16, 18 y 28 px. Las listas son renglones de 46 px
(anotaciones) o 64 px (evidencia con ícono) con divisor de 1 px en renglón. Los grupos de botones
usan rejillas de 2 o 3 columnas iguales con 8 px de separación. La acción principal va al pie,
a todo el ancho.

## Elevation & Depth

Plano. No hay sombras. La profundidad sale del material: una hoja blanca (#FFFFFF) con borde de
1.5 px en renglón sobre el papel cuadriculado, o un trazo de tinta de 1.5 a 2 px alrededor de un
control.

### Named Rules
**The Paper Has No Shadows Rule.** Si algo necesita separarse, se pone en hoja blanca con borde; nunca
con `box-shadow`, desenfoque ni degradado.

## Shapes

Esquinas suaves de papelería: 4 px en la marca de resaltador dentro de una frase, 8 px en etiquetas de
datos, 10 px en controles y pestañas, 12 px en el botón primario, tarjetas y botones de acción, 16 px
en el ícono de la app, 999 px en chips de estado. Círculos de 40 px con trazo de 1.5 px para los
íconos de tipo de evidencia.

## Components

### Buttons
- **Shape:** esquinas de 12 px en el primario (56 px de alto), 10 px en los demás.
- **Primary:** fondo tinta, texto blanco Atkinson 700 a 17 o 18 px, ancho completo al pie de la
  pantalla, con ícono de trazo opcional a la izquierda.
- **Hover / Focus:** hover a tinta cargada; foco visible con anillo de tinta separado del borde.
- **Outline ("Salir rápido"):** fondo papel, borde de 2 px en tinta, texto tinta 700, 44 a 48 px de
  alto.

### Chips
- **Estado:** resaltador, texto tinta 14 px 700, radio 999 px, candado de trazo a la izquierda.
- **Dato detectado:** resaltador, radio 8 px, 14 px 700, en fila que se ajusta.

### Cards / Containers
- **Corner Style:** 12 px.
- **Background:** hoja blanca sobre el cuadriculado.
- **Shadow Strategy:** ninguna (ver Elevation & Depth).
- **Border:** 1.5 px en renglón.
- **Internal Padding:** 14 px.

### Tabs
- **Pestañas segmentadas** de 2 columnas, 44 px, radio 10 px: la activa en tinta con texto blanco,
  la inactiva en papel con borde de 1.5 px en renglón. Estado con `aria-pressed`.

### Lists
- **Renglón de cuaderno:** anotación en Kalam a la izquierda, monto en Atkinson 700 a la derecha,
  divisor de 1 px.
- **Renglón de evidencia:** círculo de ícono de 40 px, título 16 px 700 y detalle en lápiz, fecha a la
  derecha en leyenda.

### Action Tiles
- **Grabar, Foto, Pegar mensaje:** rejilla de 3, 72 px de alto, borde de 1.5 px en tinta, radio
  12 px, ícono de 22 px sobre la etiqueta.

## Do's and Don'ts

### Do:
- **Do** dibujar el cuadriculado con dos `linear-gradient` de 1 px en #E3EBF5 cada 22 px y la línea
  de margen de 2 px en #D64545 al 60 %.
- **Do** usar tinta (#1E3A70) para toda acción y el resaltador solo detrás de datos.
- **Do** mantener los toques en 44 px o más y el contraste en 4.5:1 o más.
- **Do** escribir en español de Perú, con tuteo, frases cortas y verbos claros.

### Don't:
- **Don't** usar sombras, degradados de color, desenfoques ni vidrio.
- **Don't** usar el rojo del margen para texto, errores ni botones.
- **Don't** poner párrafos, cifras ni avisos de seguridad en Kalam.
- **Don't** usar emojis ni íconos de relleno; solo trazo simple en tinta.
- **Don't** mostrar "extorsión", "denuncia" ni "policía" en las superficies del disfraz de la app.
