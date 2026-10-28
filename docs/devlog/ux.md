# Devlog: UX y UI con Impeccable (consola y app)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

Frente de UX y UI para `apps/console` y `apps/mobile`, con Impeccable 4.8 (local en
`.claude/skills/impeccable/`, sin versionar) y los skills de `.agents/skills/`. Este frente corrió
como subagente: sin persona a quien hacerle las preguntas de cierre de `critique`, las decisiones
de alcance salen del encargo ("corrige lo relevante") y se anotan aquí.

## 2026-10-28 04:00 · App móvil: `critique` y `audit.native` leyendo el código

**Método.** `PRODUCT.md` declara `web`, así que se cargaron a mano `reference/android.md`,
`audit.native.md` y `adapt.native.md`. En plataforma nativa `critique` corre solo la evaluación A
(sin detector ni navegador, que solo leen HTML). Sin emulador, Gradle, `expo run`, `prebuild` ni
Metro (RAM): todo se juzgó leyendo las pantallas y se verificó con `npm run typecheck` y `jest`.

**Crítica (Nielsen).** 27/40 antes ("Acceptable"). Lo más bajo: control y libertad (2), prevención
de errores (2) y ayuda (2).

**Auditoría nativa.** 15/20 antes ("Good"): accesibilidad 3, rendimiento 3, tema 3, conformidad
con Android 3, adaptabilidad 3 (vertical fijo y sin tableta: decisión válida para un disfraz de
celular; teclado resuelto con `KeyboardAvoidingView` en API 35+).

| Prioridad | Hallazgo | Decisión y cambio |
|---|---|---|
| P1 | El consentimiento comunitario decía "Nadie ve tus audios" y "solo analistas ven los resultados". No es cierto: en modo comunitario la consola deja que una revisora escuche fragmentos de los audios (`services/api/src/console/views.ts` solo abre casos comunitarios) | Texto honesto en un solo lugar (`src/private/consent.ts`): "una persona autorizada revisa los casos y puede escuchar partes de tus audios. No ve tu nombre ni tu número". Lo usan la bienvenida, la denuncia, la confirmación y Ajustes. "Solo mi denuncia" dice "Tu caso no se compara con otros" en vez de "Nada sale de tu caso" |
| P1 | "Salir rápido" estaba dentro del `ScrollView`: en "Denuncia lista", Ajustes o unas notas largas se iba de la pantalla al bajar | `Paper` acepta un `header` fijo fuera del desplazamiento; `PrivateScreen` pone ahí el título y "Salir rápido". Test que comprueba que el botón no tiene un `ScrollView` como ancestro |
| P1 | Con el freno silencioso activo (5 fallos), el PIN real tecleado tras la entrada secreta se guardaba en "Últimos vueltos" junto al monto secreto; los PIN fallidos también | La calculadora no registra en el historial lo que se tecleó con forma de PIN después de una entrada secreta. La calculadora común sigue guardando. Dos tests |
| P2 | 105 y 1818 solo aparecían al final de "Preparar mi denuncia" y en "Denuncia lista" | Bloque "Si estás en peligro" con "Llamar al 105" y "Línea 1818" en las notas privadas, y "Si estás en peligro ahora, llama al 105" en la bienvenida |
| P2 | La bienvenida presentaba el cuaderno como el único disfraz ("escondido en el cuaderno"), contra el compromiso de marca; la ayuda de "Salir rápido" decía "Vuelve al cuaderno" | "Se ve como una app común de tu negocio, y tú eliges cuál"; "esconde tus notas y vuelve a la app común"; "La app quedará como una app común" en el borrado |
| P2 | En Ajustes, pasar a "Comunitario" no pedía confirmación (en "Denuncia lista" sí) y, si la API fallaba, el interruptor quedaba en un estado falso | Misma confirmación que en la denuncia; si el servidor no lo registra, vuelve a como estaba |
| P3 | "Preparar mi denuncia": el botón del paso 1 se apagaba sin decir por qué; las cuatro preguntas y los consejos de "Avisos del proveedor" estaban en Kalam; el envío se llamaba igual que la pantalla; la barra de pasos no era un elemento accesible | "Guarda al menos una nota para seguir."; preguntas y "Qué hacer" en Atkinson (regla del presupuesto de letra a mano); "Armar mi denuncia"; `accessible` en la barra |
| P3 | Errores en negrita sin distinción visual; un 404 cualquiera decía "No encontramos ese código"; los selectores de opción ("¿Cuándo te llegó?", consentimiento) se anunciaban como pestañas; opciones de sector de 44 dp | `Notice` con tono: error sobre resaltador rosado (DESIGN.md, Forms), resultado en tinta; 404 genérico; `Segmented kind="choice"` con `radiogroup`/`radio`; sector a 48 dp |

**Lo que no se cambió y por qué.**
- Credibilidad del disfraz: el cuaderno, la lista y la calculadora funcionan de verdad, no muestran
  "Salir rápido" ni nada privado, y la calculadora abierta por entrada secreta es idéntica a la
  común. Las palabras prohibidas siguen fuera (test intacto y verde). La cubierta del selector de
  apps dice "Cuaderno" aunque el disfraz sea otro: coincide con el nombre del lanzador, que no
  cambia hasta tener íconos alternativos.
- Fricción de la entrada secreta y del PIN: mantener 2 s sin señal visible y un PIN fallido que se
  ve como un cálculo normal son decisiones de seguridad. El freno de 60 s tampoco avisa.
- El orden de las notas privadas sigue `design/cuaderno/cuaderno-boveda.dc.html` (fijado por el
  equipo); la ayuda va al final para no empujar las acciones.
- Tema claro y vertical fijo: el papel es parte del disfraz y la app es para celular.
- `maxFontSizeMultiplier` (1.2 a 1.6) se mantiene: escala con el sistema pero no rompe la
  calculadora ni los encabezados.

**Verificación.** `npm run typecheck` limpio; `jest`: 96 de 96 (antes 91; cinco nuevos), con el
test de palabras prohibidas del disfraz en verde. Commits `4e86871`, `421e3eb` y `9a6e67f` (el aviso
simulado decía "No negocies solo"; ahora "No pagues ni negocies").

**Puntaje estimado después** (relectura del código, sin dispositivo): crítica 31/40 ("Good":
correspondencia con el mundo real 4; control, prevención y ayuda suben a 3); auditoría 16/20
(accesibilidad 4). Queda pendiente
verificar en el build final con TalkBack, `font_scale` 1.3 y capturas de `adb`.

## 2026-10-28 04:05 · Consola, ronda 1: `critique` (A y B aislados)

**Método.** Evaluación A (diseño, sobre el código y 25 capturas de `vite preview` en modo simulado)
y B (detector CLI y escaneo renderizado `detect --cdp`) en dos subagentes que no vieron el trabajo
del otro. Sin persona en el navegador headless, B no inyectó el overlay `[Human]`. Instantánea en
`.impeccable/critique/2026-10-28T09-05-39Z__apps-console-src.md` (local). Primera corrida para este
objetivo, sin tendencia previa.

**Puntaje Nielsen: 23/40 ("Acceptable").** Lo más bajo (2): correspondencia con el mundo real,
control, consistencia, prevención de errores, eficiencia, minimalismo y ayuda. Carga cognitiva alta
al decidir un vínculo: falla en 5 de 8 puntos.

**Detector.** CLI: un aviso, `codex-grid-background` en `body` (falso positivo: el papel
cuadriculado es el mundo Cuaderno de DESIGN.md). Renderizado:
- `first-viewport-column-overflow` en la cola: el detalle medía 1614 px contra 356 px de la lista.
- `nested-cards` en el fieldset del Cartógrafo.
- `straggler` a 390 px.
- Con foco, el anillo de `:focus-visible` rodeaba todo `<main>`; eso generaba además 7 `nested-cards` falsos.

| Prioridad | Hallazgo | Decisión y cambio |
|---|---|---|
| P0 | Cinco expresiones regulares sin sus barras invertidas: el login rechazaba todo correo real (con la API real no hay botones de demo, así que nadie podía entrar), y las citas de evidencia no resolvían en la red (EV-A1 decía "no tiene detalle" debajo de "Validador de citas: correcto") | `\S`, `\d` y `\s` restaurados en `LoginView`, `NetworkDetailView`, `lib/citations.ts` y `lib/graph.ts`; tests en `views/patterns.test.ts` |
| P1 | La fricción estaba del lado del "no": confirmar un vínculo, aprobar una alerta y decidir una hipótesis eran de un clic (solo descartar y rechazar preguntaban); la consecuencia ("ninguna víctima recibe aviso") existía solo para lectores de pantalla | `InlineConfirm` en las seis decisiones: la consecuencia va en texto visible, el foco queda en "Cancelar" (Enter dos veces no decide nada) y Escape cancela. Al confirmar sin haber escuchado los fragmentos avisa "Aún no escuchaste ninguno de los 2 fragmentos de audio". Aprobar una alerta dice dónde la verán ("detrás de su PIN; nunca llega como notificación") y que no se puede retirar desde la consola, lo que es cierto: la API no tiene ese endpoint |
| P1 | Confianza confusa: tres puntajes por vínculo, el chip "Media" junto a la voz con p 0.08 se leía como "coincide a medias", umbrales sin rótulo, contradicciones invisibles en la cola, coseno/z/Hamming/DINOv2 y la fórmula siempre a la vista | Resumen arriba ("Lo sostiene: identificador igual. No lo sostiene: voz (0 de 4 segmentos coinciden)"). Cada señal lleva su veredicto en palabras (bandas sobre p, documentadas como presentación y no como umbrales del motor) y "Peso de esta señal: media" en vez del chip. Un solo puntaje con "Umbrales: 0.60 por revisar, 0.90 probable". Motor, Vinculador, fórmula y métricas en `<details>`. Cada vínculo de la cola empieza por el par de casos y muestra "1 contradicción" |
| P2 | La comparación de voces, la tesis del producto, quedaba bajo las tarjetas y bajo el pliegue | Panel "Comparar las voces" justo después de la explicación, con el veredicto de voz y los segmentos; la lista de la cola queda fija al desplazar en escritorio. Desapareció `first-viewport-column-overflow` |
| P2 | En el perfil, las hipótesis quedaban unos 1000 px abajo, se leían como hechos ("V-3 corresponde a quien realiza las llamadas") y no había siguiente paso | Si ya hay perfil, el Cartógrafo se pliega a una barra ("Ejecutar de nuevo"). Aparece "4 hipótesis por decidir" con su consecuencia y cada tarjeta dice "Hipótesis · confianza alta". El resumen de la red baja. Al decidir la última aparece "Generar el expediente de la red". Los datos simulados usan lenguaje de hipótesis ("podría ser la voz de…") |

**Otros cambios** (de la crítica, de `audit` con `web-design-guidelines` y `accessibility`, y de
`polish`):
- "Revisados" sin un vínculo elegido mostraba "Cargando…" para siempre; ahora dice "Elige un vínculo de la lista".
- La auditoría rota permite ir a la entrada (con foco) y dice qué hacer: "Avisa a la administración de la alianza… No la corrijas a mano". También avisa que desde ahí nada se da por verificado.
- `html { font-size: 93.75% }` y tamaños en `rem`: la letra respeta la preferencia del navegador (antes eran 15 px fijos).
- Sin anillo de foco alrededor de `<main>`, que solo es destino de foco para lectores de pantalla.
- Toques de 44 px con puntero táctil y citas de 24 px (WCAG 2.5.8; axe las marcaba).
- Regiones de tabla desplazables con nombre y alcanzables con teclado (axe a 390 px).
- El modal del Cartógrafo enfoca "Cancelar" porque la acción cuesta.
- Periodos legibles ("3 oct. a 19 oct. de 2026") y estado de la versión del perfil en español.
- Campos de solo lectura con borde punteado; filtros segmentados del ancho de sus opciones; fieldset sin caja anidada; `text-wrap: pretty`.
- La bandera del demo deja de ser fija por debajo de 600 px.
- Las frases de amenaza pasan de Kalam a Atkinson: son evidencia (regla del presupuesto de letra a mano).
- "Probable" va sin resaltador: es un estado, no un dato, y el amarillo empujaba al "sí".
- La vista previa del aviso es igual a la pantalla de la app: cabecera "Lo que tu asociación quiere que sepas" y "Qué hacer", sin la franja de 105 y 1818 que la app no tiene en esa pantalla.
- Las alertas simuladas decían "No negocies solo"; ahora dicen "No pagues ni negocies" (Blindaje no aconseja negociar), igual que la landing.

**Lo que no se cambió y por qué.**
- Ventana de "Deshacer" y "Retirar alerta": la API no permite revertir decisiones. La confirmación
  simétrica dice la consecuencia y que no se puede retirar. Propuesta de contrato:
  `POST /v1/console/alerts/:id/withdraw`.
- Atajos de teclado, reproducción "B y luego C" y vistas distintas por rol (revisora y analista):
  valen la pena, pero no entran en esta ronda.
- Colores de las citas por tipo (menta para identificadores, amarillo para voz) y la bandera del
  demo en resaltador: son el sistema de citas establecido y un aviso que debe gritar.
- El aviso `codex-grid-background`: es el papel cuadriculado que fija el brief.
- La consola a 390 px funciona sin desborde, pero es larga: es una herramienta de escritorio.

**Para otros frentes** (fuera de este alcance):
- `packages/shared/src/prompts.ts:89` pide al Vigía decir "no negociar solo", contra la regla de la línea 31 ("No aconsejes pagar ni negociar").
- El prompt del Cartógrafo debería pedir hipótesis en condicional ("podría…").

**Verificación.**
- `vite preview` en modo simulado con un solo Chrome headless en `[::1]:9222`. El puerto
  `127.0.0.1:9222` lo tenía otro Chrome de la máquina (no headless) y las capturas "antes" se
  tomaron ahí por error. El driver ahora rechaza cualquier navegador que no sea `HeadlessChrome`.
- Recorrido automático con 26 comprobaciones, todas en verde, y cero mensajes en la consola del navegador:
  - login manual con un correo real;
  - confirmación con aviso de audios sin escuchar, y sin él después de escucharlos con clics reales;
  - foco en "Cancelar" y Escape;
  - alerta aprobada con su advertencia;
  - perfil con pendientes y el Cartógrafo plegado;
  - cita EV-A1 resuelta en la red;
  - cuatro hipótesis decididas con el siguiente paso;
  - auditoría rota con salto a la fila;
  - sin desborde a 390 px.
- axe-core 4.10.2 (WCAG 2.2 AA y buenas prácticas), inyectado por CDP en 7 vistas a 1440 y 390 px: 0 fallas. Antes había `target-size` en las citas y `scrollable-region-focusable` en la auditoría a 390 px.
- `impeccable detect` (CLI y renderizado en 6 vistas): solo queda el falso positivo del cuadriculado.
- `typecheck`, `lint`, `test` (54 de 54; antes 43) y `build:mock` de `@blindaje/console`: todo limpio.
- Sin despliegue: lo hace el orquestador al integrar con la API real.
- Commits `5354bb4`, `fcc507e`, `3d093b1`, `c3af538` y `668022d`.

## 2026-10-28 04:40 · Consola, ronda 2: veredicto y cierre

**Pase de veredicto de A** sobre las capturas nuevas y los diffs, con las mismas reglas (sin
detector ni navegador): **28/40 ("Good")**, antes 23. Disposición: *ship* para el demo, sin P0 ni
P1 pendientes. Suben correspondencia con el mundo real, consistencia, prevención de errores,
minimalismo y ayuda (de 2 a 3). Siguen en 2 el control (no hay deshacer) y la eficiencia (sin
atajos; cada hipótesis cuesta dos clics).

| Prioridad | Hallazgo del veredicto | Decisión |
|---|---|---|
| P3 (regresión) | Por debajo de 900 px, la línea de margen pintaba sobre la bandera "Datos ficticios": la barra lateral pasaba a `static` | `.sidebar` con `position: relative; top: auto` en ese corte; verificado a 390 px |
| P3 | La frase "Ninguna víctima recibe aviso" estaba en el estilo más tenue (pequeña y en lápiz) | `.decision-note` en tinta, a 0.95 rem |
| Residual | Tras la rotura de la cadena, las filas posteriores seguían viéndose verificadas | Filas en lápiz con "· sin verificar" en la columna del hash |
| Sugerencia | VIN-1 (la voz que cruza números) muestra "2 contradicciones" en la cola; propone llamarlas "diferencias" | No se cambia: es la lista del propio Vinculador y suavizarla empujaría al "sí". Si "número distinto" no debe contar como contradicción, eso se decide en el prompt del Vinculador (`services/api`) |

**Verificación final.** Mismo recorrido de 26 comprobaciones: todas bien. axe a 390 y 1440 px: 0
fallas. `typecheck`, `lint`, `test` (54) y `build:mock`: limpios. Chrome headless y `vite preview`
cerrados.
