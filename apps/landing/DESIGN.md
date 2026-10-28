---
name: Blindaje (landing)
description: El quipu del gremio. Campo índigo, algodón para leer, tinta para actuar y nudos de color que dicen qué señal es.
colors:
  field: "#13254d"
  field-deep: "#0d1b3a"
  field-line: "rgb(255 255 255 / 0.16)"
  on-field-2: "#c3cfe6"
  cord: "#e3e9f4"
  k-voice: "#ffd84d"
  k-ident: "#7fe0a8"
  k-phrase: "#ff9ebe"
  k-image: "#9dbbf2"
  white: "#ffffff"
  mist: "#eef2f8"
  line: "#d3dce8"
  ink: "#1e3a70"
  ink-deep: "#122650"
  pencil: "#4a5b7a"
  hl: "#ffe066"
  hl-mint: "#b8f2c9"
  hl-pink: "#ffc7d9"
  hl-sky: "#dce6f2"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(2.625rem, 1.15rem + 5.4vw, 6rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.032em"
  headline:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(2.125rem, 1.25rem + 3.1vw, 3.875rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.026em"
  figure-xl:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 1.4rem + 4.4vw, 5.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum, lnum"
  figure:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.5rem + 2.4vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum, lnum"
  title-lg:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(1.375rem, 1.12rem + 0.9vw, 1.875rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
  lead:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(1.125rem, 1rem + 0.45vw, 1.375rem)"
    fontWeight: 400
    lineHeight: 1.55
  body-lg:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.25
  label:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.2
  brand:
    fontFamily: "Kalam, cursive"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1
  hand-note:
    fontFamily: "Kalam, cursive"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
  hand-entry:
    fontFamily: "Kalam, cursive"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.2
  mono-id:
    fontFamily: "ui-monospace, SFMono-Regular, Cascadia Mono, Consolas, monospace"
    fontSize: "0.875em"
    letterSpacing: "0"
rounded:
  mark: "4px"
  tag: "8px"
  control: "10px"
  block: "12px"
  sheet: "16px"
  pill: "999px"
  knot: "50%"
spacing:
  gutter: "16px"
  gutter-tablet: "32px"
  gutter-desktop: "48px"
  section: "72px"
  section-tablet: "104px"
  section-desktop: "128px"
  container: "1240px"
  head-gap: "20px"
  head-after: "clamp(40px, 5vw, 72px)"
  head-column: "64px"
  split-column: "clamp(40px, 5vw, 80px)"
  cord: "3px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.block}"
    height: "56px"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.white}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.block}"
    height: "56px"
    padding: "0 24px"
  button-ghost-hover:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink-deep}"
  button-on-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.block}"
    height: "56px"
    padding: "0 24px"
  button-on-field-hover:
    backgroundColor: "{colors.k-voice}"
    textColor: "{colors.ink-deep}"
  button-ghost-on-field:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.block}"
    height: "56px"
    padding: "0 24px"
  help-pill:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  help-pill-hover:
    backgroundColor: "{colors.k-voice}"
    textColor: "{colors.ink-deep}"
  nav-link-on-field:
    backgroundColor: "transparent"
    textColor: "{colors.on-field-2}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 12px"
  week-tab-selected:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-deep}"
    typography: "{typography.small}"
    rounded: "{rounded.tag}"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "52px"
    padding: "12px 14px"
  field-error:
    backgroundColor: "{colors.hl-pink}"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.mark}"
    padding: "2px 8px"
  mark:
    backgroundColor: "{colors.hl}"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.mark}"
    padding: "0.05em 0.35em"
  status-meets:
    backgroundColor: "{colors.hl-mint}"
    textColor: "{colors.ink-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "2px 10px 2px 6px"
  status-misses:
    backgroundColor: "{colors.hl-pink}"
    textColor: "{colors.ink-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  id-tag:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink-deep}"
    typography: "{typography.mono-id}"
    rounded: "{rounded.tag}"
    padding: "3px 8px"
  output-chip:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  form-sheet:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "32px 36px"
  alert-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.block}"
    padding: "24px 24px 28px"
  absence-notice:
    backgroundColor: "{colors.hl-pink}"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.block}"
    padding: "14px 16px"
  shot-frame:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.block}"
---

> **Alcance.** Este documento rige solo la landing pública (`apps/landing`). La app móvil, la consola
> de analistas y el portal de negocios siguen con el sistema Cuaderno del `DESIGN.md` de la raíz
> (papel cuadriculado, línea de margen roja). La landing dejó el Cuaderno el 28/10/2026 por decisión
> del dueño. Conserva del resto la tinta, los resaltadores, Atkinson Hyperlegible y los colores de
> señal de la consola.

<!-- Documentado con `impeccable document` (modo scan) el 28/10/2026 a partir de lo construido:
     src/styles/global.css (tokens), src/components/*.astro y astro.config.mjs (fuentes). -->

# Design System: Blindaje (landing)

## Overview

**Creative North Star: "El quipu del gremio"**

Cada caso es una cuerda que cuelga de la cuerda madre de la comunidad. Cada señal (número, voz,
cuenta, frase, imagen) es un nudo de un color. Cuando dos cuerdas llevan el mismo nudo, una persona
las amarra. La landing explica Blindaje con esa sola gramática: cuerdas, nudos y amarres son el
lenguaje de todos sus diagramas, desde el quipu del hero hasta la evidencia de la víctima y el flujo
de los modelos de Meta.

El material es un campo índigo profundo para los capítulos que muestran el sistema, algodón blanco y
bruma para leer, y tinta para actuar. Todo es plano: sin sombras ni tarjetas flotantes. La
profundidad sale del cambio de superficie y de reglas de 1 px. Atkinson Hyperlegible a escala
arquitectónica es la voz más fuerte de la página. Kalam aparece solo donde escribe una persona.

La densidad es la de un expediente: listas en renglones con regla, cifras grandes con su fuente,
capturas reales en marco fino. Se rechazan el celular de maqueta, la cuadrícula escolar y la fila de
tarjetas iguales.

**Key Characteristics:**
- Capítulos en índigo alternados con capítulos en algodón o bruma; dos índigos nunca se tocan.
- Nudos de color que codifican el tipo de señal igual que la consola.
- Una sola cuerda de 3 px en todo dibujo; punteado es propuesto, sólido es confirmado por una persona.
- Atkinson Hyperlegible 700 con interletra negativa para titulares y cifras; el titular llega a 6 rem.
- Kalam solo en la marca, en las notas de la persona revisora y en los renglones del cuaderno del
  disfraz.
- Íconos de trazo simple (24 × 24, 2 px, extremos redondeados). Sin emojis.

## Colors

Un índigo de noche con nudos de colores encima, y un algodón donde manda la tinta.

### Primary
- **Tinta** (`ink`): toda acción sobre claro (botón primario, contorno de 2 px del secundario, enlaces
  de fuente), texto principal, reglas de 2 px que abren listas, cuerda de la evidencia en claro.
  11.1:1 sobre algodón, 9.9:1 sobre bruma.
- **Tinta cargada** (`ink-deep`): hover del primario y texto sobre cualquier resaltador o sobre algodón
  dentro del índigo (10.2 a 11.7:1).

### Secondary
Los nudos, sobre el campo índigo.
- **Amarillo de voz** (`k-voice`): nudo largo y amarre de voz, la palabra "voz" del titular. Fuera de
  un nudo es lo que hay que mirar sobre índigo: hover de la acción, anillo de foco y los números de
  emergencia (105, 1818). 10.9:1 sobre índigo.
- **Menta de identificador** (`k-ident`): nudos de número y de cuenta, amarre de cuenta. 9.4:1.
- **Rosado de frase** (`k-phrase`): nudos de frase en el flujo de la tecnología. 7.8:1.
- **Celeste de imagen** (`k-image`): nudos de imagen en el flujo de la tecnología. 7.7:1.
- **Cuerda de algodón** (`cord`): cuerda madre, cuerdas colgantes, corchete de la red y nudos sin tipo.

### Tertiary
Los mismos tonos como resaltador sobre claro, siempre con texto en tinta cargada.
- **Resaltador** (`hl`): marca detrás de un dato clave, nudo de voz en claro, número de paso, círculo
  de ícono de atención.
- **Resaltador menta** (`hl-mint`): cumple, verificado, enviado.
- **Resaltador rosado** (`hl-pink`): no hace, falta, error; nudo de frase en claro.
- **Celeste pálido** (`hl-sky`): nudo de imagen en claro.

### Neutral
- **Campo índigo** (`field`): hero, cabecera, Inteligencia y Tecnología. Algodón encima: 15:1.
- **Índigo profundo** (`field-deep`): franja de ayuda, sección Ayuda y `theme-color` del navegador.
- **Texto secundario sobre índigo** (`on-field-2`): entradas, leyendas y rótulos sobre índigo. 9.6:1.
- **Regla sobre índigo** (`field-line`): divisores de 1 px y contornos finos sobre índigo.
- **Algodón** (`white`): fondo base, texto y acción principal sobre índigo, hoja del formulario.
- **Bruma** (`mist`): capítulos de lectura larga (Actores y Resultados), hover del contorno, etiqueta
  de id.
- **Regla** (`line`): divisores de 1 px entre renglones y marco de las capturas.
- **Lápiz** (`pencil`): texto secundario, fuentes, notas. 6.8:1 sobre algodón, 6.1:1 sobre bruma.

### Named Rules
**La regla del código de nudos.** Dentro de un nudo, el color dice el tipo de señal y nada más: voz
amarillo, identificadores menta, frases rosado, imagen celeste. Es la codificación de la consola. Sobre
índigo van los tonos `k-*` con trazo de índigo; sobre claro, los `hl-*` con trazo de tinta.

**La regla de la acción en tinta.** Sobre claro, toda acción es tinta: relleno en el primario, trazo de
2 px en el contorno. Sobre índigo, la acción es algodón y el amarillo de voz llega solo con el hover y
el foco. Ninguna acción en reposo lleva un color de nudo.

**La regla del veredicto marcado.** Fuera de un nudo, el resaltador marca un veredicto y siempre lleva
texto en tinta: menta es sí, rosado es no o falta, amarillo es lo que hay que mirar. No existe el rojo:
un error es borde de tinta más resaltador rosado.

## Typography

**Display Font:** Atkinson Hyperlegible 400 y 700 (autoalojada, `display: swap`, fallback ajustado
por métricas, luego system-ui y sans-serif)
**Body Font:** Atkinson Hyperlegible
**Label/Mono Font:** Kalam 400 y 700 para la mano; monoespaciada del sistema para ids

**Character:** una letra hecha para leer con baja visión, puesta a escala de edificio: el titular es
la voz más fuerte de la página. La mano de Kalam marca lo que escribe una persona, no lo que imprime
el sistema.

### Hierarchy
- **Display** (700, 42 a 96 px, 1, -0.032em): solo el titular del hero, en dos líneas a todo el
  ancho; la primera en texto secundario, la segunda en algodón y la palabra "voz" en amarillo de voz.
- **Headline** (700, 34 a 62 px, 1.04, -0.026em): titulares de sección, hasta 18 caracteres de ancho.
- **Figure XL** (700, 44 a 88 px, 1, -0.03em, cifras tabulares): cifras con fuente del problema y
  números de emergencia.
- **Figure** (700, 36 a 56 px, 1, -0.03em): valor de cada métrica de la evaluación.
- **Title large** (700, 22 a 30 px, 1.15, -0.012em): subtítulos de capítulo, titulares de actor y la
  cita de la alerta.
- **Title** (700, 22 px, 1.2): encabezados de bloque, etapas del flujo, títulos de aviso.
- **Lead** (400, 18 a 22 px, 1.55): entrada bajo cada titular, hasta 36 em.
- **Body large** (400, 19 px, 1.5): entrada de actor, texto de capacidad, rótulo de métrica.
- **Body** (400, 17 px, 1.6): texto corrido, hasta 38 em.
- **Small** (400, 15 px, 1.45): fuentes, pies de captura, ayudas de campo, franja de ayuda.
- **Caption** (400, 14 px, 1.25): rótulos del tablero del quipu, chips de salida y de estado.
- **Label** (700, 17 px, 1.2): botones y etiquetas de campo.
- **Marca** (Kalam 700, 30 px; 32 px en el pie): la palabra "Blindaje".
- **Nota a mano** (Kalam 700, 20 px; 15 px dentro del amarre): "propuesto", "confirmó la revisora" y
  la etapa humana del flujo.
- **Renglón del disfraz** (Kalam 400, 18 px): los productos del cuaderno de ventas.
- **Id** (monoespaciada, 0.875 em): ids de modelo y de verificación.

Los titulares usan `text-wrap: balance`; los párrafos, `pretty`. Las cifras llevan números tabulares.

### Named Rules
**La regla del titular arquitectónico.** Titulares y cifras van en Atkinson 700 con interletra
negativa (-0.012 a -0.032em) y altura de línea de 1 a 1.15. El tamaño hace la jerarquía; no hay
mayúsculas espaciadas ni rótulos sobre el titular.

**La regla de la letra a mano.** Kalam solo para la marca, las notas de la persona revisora y los
renglones del cuaderno del disfraz. Párrafos, cifras, botones, formularios y avisos de seguridad van en
Atkinson Hyperlegible.

## Layout

Un contenedor de 1240 px con margen lateral de 16, 32 y 48 px (cambia a 720 y 1200 px). Las
secciones respiran 72, 104 y 128 px arriba y abajo. A 360 px no hay desplazamiento horizontal.

Cada sección abre con una cabecera: titular y entrada separados 20 px, con 40 a 72 px de aire debajo.
Desde 900 px la cabecera se parte en dos columnas (7/5 o 6/6) separadas 64 px y alineadas abajo.

Desde 1000 px los capítulos con imagen se parten en texto angosto y figura ancha: 5/7 en hero y
actores, 4/7 en Inteligencia, 5/6 en Autenticidad, con 40 a 80 px de separación (88 px en el hero).
Las filas alternan lado (variante invertida). Por debajo, una sola columna con el texto primero; los
botones del hero van a todo el ancho por debajo de 480 px y las capturas cambian a su recorte de
celular por debajo de 720 px.

Orden de superficies construido: cabecera y hero en índigo, Problema en algodón, Actores en bruma,
Inteligencia en índigo, Autenticidad en algodón, Tecnología en índigo, Compromisos en algodón,
Resultados en bruma, Piloto en algodón, Ayuda en índigo profundo, pie en algodón.

El micro ritmo va de 4 a 28 px (10 px es el más común); los renglones de lista llevan de 14 a 36 px
de alto interno.

### Named Rules
**La regla de los capítulos índigo.** El índigo carga los capítulos que muestran el sistema; algodón y
bruma, los que se leen. Se alternan: dos capítulos índigo nunca se tocan.

## Elevation & Depth

Plano. No hay `box-shadow` en ninguna parte. La profundidad sale del cambio de superficie (índigo
contra claro), de una hoja de algodón con borde de tinta de 2 px (el formulario), de una tarjeta de
algodón sobre índigo (la alerta) y del marco de 1 px de las capturas. Dentro del quipu, rótulos y
nudos llevan un parche del color del campo que corta la cuerda de atrás: se apilan por oclusión, no por
sombra.

### Named Rules
**La regla sin sombra.** Si algo necesita separarse, cambia de superficie o recibe una regla de 1 px;
nunca sombra, desenfoque, vidrio ni degradado de color.

## Shapes

Esquinas suaves y pocas: 4 px en la marca de resaltador y el anillo de foco; 8 px en etiquetas,
rótulos del tablero y mensajes de estado; 10 px en controles (campos, píldoras, enlaces de
navegación); 12 px en botones, capturas, tarjetas y avisos; 16 px en la hoja del formulario y en los
recortes de celular; 999 px en chips; círculo en nudos, números de paso e íconos marcados.

Trazos: 1 px para reglas y marcos, 1.5 px para bordes de campo y avisos con contorno, 2 px para la
regla que abre una lista y el borde de los botones, 3 px para toda cuerda, con extremos redondeados.

Nudos: el nudo simple es un círculo; el nudo largo de la voz, una cápsula vertical con tres vueltas;
el nudo en ocho, dos círculos apilados. El trazo del nudo es de 2 px en el color del campo (sobre
índigo) o en tinta (sobre claro). El lazo con que una cuerda cuelga es un anillo de 12 a 14 px con
trazo de cuerda.

### Named Rules
**La regla de una sola cuerda.** Toda cuerda, amarre y corchete mide 3 px. El contraste lo dan el
color y el nudo, no el grosor.

**La regla del punteado.** Punteado es provisional: el amarre propuesto, la métrica pendiente, el
aviso sin reporte y el chip "Datos ficticios". Sólido es un hecho o una confirmación humana.

## Components

### Buttons
Firmes y grandes; una sola acción principal por capítulo.
- **Shape:** esquinas de 12 px, 56 px de alto, borde de 2 px, Atkinson 700 a 17 px; ícono de trazo a
  la derecha con 10 px de separación.
- **Primary (claro):** relleno tinta con texto algodón; hover a tinta cargada; al presionar baja 1 px.
- **Ghost (claro):** borde tinta sobre transparente; hover a bruma.
- **Sobre índigo:** el primario se vuelve algodón con texto en tinta cargada y hace hover a amarillo de
  voz; el contorno es algodón al 70 % y hace hover a algodón al 10 %.
- **Focus:** anillo de 3 px separado 3 px, en tinta sobre claro y en amarillo de voz sobre índigo.
- **Disabled / enviando:** relleno lápiz; mientras envía se usa `aria-disabled` para no perder el foco.
- Transiciones de 0.18 s con `cubic-bezier(0.22, 1, 0.36, 1)`.

### Chips
- **Marca de resaltador:** detrás de un dato dentro de una frase, radio 4 px, texto tinta cargada 700,
  se parte en líneas sin perder el fondo. Variantes menta y rosado.
- **Estado de métrica:** chip de 999 px; "cumple" en menta con ícono de visto, "no cumple" en rosado.
- **Pendiente:** chip de 999 px con borde punteado de 1.5 px en lápiz, sin relleno.
- **Id:** monoespaciada sobre bruma, radio 8 px, texto tinta cargada 700.
- **Salida del quipu:** chips de algodón con texto tinta cargada sobre índigo.

### Cards / Containers
- **Corner Style:** 12 px (16 px en la hoja del formulario).
- **Background:** algodón; sobre índigo, la tarjeta de alerta es algodón con texto tinta cargada.
- **Shadow Strategy:** ninguna (ver Elevation & Depth).
- **Border:** hoja del formulario con 2 px de tinta; avisos de límites con 1.5 px de tinta (en claro) o
  de algodón al 45 % (en índigo); aviso de ausencia en rosado sin borde.
- **Internal Padding:** 24 px en avisos y tarjeta de alerta; 24 × 18 px en la hoja del formulario en
  celular y 32 × 36 px desde 720 px.

### Inputs / Fields
- **Style:** 52 px de alto, borde de 1.5 px en lápiz, fondo algodón, radio 10 px, Atkinson 17 px;
  etiqueta 700 encima, ayuda en lápiz debajo.
- **Focus:** el borde pasa a tinta y aparece el anillo de 3 px.
- **Error:** borde de tinta de 2.5 px, fondo rosado casi blanco (#fff7fa) y el mensaje en resaltador
  rosado con radio 4 px, 700. Nunca rojo.
- **Select:** flecha dibujada con dos trazos de tinta. **Opcionales:** plegados en un `<details>` con un
  signo más de dos trazos de tinta.

### Navigation
- **Franja de ayuda:** índigo profundo, arriba de todo y sin fijarse. Píldoras de algodón con texto
  tinta cargada ("Llamar al 105", "Línea 1818") que hacen hover a amarillo de voz. "Salir rápido" con
  borde de algodón de 2 px: primero en el orden de foco, a la derecha en pantalla; reemplaza la página
  en el historial y responde a Esc dos veces.
- **Cabecera:** sobre índigo, 72 px (80 px desde 1100 px). Marca en Kalam a la izquierda; enlaces en
  texto secundario que pasan a algodón con fondo al 8 %; "Pedir un piloto" en algodón; cambio de idioma
  con borde de algodón al 55 %. Por debajo de 1100 px se ocultan los enlaces; por debajo de 720 px el
  idioma se acorta a "EN".

### Quipu del hero
La firma del sistema. Una cuerda madre horizontal y tres cuerdas colgantes (casos A, B y C) cruzan
filas rotuladas (número, voz, cuenta). Cada señal es un nudo con su rótulo encima; los amarres son
curvas de 3 px entre dos cuerdas con el puntaje al lado y la nota a mano de la revisora. Un corchete
de cuerda junta las tres en la red ("Red R-001") y debajo cuelgan los chips de salida. Pestañas de
semana (1 a 4) en un grupo con contorno de 1 px; la activa en algodón. Leyenda "Datos ficticios" en
chip punteado.

Movimiento: se amarra semana por semana una sola vez, en menos de 5 s, cuando entra a la vista. Las
cuerdas bajan (0.75 s), los nudos aparecen escalonados (0.45 s, 0.15 s entre uno y otro), el amarre se
dibuja de una cuerda a la otra (0.7 s) y llega punteado ("propuesto") hasta volverse sólido ("confirmó
la revisora"). Sin JavaScript o con movimiento reducido se ve la semana 4 fija, con los botones para
recorrerlo a mano.

### Cuerdas del flujo
El flujo de la tecnología es el mismo quipu: la cuerda madre corre por la izquierda en celular y por
arriba desde 1100 px; cada etapa cuelga con su lazo y sus nudos de 14 px. Las señales llevan su color
de nudo; las etapas sin tipo, nudo de cuerda; la última etapa es humana: nudos huecos con trazo
amarillo y texto en Kalam.

### Renglón de cifra
Listas con regla de 2 px arriba (tinta en claro, algodón en índigo) y divisores de 1 px. La cifra va
grande a la izquierda y el texto, la explicación y la fuente enlazada a la derecha (desde 900 px). Cada
métrica de la evaluación muestra rótulo, meta y resultado en tres columnas; lo pendiente se dice.

### Captura
Captura real de la consola o del portal en un marco de 1 px en regla, radio 12 px, sin sombra, con pie
en lápiz debajo. Por debajo de 720 px se sirve el recorte a ancho de celular. Si la captura no existe,
la figura no se muestra.

## Do's and Don'ts

### Do:
- **Do** cargar en índigo (#13254d) los capítulos que muestran el sistema y alternarlos con algodón o
  bruma.
- **Do** dibujar cada señal como un nudo sobre una cuerda de 3 px, en el color de su tipo.
- **Do** hacer llegar los amarres punteados y volverlos sólidos solo cuando una persona confirma, con
  el puntaje al lado.
- **Do** abrir cada lista con una regla de 2 px (tinta en claro, algodón en índigo) y separar los
  renglones con 1 px.
- **Do** mostrar cada métrica con su meta y lo pendiente con borde punteado; cada cifra, con su fuente.
- **Do** usar capturas reales en marco de 1 px y radio 12 px; sin captura, ilustración rotulada o nada.
- **Do** mantener los toques en 44 px o más, el contraste en 4.5:1 o más y el anillo de foco de 3 px
  (tinta en claro, amarillo de voz en índigo).
- **Do** dejar fijo el estado final con movimiento reducido.

### Don't:
- **Don't** usar sombras, desenfoques, vidrio ni degradados de color.
- **Don't** traer el Cuaderno a la landing: ni cuadrícula ni línea de margen roja.
- **Don't** cambiar la codificación de nudos: un número o una cuenta en un nudo es menta; una voz,
  amarillo.
- **Don't** usar rojo, tampoco para errores.
- **Don't** poner párrafos, cifras, botones ni avisos de seguridad en Kalam.
- **Don't** dibujar un celular de maqueta ni armar filas de tarjetas iguales.
- **Don't** poner rótulos ni mayúsculas espaciadas sobre los titulares.
- **Don't** usar emojis ni íconos de relleno; solo trazo simple de 2 px.
