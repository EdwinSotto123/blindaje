---
name: Blindaje (landing)
description: El informe impreso, teñido con los tintes del quipu. Añil y algodón, tres tintes de señal (ocre, menta, celeste), cochinilla solo para la emergencia, EB Garamond y quipus reales de museo.
colors:
  paper: "#f3f2ef"
  paper-2: "#e8e6e1"
  ink: "#141a2b"
  ink-2: "#4b5470"
  field: "#17213d"
  field-2: "#24315a"
  field-deep: "#0e1529"
  on-field: "#f3f2ef"
  on-field-2: "#b8c2da"
  voz: "#e3a72f"
  voz-ink: "#8a5b00"
  num: "#6cc3a0"
  num-ink: "#1f6e50"
  cuenta: "#7fb2e5"
  cuenta-ink: "#2b5f97"
  alarm: "#c0303a"
typography:
  display: { fontFamily: "EB Garamond", fontSize: "clamp(2.375rem, 1.42rem + 3.9vw, 4.25rem)", fontWeight: 400, lineHeight: 1.05 }
  head: { fontFamily: "EB Garamond", fontSize: "clamp(1.75rem, 1.22rem + 2.1vw, 2.75rem)", fontWeight: 400, lineHeight: 1.1 }
  lead: { fontFamily: "EB Garamond", fontSize: "clamp(1.25rem, 1.12rem + 0.55vw, 1.5rem)", lineHeight: 1.4 }
  body: { fontFamily: "EB Garamond", fontSize: "clamp(1.125rem, 1.07rem + 0.25vw, 1.25rem)", lineHeight: 1.5 }
  small: { fontFamily: "EB Garamond", fontSize: "0.875rem", lineHeight: 1.45 }
  ui: { fontFamily: "Atkinson Hyperlegible", note: "solo dentro de fragmentos de interfaz (data-ui): es la letra real de la app y la consola" }
---

# Landing de Blindaje: el informe impreso, con los tintes del quipu

**Actualización del 28/10, 17:00 (skill `impeccable`).** La paleta de dos tintas (cochinilla y algodón)
se cambió por la que eligió el dueño, "Tintes del quipu". Los quipus se leían por sus nudos y por el
color de sus cuerdas, y la consola ya codifica las señales por color, así que la página hace lo mismo:

- **Añil** (`field`) para la portada, la red, la inteligencia y el pie. Es la tinta de confianza, y
  las capturas reales de la consola (blancas y azules) se leen bien encima.
- **Algodón** (`paper`, `paper-2`) para leer: problema, cómo funciona, revisión, Meta AI, límites,
  resultados y piloto.
- **Tres tintes de señal**, nunca decorativos: **voz en ocre**, **número en menta** y **cuenta en
  celeste**. Van en nudos, amarres, la palabra "voz" del titular y la selección de texto. Sobre papel
  se usa su versión `-ink`, con 5:1 o más.
- **Cochinilla solo para la emergencia:** el botón "Llamar al 105" de la franja y el disco del 105 en
  el pie.

**Movimiento**, con una pieza principal por zona y ninguna en bucle infinito fuera de la vista:

- **Portada:** el quipu del gremio en SVG (`HeroQuipu.astro`). La cuerda madre se tiende, caen trece
  cuerdas, aparecen sus nudos y los amarres A-B (misma voz) y B-C (misma cuenta) llegan punteados
  antes de que una persona los vuelva sólidos. Al mismo tiempo se subraya "voz" en el titular. Los
  casos sueltos se mecen unos 40 s y se quedan quietos; los amarrados no se mueven.
- **Red:** el quipu de cuatro semanas, ahora con nudos de color. Los casos que todavía no llegan se
  ven como cuerdas tenues, así el tablero nunca queda vacío.
- **Meta AI:** el diagrama "Del archivo a la decisión" (`Pipeline.astro`). Se traza por etapas al
  entrar a la vista y luego deja pasar pulsos por la ruta de la voz y la de los identificadores,
  solo mientras se ve. La huella de voz va punteada y salta los modelos, porque usa ECAPA, que no es
  de Meta. En el celular es una lista colgada de una cuerda.
- **Revisión:** el amarre entre los casos se cierra de punteado a sólido al confirmar (los guiones
  crecen hasta juntarse) y se corta al descartar.

Con movimiento reducido no corre nada y todo aparece en su estado final. Sin JavaScript, el diagrama
se ve completo.

Rediseño base del 28 de octubre de 2026, hecho con la skill `design-taste-frontend` (tasteskill v2): dirección
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

- **Dos campos y tres tintes.** Añil y algodón se alternan como campos completos y cada uno es la tinta
  del otro: el botón es un bloque del que no es el fondo. Los tintes de señal (ocre, menta, celeste)
  solo marcan señales, y la cochinilla solo la emergencia. Ningún tinte se usa como adorno.
- **Cinco tamaños.** small, body, lead, head y display. El titular principal no pasa de 68 px y todo
  titular cabe en dos líneas a 1440, 768 y 390 px. Las cifras usan el tamaño display, no uno extra.
- **Un eje.** A 5/12 del ancho en escritorio: títulos y columnas a la derecha, notas, fotos y figuras a la
  izquierda. En el celular el eje se pliega al margen de 20 px.
- **Sin adornos.** Sin etiquetas sobre los títulos, sin monoespaciada, sin numeración 01/02, sin líneas
  finas (salvo en tablas reales, formularios y fragmentos `data-ui`), sin degradados (salvo el velo neutro
  bajo el pie de una foto), sin sombras en reposo, sin tarjetas con ícono.
- **Esquinas rectas** en botones y fotos. Los fragmentos `data-ui` conservan los bordes y radios de la app.
- **Movimiento.** Además de lo descrito arriba: fundido lento entre los quipus de la banda de fotos
  (con zoom muy leve) y una entrada por sección ligada al scroll (`animation-timeline: view()`), que no
  oculta nada antes de que entre a la pantalla. Con movimiento reducido no corre nada.

## Secciones, en orden

| Sección | Composición |
| --- | --- |
| Portada (añil) | Título, acción y nota a la izquierda; el quipu del gremio animado a la derecha. Debajo, la banda de fotos sin separación (quipu con fundido, mototaxis en Piura, la cifra en algodón, Mercado Central) |
| Problema | Columna de cifras alineadas como en un libro contable, cada una con su fuente |
| Red (campo añil) | Titular, idea y lámina de nudos de 1912 a la izquierda; el quipu interactivo a la derecha |
| Cómo funciona | Una columna de lectura con entradas en negrita ("Por fuera,", "Por dentro,"…) y sus pruebas dibujadas |
| Revisión | Una fila en tres estados (propuesto, en revisión, confirmado); la del medio funciona |
| Inteligencia (campo añil) | Filas con nota al margen (agente y modelo de Meta) y capturas reales a anchos distintos |
| Meta AI | Titular a todo el ancho; diagrama del pipeline a todo el ancho; tablas de modelos y agentes empujadas a la derecha; quipu colgado a la izquierda |
| Límites | Lista tipográfica en columnas desiguales |
| Resultados | Tablas reales leídas de `eval/report.json` y `eval/results/watermark.json` |
| Piloto | Frase, pasos y foto a la izquierda; el formulario a la derecha |
| Pie (campo añil) | "Llama al 105" como línea grande con su disco de emergencia en cochinilla, Línea 1818, enlaces y créditos de las fotos |

## Fotos

Todas de Wikimedia Commons, descargadas con `assets.mjs` y acreditadas en el pie (lista en
`src/lib/photos.ts`; detalle en `src/assets/photos/credits.json`). Ninguna muestra a una víctima ni a un
usuario: son quipus de museo (MAS de Amberes y Museo de Arte de Cleveland, CC0), una lámina de L. L. Locke
de 1912 (dominio público) y calles del Perú con mototaxis y el Mercado Central de Lima (CC BY y CC BY-SA). Las
fotos CC BY-SA se usan sin alterar. Las capturas de la consola y del portal son reales, en modo simulado.

## Medido

- Inspector de `design-taste-frontend` (Chrome a 1440, 768 y 390 px): 0 FAIL en español e inglés. Queda un
  WARN defendido: no hay video, porque no existe un clip abierto y honesto del tema (la búsqueda trajo
  tuk-tuks de Bangkok, una marcha y un atentado). El papel se dejó en un algodón casi neutro (#f3f2ef) para
  no caer en el crema amarillo.
- Lighthouse (móvil, vista previa local, 28/10 17:30): rendimiento 99, accesibilidad 100, buenas prácticas
  100, SEO 100. LCP 1.8 s y CLS 0: el titular y el quipu son texto y SVG en línea, y las fotos quedan debajo.
