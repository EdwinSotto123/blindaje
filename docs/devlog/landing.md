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
