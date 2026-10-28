# Devlog: landing (`apps/landing`)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 01:05 · Impeccable instalado y contexto de diseño

- `npx skills add pbakaus/impeccable` instaló Impeccable 4.8.0 (lanzador 0.1.18). El instalador deja
  `.claude/skills/impeccable` como symlink con ruta absoluta; se reemplazó por una copia. Desde el
  cambio de reglas del repo, `.claude/`, `.agents/`, `.impeccable/` y `skills-lock.json` son
  herramientas locales y no se versionan.
- Comandos disponibles en esta versión (cada uno es un archivo en `reference/`): `init` (alias
  `teach`), `shape`, `document`, `extract`, `critique`, `audit` (y `audit.native`), `polish`,
  `bolder`, `quieter`, `distill`, `harden`, `onboard`, `animate`, `colorize`, `typeset`, `layout`,
  `delight`, `overdrive`, `clarify`, `adapt` (y `adapt.native`), `optimize`, `live`, `generate`;
  además `pin`, `hooks` y `doctor`. Utilidades del lanzador: `context`, `detect`, `concept-seed`,
  `surface-brief`, `critique-storage`, `live-server`.
- `init` sin entrevista en vivo: no había a quién preguntar, así que PRODUCT.md sale solo de
  `docs/`, `design/cuaderno/` y `PLAN.md`, con lo inferido marcado. Plataforma `web` en la raíz
  (la heredan landing y consola); con `adaptive` el lanzador cargaba las guías de iOS y Android en
  la landing. La app móvil debe usar `reference/android.md`.
- `document` en modo scan sobre `design/cuaderno/*.dc.html`: DESIGN.md con tokens (papel, tinta,
  lápiz, margen, resaltador; Kalam y Atkinson Hyperlegible; radios 4 a 16 px y 999) y reglas con
  nombre (solo tinta para acciones, resaltador solo detrás de datos, el rojo solo como margen, Kalam
  solo para anotaciones, papel sin sombras).

## 2026-10-28 01:20 · `shape`: estructura y jerarquía

- Modo Persuade, mundo fijado (Cuaderno), build code-led (no hay generación de imágenes).
- Siete estructuras propias ordenadas por resonancia: (1) las cuatro semanas en el margen, (2) por
  fuera y por dentro, (3) el libro de cuentas, (4) las piezas se juntan, (5) la alerta del gremio
  primero, (6) el expediente con cadena de custodia, (7) tres renglones, tres actores.
- `concept-seed --scope surface --mode persuade` repartió 7, 1 y 5; manda la 7 (seed
  `7befb1f7c20de0c4`). Sin persona que eligiera en la página de decisión, se tomó la asignada.
- Retadores del catálogo (grabado ukiyo-e por planchas, mapa de orientación, instrucciones de
  bloques, jardín de lluvia, BBS ANSI, siete segmentos): todos declinados por identificación del
  público. Disciplinas que sí se tomaron: la línea de margen como plancha fija de toda la página;
  en el paso a paso lo anterior queda en lápiz y lo nuevo llega en tinta; la ausencia se dibuja
  (métricas pendientes como celdas vacías).
- Jerarquía resultante: franja de tinta con 105 y 1818 → hero (titular de dos líneas, libro de tres
  renglones con el actor en el margen, inicio del formulario de piloto, captura pegada) → problema
  (cifras con fuente) → víctima → comunidad (las cuatro semanas, interacción firma: el resaltador
  barre cuando aparece una coincidencia) → autoridad → lo que Blindaje no hace → tecnología →
  resultados → piloto → ayuda → pie.

## 2026-10-28 01:45 · Construcción

- Astro 7.4 estático, i18n `/` y `/en/` con `hreflang` y `x-default`, sitemap, `robots.txt` con URL
  absoluta, 404 bilingüe.
- Astro 7.4 exige Node ≥ 22.23.4 y la máquina tiene 22.18: se usa un Node 22.23.4 portátil
  (checksum verificado) fuera del repo. CI usa `node-version: 22`, que ya resuelve a 22.23.4.
- Fuentes: API de fuentes de Astro con el proveedor `local` sobre los `.woff2` de `@fontsource`
  (latin, 400 y 700), fallback métrico sobre Arial generado por Astro (`size-adjust`, `ascent`,
  `descent`) y preload de Atkinson 400/700 y Kalam 700. El proveedor `npm` falla en Windows: pasa
  una URL `file://` a `fetch`.
- `eval/report.json` se lee en build (`src/lib/eval-report.ts`); sin reporte, el marcador
  `[resultados de la evaluación]` y celdas vacías dibujadas. Las metas de la sección 16 se muestran
  rotuladas como metas.
- Capturas: `src/lib/screenshots.ts` toma `docs/screenshots/*.{png,jpg,webp}` en build y las
  optimiza con `astro:assets`. Huecos y nombres reconocidos: `inside` (notas, privad, boveda,
  vault, dentro), `outside` (cuaderno, disfraz, inicio, ventas, fuera) y `report` (denuncia,
  report). Sin captura, el hueco `[captura de la app]`.
- Formulario: `PilotRequest` → `POST {PUBLIC_API_URL}/v1/public/pilot-requests`. Turnstile se carga
  al primer foco en el formulario (no pesa en la carga inicial). Validación en el cliente igual al
  esquema Zod, errores por campo con `aria-invalid` y resaltador rosado, estado en `role="status"`,
  éxito con foco en el mensaje. `PUBLIC_API_URL` y `PUBLIC_TURNSTILE_SITEKEY` por `astro:env`
  (por defecto, la API de workers.dev y la sitekey de prueba `1x00000000000000000000AA`).
- Primer despliegue: https://blindaje-landing.vigiaperu.workers.dev (Workers Static Assets,
  `wrangler.jsonc`). La API responde y el preflight CORS desde la landing da 204.
- Lighthouse móvil de referencia sobre el build local: rendimiento 100, accesibilidad 100, buenas
  prácticas 100, SEO 100 (FCP 1.3 s, LCP 1.6 s, TBT 0 ms, CLS 0).

## 2026-10-28 02:15 · Ronda 1: `critique` (dos evaluaciones aisladas)

Evaluación A (revisión de diseño) y B (detector y overlay en el navegador) en subagentes separados.
Puntaje Nielsen 23/32 (72 %, "Good"; 7 y 10 no aplican en Persuade). Detector CLI: 44 avisos
(42 tamaños de letra fuera de la escala de DESIGN.md, 2 radios). Overlay: contraste 1.5:1 en las
cabeceras fantasma del ejemplo, líneas de 90 a 101 caracteres, palabras sueltas al final, titular
en inglés de 4 líneas. Sin persona a quien preguntar prioridades: el alcance es "todo lo
relevante", como pide el encargo.

| Prioridad | Hallazgo | Cómo se resolvió |
|---|---|---|
| P1 | 105 y 1818 eran enlaces de 15 px en una franja; sin navegación en móvil; la víctima no tenía siguiente paso | Botones de 44 px ("Llamar al 105", "Línea 1818"), "Salir rápido" en la franja, "Piloto" y EN/ES en el encabezado móvil, línea para la víctima bajo el formulario del hero |
| P1 | El pedido de piloto llegaba después de tecnología y de los resultados vacíos | Orden nuevo: … Compromisos → Piloto → Tecnología → Resultados → Ayuda; navegación reordenada |
| P2 | La tesis de los tres renglones se diluía y el caso A-B-C no recorría las bandas | La línea de tinta de las bandas de actores cruza el margen; notas del margen en lápiz para las demás secciones; datos de la Persona A en "Lo que encontramos"; la red A-B-C en el expediente |
| P2 | La interacción firma pasaba fuera de pantalla en el celular; el rosado marcaba algo que no coincide | Un solo botón de avance debajo de la tabla que lleva el renglón nuevo a la vista; leyenda antes de la tabla; sin resaltador para lo que no coincide |
| P2 | Formulario pensado para correo y con 7 campos visibles | "WhatsApp, celular o correo", validación de 6 dígitos o correo, campos opcionales plegados, comprobación sin caja vacía, envío desactivado sin JavaScript, mensajes recuperables |
| Menores | Tamaños sueltos, medidas en `ch`, alerta en Kalam, chips de estado con resaltador, filas de compromisos estiradas | Escala de texto en tokens (`--fs-*`), medidas en `em`, alerta en Atkinson, estados como etiquetas con borde, `align-content: start` |

## 2026-10-28 02:35 · Ronda 2: `audit` + `web-design-guidelines` + `accessibility`

- Detector CLI tras la ronda 1: 0 hallazgos. Overlay: un párrafo de 101 caracteres (corregido).
- Revisión independiente con las guías de Vercel y WCAG 2.2 AA: 0 P0, 3 P1, 5 P2, 18 P3.
  Todos los pares de color pasan AA (el más bajo, lápiz sobre rosado, 4.70:1).
- P1: las anclas internas agregaban historial (tras "Salir rápido", "atrás" volvía a Blindaje):
  ahora desplazan, mueven el foco y usan `replaceState`; la salida abre una pestaña neutra y
  reemplaza la página, es lo primero en el orden de foco y tiene atajo (Esc dos veces). Pestañas
  del ejemplo sin reflujo a 320 px: ahora envuelven. La región `role="status"` estaba en
  `display: none` vacía: ahora siempre existe.
- P2: foco perdido al desactivar el botón durante el envío (ahora `aria-disabled`); el avance de
  semana no se anunciaba (región `aria-live`); contraste de la barra de desplazamiento; texto de
  metas que no envolvía en móvil.
- P3 aplicados: espacio antes de "(se abre en otra pestaña)", ícono externo en la ley, `role="list"`
  en listas sin viñetas, nombre accesible del cambio de idioma, `::before` sin doble lectura,
  roles de pestaña solo con JavaScript, `translate="no"` en marca y modelos, `lang="en"` en ids,
  `touch-action`, apóstrofos tipográficos, espacios duros, encabezado con ayuda en la 404,
  `Referrer-Policy: no-referrer` (no revelar Blindaje a los sitios enlazados).
- No aplicado: animar el resaltador con `transform` en vez de `background-size` (son pocas
  palabras cortas, sin costo medible); mayúsculas tipo título (no corresponden en español).
- Verificado en el navegador: sin desborde a 320 y 375 px, el historial no crece con las anclas,
  el foco va primero a "Salir rápido", y con la API simulada el éxito oculta el formulario y
  enfoca el mensaje, y el 429 deja el foco en el botón con el aviso. Esa prueba encontró un fallo
  real: `display: grid` anulaba el atributo `hidden` del formulario; regla global `[hidden]`.
- Lighthouse móvil local tras la ronda 1: ES 98/100/100/100 (TBT 140 ms con la máquina cargada),
  EN 100/100/100/100.

## 2026-10-28 02:50 · Ronda 3: `polish` y documentación

- Pulido propio sobre el recorrido completo (`reference/polish.md`): en el celular, los casos que
  todavía no llegan en el ejemplo ocupaban un bloque vacío alto; ahora son una línea punteada
  "Llega en la semana N".
- Documentador: DESIGN.md suma la escala tipográfica web (`web-*`), la maquetación web (posición
  de la línea de margen por tamaño, separadores de sección, la regla "solo las bandas de actores
  cruzan el margen"), los componentes nuevos (franja de ayuda con "Salir rápido", etiquetas con
  borde, campos con error en resaltador rosado, `<details>` para opcionales) y el barrido del
  resaltador. El sidecar local `.impeccable/design.json` se actualizó igual.
- Despliegue intermedio verificado: `/` y `/en/` 200 con Brotli, 404 propia, `robots.txt` con
  sitemap absoluto, `hreflang`, `Referrer-Policy: no-referrer`, HSTS, `X-Frame-Options: DENY`.

## 2026-10-28 03:30 · Ronda 4: segunda `critique` (A y B aislados)

Puntaje 25/32 (78 %, "Good"); tendencia 23 → 25. B: detector CLI sin hallazgos, overlay sin
antipatrones en es 1440, es 390 y en 1440, sin desborde a 390 y 320 px. Un escaneo extra sobre el
HTML compilado dio avisos que en el navegador resultaron falsos positivos (nombres de fuente con
hash de Astro, relleno de celdas punteadas, `:hover` del enlace de salto, que igual se reforzó).
A: el contrato de dirección se cumple (tesis, interacción firma, las tres disciplinas tomadas);
disposición `fix`.

| Prioridad | Hallazgo | Decisión |
|---|---|---|
| P1 | "No negocies solo" contradice "no aconseja pagar ni negociar" | "No pagues ni negocies" en la alerta y en Ayuda (EN "Don't pay or negotiate") |
| P2 | Las pestañas de semana se partían a 390 px | La palabra "Semana" visible solo desde 720 px; cada pestaña la conserva para lectores de pantalla |
| P2 | La línea "Por fuera…" se leía como un rótulo chico sobre el titular | Una sola línea a 0.5 em en lápiz; entrada más corta para que la acción quede en el primer viewport a 1440×900 |
| P2 | La alerta de la semana 4 tenía borde de tinta, como un botón | Hoja blanca con borde de renglón |
| P3 | Resaltador en etiquetas de consentimiento; columna de cuentas desalineada; franja en dos filas en tableta; 400 del servidor sin campos marcados; éxito sin siguiente paso | Etiquetas con borde; mismo relleno en todas las celdas; textos guía de la franja desde 1024 px; mensaje genérico si no hay campo marcado; el éxito nombra el siguiente paso (conversación y revisión legal) |

## 2026-10-28 03:45 · Ronda 5: veredicto, CLS, resultados reales y cierre

- Pase de veredicto del revisor A sobre las capturas nuevas: los ocho hallazgos de la ronda 4
  quedan resueltos; disposición `ship`. Señaló una regresión menor (el relleno compartido de la
  tabla separaba los valores de sus encabezados y partía "sin audio" en el celular): encabezados
  de datos con el mismo relleno y `white-space: nowrap`.
- CLS: Lighthouse en producción midió 0.011 con `font-display: swap` (el bloque de los tres
  renglones bajaba cuando Atkinson cambiaba el corte de la entrada). Atkinson pasa a
  `font-display: optional` con preload (llega a tiempo en conexiones normales; en una lenta se
  queda el fallback métrico sin saltar). Kalam sigue en `swap`: solo palabras sueltas y notas
  cortas, y su 400 no se precarga. Resultado: CLS 0.
- `eval/report.json` llegó con un esquema propio (`resumen[]` con metas, estado y nota). El
  lector lo usa directo; lo pendiente (fidelidad de citas de los agentes y estadísticas con menos
  de 5 casos, porque aún no hay salidas de los agentes) queda como celda vacía dibujada con su
  motivo. Para no mostrar solo lo favorable se suman dos resultados sin meta: vínculos esperados
  encontrados en los escenarios (88.9 %, 16/18) e imágenes reutilizadas detectadas por hash
  perceptual (60.7 %). Enlace al `eval/REPORT.md` del repositorio.
- Capturas: prueba con un PNG temporal en `docs/screenshots/` (borrado enseguida): el hueco
  `inside` del hero lo toma solo, en WebP responsivo con ancho y alto. Los huecos `outside` y
  `report` de la banda Víctima siguen marcados como `[captura de la app]` hasta que existan.
- Lighthouse móvil final en https://blindaje-landing.vigiaperu.workers.dev:
  ES rendimiento 98, accesibilidad 100, buenas prácticas 100, SEO 100 (FCP 1.8 s, LCP 1.9 s,
  TBT 10 ms, CLS 0); EN 99, 100, 100, 100 (FCP 1.5 s, LCP 1.8 s, TBT 0 ms, CLS 0).
- Pendiente: capturas reales de la app, sitekey real de Turnstile (`PUBLIC_TURNSTILE_SITEKEY` en el
  build; hoy la de prueba, que muestra "solo para pruebas"), un canal humano de contacto si el
  formulario falla, y volver a compilar y desplegar cuando cambien `eval/report.json` o las
  capturas (`pnpm --filter @blindaje/landing deploy`, con Node ≥ 22.23.4).

## 2026-10-28 09:20 · Rediseño: "el quipu del gremio"

- Pedido del dueño: "mejora la landing page, está horrible". Problemas: huecos punteados
  `[captura de la app]` en el hero y en Víctima, cuadrícula y línea de margen que se leían como
  cuaderno escolar, muros de texto gris chico, todo en azul marino, formulario de piloto metido en
  el hero, y nada de la visión ampliada (D11 a D13) ni del uso de Meta AI.
- Impeccable (rediseño, modo Persuade, sin persona que responda): `concept-seed` sobre una lista
  propia de siete mundos (comunicado del gremio, expediente fiscal, papel de seguridad, quipu,
  tarjeta de control de ruta, cartel chicha, pizarra de investigación). Salió el 4: el quipu.
  Cada caso es una cuerda que cuelga de la cuerda madre del gremio; cada señal es un nudo (número =
  nudo simple, voz = nudo largo, cuenta = nudo en ocho) con el color que ya usa la consola (voz
  amarillo, identificadores menta, frases rosado, imagen celeste); el amarre entre dos cuerdas es
  el vínculo que confirma una persona. Contrato en el brief de la superficie (fuera del repo).
- La landing deja el mundo Cuaderno (sin cuadrícula ni línea roja); la consola, el portal y la app
  lo conservan. Puente: tinta #1E3A70, los resaltadores como colores de nudo, Atkinson
  Hyperlegible y Kalam solo en la marca y en las notas de la revisora.
- Estructura: hero índigo con titular a escala ("Cambiaron de número. No cambiaron de voz.") y el
  quipu A, B, C (datos de la consola: Tel ···131/···904/···377, V-3, Yape ···488, VIN-1 0.91,
  VIN-2 0.95) que se amarra semana por semana una sola vez (menos de 5 s), con botones por semana y
  estado final fijo con movimiento reducido o sin JavaScript; problema con las cifras y sus
  fuentes en un libro de renglones; qué recibe cada actor (víctima con ilustración geométrica
  rotulada, gremio y negocios con el portal en el celular, autoridad con el perfil del
  Cartógrafo); capa de inteligencia (vínculo por la voz, grafo de la red, alerta del Vigía,
  consejo del Asesor con su validador, seis agentes y quién aprueba); autenticidad (AudioSeal,
  Video Seal, C2PA, metadatos y análisis forense de Muse Spark, y cómo decide); "Hecho con Meta
  AI" (flujo del archivo a la decisión y qué modelo hace qué, con lo que no es de Meta y lo que se
  descartó); compromisos; resultados reales de `eval/report.json` con su meta al lado y lo
  pendiente a la vista; formulario de piloto completo; ayuda con 105 y 1818.
- Capturas reales: consola y portal compilados en modo simulado (`vite build --mode mock`) a una
  carpeta temporal, servidos con un servidor estático propio y recorridos con un Chrome headless
  propio por CDP (perfil desechable). Se capturó a 1000 px de ancho y DPR 2 para que el texto se lea
  al tamaño en que se muestra. Quedan en `docs/screenshots/consola-*.png` y
  `portal-negocios-panorama-movil.png`, con su origen dentro del PNG; Astro las sirve en WebP (en
  capturas de interfaz el AVIF pesaba más) con ancho y alto. `screenshots.ts` sigue tomando solas las
  capturas del celular por nombre (y nunca confunde las de la consola con ellas).
- Revisión de cierre de Impeccable con un revisor nuevo (sin el contexto del constructor):
  disposición `fix` con ocho hallazgos. Corregidos en una tanda: Atkinson pasa de `optional` a
  `swap` (en una primera carga el titular salía en Arial; con el fallback métrico el CLS sigue en
  0); la fila Víctima pierde los contornos de celular (ahora el cuaderno de ventas del disfraz en
  tipo, la entrada secreta y la evidencia como nudos de la cuerda del Caso A); fuera los kickers
  (el actor va dentro del titular); el quipu arranca cuando entra a la vista (en el celular queda
  abajo); los amarres llegan punteados ("propuesto") y una persona los vuelve sólidos ("confirmó
  la revisora"); "Hecho con Meta AI" pasa al campo índigo con el flujo dibujado como quipu y
  Resultados pasa a bruma; recortes de la consola tomados a ancho de celular (430 px) que se sirven
  por debajo de 720 px con `<picture>`; los agentes se cuentan una sola vez. Pase de veredicto:
  siete resueltos y el grafo parcial; se agregó su recorte (casos A y B unidos por V-3) con su
  propio pie en el celular.
- Lighthouse en https://blindaje-landing.vigiaperu.workers.dev (versión 8c724012): ES móvil 98,
  100, 100, 100 (FCP 1.4 s, LCP 1.9 s, CLS 0, TBT 0 ms); ES escritorio 100 en todo; EN móvil 98,
  100, 100, 100 (LCP 1.8 s, CLS 0); EN escritorio 100 en todo (CLS 0.005). Sin scroll horizontal a
  360 y 375 px. Turnstile y el POST a `/v1/public/pilot-requests` sin cambios.
- `apps/landing/DESIGN.md` (y su `design.json`, fuera del repo) documenta el mundo de la landing;
  el `DESIGN.md` de la raíz sigue siendo el de la app, la consola y el portal (sus secciones web
  todavía describen la landing anterior). El documentador encontró dos incoherencias, ya
  corregidas: toques de 40 px (105, 1818, Salir rápido y semanas del quipu) que pasan a 44 px, y
  el nudo en ocho que en la ilustración de Víctima significaba mensaje (ahora es nudo simple rosado;
  el nudo en ocho es solo la cuenta). Versión final 26a444c5: ES móvil 98, 100, 100, 100 (LCP
  1.9 s, CLS 0); EN móvil 99, 100, 100, 100.
- Pendiente: capturas reales del celular (entran solas por nombre en `docs/screenshots/`) y volver
  a desplegar cuando cambie `eval/report.json` (las métricas de citas de los agentes y de
  estadísticas con menos de 5 casos siguen pendientes en el reporte).
