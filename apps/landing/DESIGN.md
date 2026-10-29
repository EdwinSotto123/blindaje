---
name: Blindaje (landing)
description: Una landing de producto que habla el idioma del producto. Añil y papel frío, el resaltador amarillo de la consola para la acción, menta y celeste en las señales, rojo solo para el 105; Atkinson Hyperlegible y el logo a mano en Kalam; capturas reales de la consola y del portal.
colors:
  paper: "#f7f8fb"
  paper-2: "#edf1f7"
  card: "#ffffff"
  ink: "#141a2b"
  ink-2: "#4b5470"
  field: "#17213d"
  field-2: "#24315a"
  field-deep: "#0e1529"
  on-field: "#f5f7fb"
  on-field-2: "#b8c2da"
  mark: "#ffd84d"
  pen: "#1e3a70"
  voz-ink: "#8a5b00"
  num: "#6cc3a0"
  num-ink: "#1f6e50"
  cuenta: "#7fb2e5"
  cuenta-ink: "#2b5f97"
  alarm: "#c0303a"
typography:
  display: { fontFamily: "Atkinson Hyperlegible", fontSize: "clamp(2.375rem, 1.55rem + 3.3vw, 4rem)", fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.025em" }
  hero: { fontFamily: "Atkinson Hyperlegible", fontSize: "36px en el celular; crece con su columna hasta 58px", fontWeight: 700 }
  head: { fontFamily: "Atkinson Hyperlegible", fontSize: "clamp(1.75rem, 1.3rem + 1.8vw, 2.625rem)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }
  lead: { fontFamily: "Atkinson Hyperlegible", fontSize: "clamp(1.125rem, 1.05rem + 0.35vw, 1.3125rem)", lineHeight: 1.45 }
  body: { fontFamily: "Atkinson Hyperlegible", fontSize: "clamp(1rem, 0.97rem + 0.15vw, 1.0625rem)", lineHeight: 1.55 }
  small: { fontFamily: "Atkinson Hyperlegible", fontSize: "0.875rem", lineHeight: 1.45 }
  hand: { fontFamily: "Kalam", fontWeight: 700, note: "solo el logo y las notas a mano sobre las capturas" }
radii:
  card: "14px"
  control: "10px"
  pill: "999px"
---

# Landing de Blindaje: el producto, desde la primera pantalla

**Rediseño del 28/10/2026, 18:00 (skill `impeccable`).** El dueño pidió: "Lo del quipu no es
necesario, esto parece un blog más que una landing page. Que exprese, que esté ordenado, que diga
beneficios y tecnología." Antes hubo tres versiones: el quipu del gremio en índigo (titulares enormes),
el informe impreso en serif y los tintes del quipu con un quipu animado. Esta versión deja el ensayo
editorial y arma una landing de producto en el idioma visual de la propia app: la letra Atkinson
Hyperlegible de la consola, su logo escrito a mano y su resaltador amarillo.

## La idea

El visitante ve el producto de verdad en la primera pantalla. A la izquierda, qué es Blindaje y qué
hacer; a la derecha, la consola real (el grafo de la red R-001) y el portal de negocios en un celular,
con una nota a mano que señala la voz compartida: "misma voz, otro número". Después la página baja en un
orden fijo: por qué hace falta, qué gana cada uno, cómo funciona, qué hace el producto, con qué está
hecho, qué no hace, cuánto mide y cómo pedir un piloto.

## Reglas

- **Color con trabajo.** Añil (`field`) en portada, pasos, piloto y pie; papel frío (`paper`,
  `paper-2`) para leer, alternando secciones. El amarillo del resaltador (`mark`) es la acción principal
  y lo que se marca ("voz", los números de los pasos); el texto encima siempre va en tinta. Menta en los
  vistos y lo que se aprueba; celeste en los ids de los modelos. El rojo (`alarm`) solo en el 105.
- **Una letra.** Atkinson Hyperlegible en todo, 700 para titulares y 400 para leer: es la letra de la
  app y se lee bien en celulares baratos. Kalam solo firma (el logo) y anota (la nota sobre la captura).
  Cinco tamaños (small, body, lead, head, display), más el logo. Titulares de dos líneas como máximo en
  escritorio; el de la portada mide su columna para no partirse.
- **Cabecera de sección.** El titular a la izquierda y su bajada a la derecha, sin rótulo encima.
- **Superficies.** Tarjetas blancas con radio de 14 px: con borde fino sobre papel, sin borde sobre
  `paper-2`. Las capturas, el celular y la hoja del formulario flotan con una sombra suave con
  desplazamiento; nada más lleva sombra. Controles con radio de 10 px; pastillas para pestañas y datos.
- **La cuadrícula del cuaderno** solo donde es el producto: dentro de las capturas y en la ilustración
  de la app disfrazada.
- **Sin adornos.** Sin degradados, sin texto en degradado, sin franjas de color al costado, sin emojis,
  sin logo de Meta. Los íconos son trazos de 2 px dibujados en `Icon.astro`.

## Movimiento

Una pieza por zona, siempre desde un estado ya visible; con movimiento reducido todo aparece en su
estado final.

- **Portada:** el texto sube, la consola llega, el celular se apoya encima, el resaltador pasa sobre
  la palabra del titular y luego va cambiándola por cada huella (voz, foto, frase, cuenta, zona), y la
  nota a mano se escribe y traza su flecha hasta el nodo V-3.
- **Cómo funciona:** la línea amarilla que une los cuatro pasos se completa mientras la sección cruza la
  pantalla (`animation-timeline: view()`).
- **Recorrido:** cambiar de pestaña funde la captura nueva, y en cuatro capturas la nota a mano de la
  portada se vuelve a escribir y traza su flecha ("cada cita, comprobada", "misma cuenta, otro caso",
  "son indicios, no prueba", "la copia salió de esta cuenta").
- **Meta AI:** el diagrama "Del archivo a la decisión" se traza por etapas y deja pasar pulsos solo
  mientras se ve.
- **Demo de revisión:** el amarre entre los casos se cierra al confirmar y se corta al descartar.

## Secciones, en orden

| Sección | Composición |
| --- | --- |
| Franja de ayuda | 105 en rojo, Línea 1818 y Salir rápido (Esc dos veces), fija arriba al bajar |
| Cabecera | Logo a mano, cinco secciones y "Pedir un piloto"; en celular y tableta, un menú desplegable nativo con las secciones, las preguntas y el idioma |
| Portada (añil) | "Otro número. La misma ___.": el resaltador pasa por voz, foto, frase, cuenta y zona (tres vueltas, solo mientras se ve; con movimiento reducido queda en "voz"). Frase de valor con todas las señales, dos botones y tres vistos; consola y portal reales con la nota a mano. Debajo, la fila "Hecho con Meta AI" |
| Problema | Tres cifras con su fuente y "por qué no alcanza hoy" en una tarjeta |
| Señales (añil) | "Las huellas que deja una banda": voz, fotos y video, forma de hablar, números y cuentas, cómo cobran, zona y fechas. Cada una con el glifo y el color de la leyenda del grafo de la consola, un ejemplo del caso ficticio y el modelo que la produce; al final, que ninguna decide sola |
| Beneficios | Víctimas (la app por fuera y por dentro, ilustrada), gremios y negocios (portal real y alerta aprobada), policía y fiscalía (perfil real de la red e índice del expediente), en filas que alternan lado |
| Cómo funciona (añil) | Cuatro pasos unidos por una línea y la demo de revisión ("tú eres la revisora") |
| Producto | Seis pestañas con capturas reales: vincula, mapea la red, aconseja, expediente, autenticidad y filtraciones. Sin JavaScript se ven todas |
| Meta AI | Diagrama del pipeline como pieza central; debajo, los modelos de la Meta Model API y los abiertos de Meta en dos listas (nombre, id y trabajo), los seis agentes en una tabla con quién aprueba y lo que no es de Meta |
| Límites | Ocho límites en dos columnas y la nota honesta sobre el cifrado |
| Resultados | Cuatro resultados medidos arriba (cifra en amarillo sobre añil, con su meta o su muestra) y las tablas reales de `eval/report.json` y `eval/results/watermark.json` en tarjetas |
| Preguntas | Siete preguntas de un dirigente en desplegables nativos, con el titular fijo a la izquierda |
| Piloto (añil) | Frase, para quién y tres pasos numerados; el formulario en una hoja blanca |
| Pie (añil profundo) | "Si estás en peligro ahora, llama al 105" con los botones de 105 y 1818; logo, proyecto, enlaces y notas |

No hay fotos: las imágenes son las capturas reales de la consola y del portal en modo simulado, con
datos ficticios. El favicon es una onda de voz sobre el resaltador.

## Medido (28/10, 21:15, vista previa local)

- Detector de `impeccable` sobre la página construida: 0 hallazgos a 1440, 1100, 768 y 390 px, en
  español e inglés.
- Lighthouse móvil: rendimiento 100, accesibilidad 100, buenas prácticas 100, SEO 100; LCP 1.7 s,
  CLS 0, TBT 0 ms.
- Prueba funcional en Chrome: demo de revisión (confirmar, deshacer, descartar, foco), pestañas (clic,
  flechas, Inicio), validación del formulario, anclas del menú, 0 imágenes rotas y sin scroll lateral a
  390 px. Con movimiento reducido, todo en su estado final.
- El inspector de `design-taste-frontend` (pensado para la dirección editorial anterior) sigue marcando
  las sombras de las capturas flotantes, las líneas de las listas y tablas, los bordes de los controles,
  la falta de video y el titular de cuatro líneas a 390 px. Se defienden: son una landing de producto, y
  no hay un clip abierto y honesto del tema.
