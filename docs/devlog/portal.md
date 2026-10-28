# Devlog: portal de negocios (`apps/portal`) y recomendaciones

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

Frente del portal para dueños y gerentes de negocios afiliados a un gremio, la vista
"Recomendaciones" de la consola y las recomendaciones en la app. Las decisiones de UX y UI se
tomaron con Impeccable 4.8 (local en `.claude/skills/impeccable/`, sin versionar) y con los skills
`web-design-guidelines` y `accessibility` de `.agents/skills/`. Este frente corrió como subagente:
sin una persona a quien hacerle las preguntas de `shape`, el brief se infirió del encargo y los
supuestos quedan anotados aquí.

## 2026-10-28 05:00 · `shape`: brief y dirección

**Contexto.** `impeccable context` cargó PRODUCT.md y DESIGN.md. El portal es una superficie nueva
dentro de un mundo ya fijado (Cuaderno), así que no hubo taller de mundo visual: solo se decidió la
estructura.

**Brief (inferido).**
- Quién llega: dueños y gerentes de bodegas, mototaxis, transporte y mercados. Poca práctica con
  paneles; muchos en el celular, en el local, entre cliente y cliente.
- Qué deben entender en segundos: cómo está su zona y su rubro, qué modalidad circula y cómo
  reconocerla, qué hacer primero, y que nunca se paga ni se negocia.
- Antimetas: tablero de fichas con número grande, rojo de alarma, mapa de calor, buscador, tono de
  miedo y jerga técnica.
- Modo: lectura con tareas de operación (casi no hay acciones).

**Estructura.** `concept-seed --scope surface --mode operate` repartió la estructura 6 de una lista
propia de 7: la navegación como las preguntas del dueño. Cada vista abre con la respuesta en una
frase ("En Lima Este, el riesgo para bodegas es **medio**", con el nivel en resaltador). De las 7
también se tomó la tendencia como renglones de cuaderno. De los retadores del catálogo, la
señalética de aeropuerto quedó competitiva solo para el protocolo y le donó su disciplina: un
mensaje por renglón y el número monumental (105 y 1818). Los demás se descartaron por no servir a
un dueño de bodega.

**Firma.** La tendencia se dibuja en el propio cuadriculado: cada caso es un cuadro de tinta, y una
semana sin cifra va punteada ("dibujar la ausencia", DESIGN.md). Siempre hay tabla alternativa. El
único movimiento es el barrido del resaltador sobre el nivel, que no corre con movimiento reducido.

## 2026-10-28 06:30 · Ronda 1: `critique` (A y B aislados)

**Método.** A (revisión de diseño) y B (detector y evidencia renderizada) corrieron en dos
subagentes que no vieron el trabajo del otro. Usaron el mismo Chrome headless propio, cada uno en su
pestaña. Sin persona mirando, B no inyectó el overlay `[Human]`.

**A: 28/40 ("Good", en el límite inferior).** Lo más bajo: consistencia (2) y eficiencia (2).

**B: detector limpio.**
- CLI: 0 hallazgos principales y 2 avisos contra DESIGN.md (`.brand-name` a 34 px y cuadros con
  radio de 3 px).
- Renderizado por CDP en 4 vistas por 2 anchos: 0 hallazgos.
- Lo validó con una página de control con defectos puestos a propósito.
- Sin falsos positivos: el cuadriculado no disparó `codex-grid-background`.

| Prioridad | Hallazgo | Decisión y cambio |
|---|---|---|
| P1 | El gráfico semanal mostraba semanas de 2 y 3 casos mientras la página prometía cifras solo con 5 casos de 3 personas | La API aplica el umbral a cada semana y a cada rubro (`services/api/src/business/risk.ts`). Los datos simulados ahora hacen lo mismo: 4 semanas móviles, semanas bajo el umbral sin cifra y los rubros chicos sumados en "Otros rubros (agregado)". La leyenda lo dice |
| P1 | En el celular, la cabecera ocupaba 425 de 844 px. Con letra al 130 %, "Cerrar sesión" pisaba la marca y "Recomendaciones" se cortaba | Pestañas en una sola fila deslizable con etiquetas cortas (la activa siempre queda a la vista). Marca sola arriba, y el negocio con "Cerrar sesión" debajo. "Datos ficticios" en una línea. La respuesta empieza a 610 px; con letra al 130 % no hay superposición ni desborde |
| P2 | El gráfico de rubros cambiaba de escala ("cada cuadro es 2 casos") y redondeaba | Siempre un cuadro por caso, de 10 en 10 por renglón |
| P2 | Bajo el umbral, la página era andamiaje vacío: 8 semanas punteadas, tabla de "sin cifra" y nombres de rubros (que ya delatan que alguien denunció) | Página corta: la respuesta, el aviso de umbral, "Cuando haya cifras, léelas así" (el sesgo), una sola hoja punteada y "¿Y ahora qué hago?". Sin nombres de rubros, igual que la API |
| P2 | La tesis "cada vista responde una pregunta" solo se cumplía en Mi panorama | Alertas abre con "Tu gremio te envió 2 avisos. 1 es de esta semana." y marca "Nuevo" lo de los últimos 7 días. Recomendaciones abre con "Lo más urgente: …". Mi panorama muestra el último aviso del gremio |
| Avisos de B | Medida y radio fuera de la escala | La marca pasa a 2 rem (título de pantalla) y los cuadros a 4 px (marca) |

**Otros cambios de la ronda.**
- "Cómo suele escalar" pasa a "No esperes a que venza el plazo": la acción en grande, el dato que
  asusta en letra normal y el 105 y el 1818 a mano.
- "Toda la zona" junto a "Solo bodegas". La vista vive en la URL (`?vista=zona`) y usa la API real
  (`?zona=` sin rubro).
- "No pagues ni negocies" también en el celular, en la franja de ayuda.
- Cada botón "Ver los casos … en una tabla" tiene un nombre distinto.
- El punteado queda solo para la ausencia: "Ten en cuenta" y las etiquetas usan borde continuo.
- Se quitan las etiquetas "Prioridad alta/media/baja", que repetían los títulos de grupo; quedan
  para lectores de pantalla. "Lo que Blindaje no hace" usa viñetas, no marcas de visto.
- "Mostrar la contraseña" pasa a ser una casilla bajo el campo (antes encogía el campo a 145 px).
- El estado vacío de Recomendaciones enlaza al protocolo.
- Rubros en palabras: la API guarda el enum en singular ("bodega") y se lee "bodegas".
- "a. m." con espacios duros.
- Hoja de impresión para llevar las recomendaciones a la asamblea.

**Lo que no se cambió y por qué.**
- **Cinco pestañas y no una barra inferior.** Una barra fija tapa contenido. La fila deslizable
  deja la respuesta en la primera pantalla sin esconder secciones.
- **La bandera "Datos ficticios" en resaltador.** Es el patrón de la consola, un aviso que debe
  gritar (`docs/devlog/ux.md`).
- **"Nuevo desde tu última visita".** No hay estado por usuario. Se usa "Nuevo" para los últimos
  7 días.

## 2026-10-28 08:30 · `audit` (web-design-guidelines y accessibility) y `polish`

**Hallazgos de las reglas de Web Interface Guidelines, corregidos.**
- Campos del login sin `name`.
- Marca del login sin `translate="no"`.
- La vista elegida (rubro o zona) no estaba en la URL.
- Al cargar, el foco se iba a `<main>` y el primer Tab saltaba la franja de ayuda. Ahora, en la
  primera carga, Tab llega a "Saltar al contenido" y luego a "Salir rápido". Al navegar, el foco va
  al contenido.
- Subgrupos de una recomendación como regiones con el mismo nombre (axe `landmark-unique`).

**Lo que se mantiene.**
- El barrido anima `background-size` y no `transform`. Es un solo momento de 0.65 s sobre una
  palabra, y con movimiento reducido aparece ya puesto.
- No hay tema oscuro: el papel es parte del sistema.
- `theme-color` es la tinta de la franja de arriba.

**Puntaje estimado (`audit`): 18/20.**
- Accesibilidad 4.
- Rendimiento 3: 126 KB gzip. Incluye zod para validar el contrato.
- Tema 3: tokens completos, sin modo oscuro a propósito.
- Adaptación 4.
- Integridad 4: el detector está limpio.

**Salir rápido.** Además de abrir una página neutra y reemplazar la entrada del historial (Esc dos
veces), borra la sesión de la pestaña.

## 2026-10-28 10:30 · Consola: Recomendaciones y cuentas de negocio

- **Recomendaciones** (`/recomendaciones`) está en la navegación de revisora, analista y
  administración.
  - Analista y administración pueden correr el Asesor por gremio, zona y rubro. Sin zona ni rubro,
    corre uno por cada cuenta de negocio.
  - Cada borrador muestra "Revisión antes de aprobar" con las reglas de producto en palabras:
    validador de citas, sin números ni cuentas, sin consejo de pagar o negociar (lo negado no
    cuenta), sesgo y derivación al 105 y la 1818. También muestra la evidencia por modalidad con las
    citas de la consola.
  - A la derecha va "Vista previa: así lo ve el negocio", igual a la vista del portal y sin citas.
  - Aprobar y rechazar usan la misma confirmación que las demás decisiones: la consecuencia se ve
    en texto, el foco queda en "Cancelar" y Escape cancela.
  - Si el validador falló, "Aprobar" está deshabilitado con la razón y "Correr el Asesor de nuevo",
    igual que el 409 de la API.
- **Cuentas de negocio** en Administración. El revisor, si se le habilita, solo puede crear cuentas
  de su gremio. Si la zona va vacía, se usa la del gremio. La contraseña temporal tiene al menos 12
  caracteres.
- **Separación del otro frente.** Para no chocar con quien trabaja la autenticidad, la API del
  Asesor vive en `api/advisor.ts`: usa el mismo `HttpClient` y, en modo simulado, `MockAdvisorApi`.
  Los estilos van en `styles/recommendations.css`. En App, Layout, AdminView y permisos se cambiaron
  solo unas líneas.

## 2026-10-28 11:15 · Verificación

**Portal.**
- `typecheck`, `lint`, `test` (36), `build:mock` y despliegue en
  <https://blindaje-negocios.vigiaperu.workers.dev> en modo simulado.
- Recorrido con un solo Chrome headless propio (puerto 9347; el driver rechaza un navegador que no
  sea HeadlessChrome) contra `vite preview` y contra el despliegue: 53 de 53 comprobaciones. Cubren:
  - login con errores junto al campo;
  - orden de foco;
  - respuesta en la primera pantalla a 1440 y 390 px;
  - toda la zona;
  - tabla alternativa;
  - umbral sin cifras;
  - estados vacíos;
  - sin buscador;
  - sin nombrar el disfraz;
  - movimiento reducido;
  - texto al 130 % y al 200 % sin desborde;
  - cero errores en la consola del navegador.
- axe-core 4.10.2 (WCAG 2.2 AA y buenas prácticas) en 8 estados por 2 anchos: 0 fallas.

**Consola.**
- `typecheck`, `lint`, `test` (75; 12 nuevos) y `build:mock`.
- Recorrido de 21 comprobaciones:
  - admin corre el Asesor y aprueba con confirmación;
  - el validador bloquea;
  - la vista previa va sin citas;
  - el filtro está en la URL;
  - se crea una cuenta de negocio;
  - la revisora no ve el Asesor, solo ve su gremio y rechaza;
  - a 390 px no hay desborde.
- axe: 0 fallas en Recomendaciones (1440 y 390 px) y en Administración.

**App.** Las recomendaciones van detrás del PIN, en "Avisos del proveedor", y los consejos van en
"Denuncia lista" (`apps/mobile/src/app/privado/lista.tsx`). Se verificó con `npm run typecheck` y
`npm test` (112). El test de palabras prohibidas del disfraz sigue en verde. El API simulado devuelve
el texto de autenticidad en audio, imagen y video procesados.

**Pendiente con el API real.**
- Desplegar el portal con `VITE_API_URL`. El CORS ya acepta `https://blindaje-*.workers.dev`. La
  cuenta del demo es `negocio@demo.blindaje.test` (ver README de la API).
- `POST /v1/console/asesor/run` es solo para analista y administración: el gremio (revisor) no puede
  correr el Asesor, solo aprobar.
- El analista no puede listar organizaciones (`GET /v1/console/orgs` es solo para administración).
  Por eso corre el Asesor solo para su organización.
- No hay `GET` de cuentas de negocio. La consola muestra solo las creadas en la sesión.
- La marca "Datos ficticios" se quita solo si `/v1/health` dice un entorno `prod…`.
