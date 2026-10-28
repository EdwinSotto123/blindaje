---
name: Blindaje (landing)
description: El informe anual impreso. Dos tintas (algodón crudo y rojo cochinilla), un eje a 5/12 del ancho, EB Garamond y quipus reales de museo.
colors:
  paper: "#f1f0ee"
  paper-2: "#e4e2de"
  ink: "#1f1416"
  ink-2: "#5a4b4d"
  field: "#7a1f2b"
  field-2: "#691925"
  on-field: "#f1f0ee"
  on-field-2: "#e6cfcf"
typography:
  display: { fontFamily: "EB Garamond", fontSize: "clamp(2.375rem, 1.42rem + 3.9vw, 4.25rem)", fontWeight: 400, lineHeight: 1.05 }
  head: { fontFamily: "EB Garamond", fontSize: "clamp(1.75rem, 1.22rem + 2.1vw, 2.75rem)", fontWeight: 400, lineHeight: 1.1 }
  lead: { fontFamily: "EB Garamond", fontSize: "clamp(1.25rem, 1.12rem + 0.55vw, 1.5rem)", lineHeight: 1.4 }
  body: { fontFamily: "EB Garamond", fontSize: "clamp(1.125rem, 1.07rem + 0.25vw, 1.25rem)", lineHeight: 1.5 }
  small: { fontFamily: "EB Garamond", fontSize: "0.875rem", lineHeight: 1.45 }
  ui: { fontFamily: "Atkinson Hyperlegible", note: "solo dentro de fragmentos de interfaz (data-ui): es la letra real de la app y la consola" }
---

# Landing de Blindaje: el informe impreso

Rediseño del 28 de octubre de 2026, hecho con la skill `design-taste-frontend` (tasteskill v2): dirección
**editorial-report** ("el informe anual impreso"), semilla 941750908. La versión anterior ("el quipu del
gremio", campo índigo) tenía titulares de hasta 96 px que se partían en 3 y 4 líneas, 16 tamaños de letra,
68 líneas finas y ninguna foto real.

## La idea

> En esta página, **el quipu, el registro andino de cuerdas con nudos**, se vuelve **la estructura del
> informe**: cada caso es una cuerda y cada señal, un nudo.

Lo que produce Blindaje es un expediente donde cada afirmación cita su evidencia. La página se arma igual:
un titular con autoridad, una columna de lectura colgada de un eje y, al margen, la fuente, la nota o la
foto. El quipu aparece en la portada (tres quipus de museo que se funden), en la página de color con el caso
de cuatro semanas y junto a la tabla de modelos ("datos anudados, cinco siglos antes de los modelos").

**Lo que se puede hacer en la página:** recorrer las cuatro semanas del quipu (A, B y C se amarran por voz y
por cuenta) y confirmar o descartar el vínculo de la copia del medio en "Una persona confirma cada vínculo".

## Reglas

- **Dos tintas.** Papel de algodón crudo y rojo cochinilla (el tinte andino de los textiles y quipus). Se
  alternan como campos completos y cada una es la tinta de la otra. No hay tercer color: el botón es un
  bloque de la tinta que no es el fondo. La paleta sorteada (rosa y berenjena) se cambió por la del tema,
  manteniendo sus proporciones; la segunda (colores caramelo) chocaba con el tema.
- **Cinco tamaños.** small, body, lead, head y display. El titular principal no pasa de 68 px y todo
  titular cabe en dos líneas a 1440, 768 y 390 px. Las cifras usan el tamaño display, no uno extra.
- **Un eje.** A 5/12 del ancho en escritorio: títulos y columnas a la derecha, notas, fotos y figuras a la
  izquierda. En el celular el eje se pliega al margen de 20 px.
- **Sin adornos.** Sin etiquetas sobre los títulos, sin monoespaciada, sin numeración 01/02, sin líneas
  finas (salvo en tablas reales, formularios y fragmentos `data-ui`), sin degradados (salvo el velo neutro
  bajo el pie de una foto), sin sombras en reposo, sin tarjetas con ícono.
- **Esquinas rectas** en botones y fotos. Los fragmentos `data-ui` conservan los bordes y radios de la app.
- **Movimiento.** Fundido lento entre quipus en la portada (con zoom muy leve) y una entrada por sección
  ligada al scroll (`animation-timeline: view()`), que no oculta nada antes de que entre a la pantalla. Con
  movimiento reducido no corre nada.

## Secciones, en orden

| Sección | Composición |
| --- | --- |
| Portada | Banda de fotos sin separación (quipu con fundido, mototaxis en Piura, la cifra en cochinilla, Mercado Central) y el título colgado del eje |
| Problema | Columna de cifras alineadas como en un libro contable, cada una con su fuente |
| Red (campo cochinilla) | Titular, idea y lámina de nudos de 1912 a la izquierda; el quipu interactivo a la derecha |
| Cómo funciona | Una columna de lectura con entradas en negrita ("Por fuera,", "Por dentro,"…) y sus pruebas dibujadas |
| Revisión | Una fila en tres estados (propuesto, en revisión, confirmado); la del medio funciona |
| Inteligencia (campo cochinilla) | Filas con nota al margen (agente y modelo de Meta) y capturas reales a anchos distintos |
| Meta AI | Titular a todo el ancho; tablas de modelos y agentes empujadas a la derecha; quipu colgado a la izquierda |
| Límites | Lista tipográfica en columnas desiguales |
| Resultados | Tablas reales leídas de `eval/report.json` y `eval/results/watermark.json` |
| Piloto | Frase, pasos y foto a la izquierda; el formulario a la derecha |
| Pie (campo cochinilla) | "Llama al 105" como línea grande, Línea 1818, enlaces y créditos de las fotos |

## Fotos

Todas de Wikimedia Commons, descargadas con `assets.mjs` y acreditadas en el pie (lista en
`src/lib/photos.ts`; detalle en `src/assets/photos/credits.json`). Ninguna muestra a una víctima ni a un
usuario: son quipus de museo (MAS de Amberes y Museo de Arte de Cleveland, CC0), una lámina de L. L. Locke
de 1912 (dominio público) y calles del Perú con mototaxis y el Mercado Central de Lima (CC BY y CC BY-SA). Las
fotos CC BY-SA se usan sin alterar. Las capturas de la consola y del portal son reales, en modo simulado.

## Medido

- Inspector de la skill (Chrome a 1440, 768 y 390 px): 0 FAIL en español e inglés. Queda un WARN
  defendido: no hay video, porque no existe un clip abierto y honesto del tema (la búsqueda trajo tuk-tuks de
  Bangkok, una marcha y un atentado).
- Lighthouse (móvil, vista previa local): rendimiento 98, accesibilidad 100, buenas prácticas 100, SEO 100.
  LCP 2.3 s: las capas 2 y 3 del fundido se agregan después de la carga.
