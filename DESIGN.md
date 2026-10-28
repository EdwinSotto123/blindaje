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
  web-display:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.1rem + 4.4vw, 4.5rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.028em"
  web-h2:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1.05rem + 2.9vw, 3.25rem)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  web-figure:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.5rem + 2.6vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  web-h3:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(1.375rem, 1.1rem + 1vw, 1.875rem)"
    fontWeight: 700
    lineHeight: 1.2
  web-lead:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(1.125rem, 1rem + 0.5vw, 1.3125rem)"
    fontWeight: 400
    lineHeight: 1.55
  web-title:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
  web-body-l:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.45
  web-body:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  web-small:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  web-caption:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  web-hand:
    fontFamily: "Kalam, cursive"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.1
  web-margin-note:
    fontFamily: "Kalam, cursive"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.15
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
  help-pill:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 11px"
  help-pill-hover:
    backgroundColor: "{colors.highlighter}"
    textColor: "{colors.ink}"
  quick-exit:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 11px"
  tag-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  field-error:
    backgroundColor: "{colors.highlighter-pink}"
    textColor: "{colors.ink}"
    typography: "{typography.web-small}"
    rounded: "{rounded.mark}"
    padding: "2px 8px"
---

<!-- Documentado con `impeccable document` (modo scan) el 28/10/2026 a partir de design/cuaderno/*.dc.html.
     Las tres pantallas de referencia son la autoridad visual de la app. La escala `web-*`, la
     maquetación web y los componentes de la franja de ayuda se documentaron desde la landing
     construida (apps/landing) el mismo día. -->

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

### Escala web
La web usa la misma pareja con más aire (tokens `web-*`, en `rem` y con `clamp()` en los titulares):
titular del hero 36 a 72 px, titulares de sección 30 a 52 px, cifras 36 a 56 px, entrada 18 a 21 px,
cuerpo 17 px, chico 15 px y leyenda 14 px. Kalam en la web: notas del margen de 26 px (19 px de
costado en pantallas angostas) y anotaciones de 24 px. Las medidas de texto corrido van en `em`
(34 a 38 em): el cero de Atkinson es ancho y los topes en `ch` daban líneas de 95 caracteres.

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

### Web
La línea de margen roja está a 34 px del borde en móvil (texto desde 50 px), a 64 px en tableta (texto
desde 96 px) y a 212 px en escritorio (texto desde 252 px, hasta 1120 px de ancho). No se mueve en
toda la página. A la izquierda de la línea va la nota del margen de cada sección: horizontal y alineada
a la derecha en escritorio, de costado (Kalam rotado) en pantallas angostas. Cada sección empieza con
una línea de 1 px en renglón dentro del área de texto; las bandas de actores (víctima, comunidad y
autoridad) empiezan con una línea de tinta de 2 px que cruza el margen desde el borde de la hoja, y
su nota del margen va en tinta 700 (las demás, en lápiz 400). Ritmo vertical de sección: 72, 96 y
110 px.

### Named Rules
**The Long Renglón Rule.** Solo las bandas de actores cruzan el margen con tinta. Si todo cruza el
margen, nada es un actor.

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

### Help Strip (web)
- Franja de tinta arriba de todo, sin fijarse al desplazar. Botones blancos de 44 px con texto en
  tinta ("Llamar al 105", "Línea 1818"); al pasar el puntero, resaltador amarillo.
- **Salir rápido:** borde blanco de 2 px sobre tinta, primero en el orden de foco, a la derecha en
  pantalla. Abre una página neutra y reemplaza la actual; atajo Esc dos veces.

### Tags
- **Etiqueta con borde:** radio 999 px, borde de 1.5 px en tinta (estado vigente), en lápiz (opcional)
  o punteado (evaluado). Las etiquetas de estado no usan resaltador: no son datos.

### Forms
- Campos de 52 px, borde de 1.5 px en lápiz, fondo hoja, radio 10 px; foco con borde de tinta y anillo.
- **Error:** borde de tinta de 2.5 px y el mensaje sobre resaltador rosado debajo del campo, en
  Atkinson 700. Nunca rojo.
- Campos opcionales plegados en un `<details>` con un signo más de dos trazos de tinta.

### Highlighter Sweep (motion)
- Cuando aparece un dato encontrado, el resaltador se dibuja de izquierda a derecha en 0.6 a 0.7 s con
  `cubic-bezier(0.25, 1, 0.5, 1)`. Con movimiento reducido, el resaltador aparece ya puesto.

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
- **Do** marcar errores de formulario con resaltador rosado detrás del mensaje y borde de tinta.
- **Do** dibujar la ausencia: datos pendientes como celdas o filas punteadas, no como huecos.

### Don't:
- **Don't** usar sombras, degradados de color, desenfoques ni vidrio.
- **Don't** usar el rojo del margen para texto, errores ni botones.
- **Don't** usar el resaltador para algo que no coincide o no es un dato (estados, etiquetas).
- **Don't** poner párrafos, cifras ni avisos de seguridad en Kalam.
- **Don't** usar emojis ni íconos de relleno; solo trazo simple en tinta.
- **Don't** mostrar "extorsión", "denuncia" ni "policía" en las superficies del disfraz de la app.
