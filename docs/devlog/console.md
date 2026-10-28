# Devlog: consola (`apps/console`)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 01:10 · Base y decisiones

- React 19 + Vite 8 + TypeScript estricto + react-router 8 (`BrowserRouter`, rutas anidadas y
  `:tab?`). Cytoscape.js para el grafo. Atkinson Hyperlegible (400 y 700) y Kalam (700)
  autoalojadas con `@fontsource` (OFL), solo el subconjunto latino.
- Una interfaz `BlindajeApi` con dos implementaciones: `HttpApi` (docs/API.md) y `MockApi` (modo
  simulado). `VITE_MOCK=1` o `--mode mock` fuerza el simulado; sin `VITE_API_URL` también arranca
  simulado (nunca adivina una API). La marca "Datos ficticios" sale si `/v1/health` trae un `env`
  con "demo" o si el modo es simulado.
- Tipos: todo sale de `@blindaje/shared`. Los esquemas que no exportan su tipo (`ExpedienteView`,
  `HypothesisView`, `AuditVerifyResponse`, `AudioFragment`, …) se infieren con
  `ReturnType<typeof S.X["parse"]>`, sin depender de zod en la consola. `HttpApi` valida cada
  respuesta con el esquema de shared y avisa en la consola del navegador (`[contrato]`) si no cumple,
  sin romper la vista.
- Cliente HTTP: access token solo en memoria; refresh token en `sessionStorage` (sobrevive a recargar
  la pestaña, no a cerrarla). Ante un 401 renueva una sola vez (un refresh compartido entre peticiones
  concurrentes) y reintenta; si el refresh falla limpia la sesión y vuelve al login con aviso. Renueva
  por adelantado si el token vence en menos de 5 s o si no hay access token (recarga). Nunca manda
  `Authorization` a un origen distinto del de `VITE_API_URL`.
- Medios protegidos: `fetch` con `Authorization` → `Blob` → object URL (se revoca al desmontar). El
  audio se descarga solo cuando el revisor lo pide (cada acceso queda en la auditoría). Si la API
  devuelve el audio sin recortar, el reproductor salta al inicio del rango y se detiene al final.
- Citas clicables: `parseCitations` reconoce el `CITATION_RE` de shared y además la forma
  `ID-…488`. Los identificadores cifrados se muestran solo como "…488" (con el tipo: "Yape …488"),
  también en el grafo. Cada cita abre un panel lateral (`<dialog>` modal: foco atrapado, Escape cierra
  y devuelve el foco) con la evidencia (SHA-256, fragmentos de audio, imagen redactada), la ficha, la
  huella, el identificador, el vínculo o la red.
- Grafo: cada tipo de nodo tiene forma y color propios (caso: rectángulo tinta; voz: círculo
  amarillo; identificador: rombo menta; frase: etiqueta rosada; imagen: hexágono gris azulado),
  leyenda HTML con las mismas formas, lista de elementos navegable con teclado que selecciona en el
  grafo, y línea de tiempo con carriles por caso. Disposición determinista: casos en fila por fecha y
  cada tipo de señal en su carril, entre los casos que la comparten.
- Modo simulado: casos A, B y C de la sección 3 (A–B por voz con números distintos, B–C por la misma
  cuenta de Yape "…488"), más D–E (red previa por placa) y F (candidato débil con contradicciones).
  Al confirmar VIN-1 y VIN-2 aparece la red R-001 de tres casos. Auditoría con cadena SHA-256 real
  (botón "Simular una alteración" para mostrar que la verificación la detecta), PDF del expediente
  generado en el navegador con su SHA-256 real, audios sintéticos (tonos, una frecuencia por huella)
  e imágenes vectoriales neutras. El estado vive en `sessionStorage` y se puede restablecer a
  "Inicio" o "Red armada" desde la bandera del demo.

## 2026-10-28 01:55 · Verificación en Chrome y despliegue

- Recorrido automático en Chrome headless (CDP) con 16 pasos: login, cola, audio, citas, confirmar
  VIN-1 y VIN-2, grafo, Cartógrafo, perfil inválido, expediente con SHA-256 verificado al descargar,
  Vigía, auditoría íntegra y rota, costos, admin y permisos de la revisora. Cero errores y cero avisos
  en la consola del navegador, también contra la URL desplegada con su CSP real. Capturas en
  `apps/console/screenshots/`.
- Hallazgo corregido: tras "Cerrar sesión", la siguiente persona entraba a la página de la anterior.
- Hallazgo del entorno: `vite preview` no ve los assets nuevos si se recompila con el servidor
  corriendo; hay que reiniciarlo.
- Desplegada con Workers Static Assets (`blindaje-console`, SPA fallback, `_headers` con CSP que solo
  permite conectarse al origen de `VITE_API_URL`):
  **https://blindaje-console.vigiaperu.workers.dev** (modo simulado).
- Bundle: vistas con carga diferida; Cytoscape (unos 145 kB gzip) solo se descarga al abrir una red.

## 2026-10-28 02:15 · Alineación con la API real

Leído `services/api/src/routes/console.ts` (sin tocarlo):

- `GET /links?status=` acepta un solo estado o `todos`: la pestaña "Revisados" pide `todos` y
  filtra `confirmado` y `descartado` en la consola.
- `POST /users` exige contraseña de 12 caracteres o más; `POST /orgs`, nombre de 2 o más.
- `GET /orgs` trae `devices` y `users`: se muestran.
- Nombres de acción de la auditoría (`link.decision`, `evidence.media`, `agent.cartografo.run`, …)
  con su lectura en español.
- Nodos de la red: `caso` trae `data.case_id` y `data.code` (sin `primer_contacto`): los casos se
  ordenan por su primer evento de la línea de tiempo y los casos de cada señal salen de las aristas.
- `GET /cases/:id` se audita (`case.view`): la vista de red ya no carga todos los casos de entrada;
  pide un caso solo cuando se abre una cita de su evidencia o su ficha.

## 2026-10-28 02:35 · Pasada de diseño con Impeccable y guías de interfaz

`impeccable context` cargó PRODUCT.md y DESIGN.md (sistema Cuaderno, modo Operate). Cambios:

- **El rojo es solo la línea de margen**: errores, citas inexistentes y estados inválidos van en
  resaltador rosado con texto en tinta; toda acción en tinta (se quitó el verde de "Confirmar").
- Sin sombras (drawer, login, barra de decisión) ni bordes laterales de color; señales, hechos,
  hipótesis y fragmentos como renglones en vez de cajas dentro de cajas.
- Kalam solo en la marca, las frases firma y el título de "Avisos del proveedor"; las
  transcripciones pasaron a Atkinson.
- Selección del grafo: trazo de tinta con halo de resaltador. Imagen: gris azulado de la paleta.
- Guías de interfaz: confirmación en línea para descartar un vínculo o rechazar una alerta, filtros de
  la cola y de alertas en la URL, login que valida al enviar y lleva el foco al campo, `spellcheck`
  y `autocomplete` apagados donde corresponde, `scroll-padding` para que la bandera fija y la barra
  de decisión no tapen el foco, selección, caret, scrollbar y `accent-color` con la paleta,
  `touch-action: manipulation`, `overscroll-behavior` en el panel.
- Accesibilidad: el borde de los campos pasó a Lápiz (antes `#8ea2c2`, menos de 3:1 contra blanco).
  Verificado con teclado: orden de foco, foco visible, Enter abre una cita y Escape devuelve el foco.
- `impeccable detect` sobre `apps/console/src`: 0 antipatrones; queda un aviso por el papel
  cuadriculado, que es el mundo Cuaderno fijado por el brief.

### Cómo correrla

- Simulado: `pnpm --filter @blindaje/console dev` (sin variables) y entrar con las cuentas ficticias
  de la pantalla de login (contraseña `demo-blindaje`).
- API real: `VITE_API_URL=https://<api> pnpm --filter @blindaje/console dev`. La API debe permitir
  el origen de la consola en CORS (`ALLOWED_ORIGINS`) con `authorization` y `content-type`.
- Desplegar: `pnpm --filter @blindaje/console deploy:mock` o
  `VITE_API_URL=https://<api> pnpm --filter @blindaje/console deploy`.

### Pendiente y propuestas de contrato

- `AlertView` sin nombre de organización: el analista ve el id (`org-…`). Propuesta: `org_name`.
- No hay `GET` para listar expedientes: la consola recuerda en la pestaña los que generó. Propuesta:
  `GET /v1/console/networks/:id/expedientes`.
- `OrgView`, `UserView` y sus cuerpos de creación no están en `packages/shared`: hoy son tipos
  locales en `apps/console/src/api/types.ts`. Propuesta: moverlos a shared.
- Propuesta para shared: exportar los tipos de `ExpedienteView`, `HypothesisView`,
  `AuditVerifyResponse`, `AudioFragment`, `GraphNode` y `GraphEdge`.
- Nodos `voz` e `imagen` sin `data.evidencia`: el panel del grafo no puede citar su evidencia.
- `CostsResponse.pct` se interpreta en porcentaje (0 a 100).
