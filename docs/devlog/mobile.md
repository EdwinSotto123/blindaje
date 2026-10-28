# Devlog: app móvil (`apps/mobile`)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 01:10 · Arranque y versiones verificadas

- `npm view expo version` → **58.0.20** (latest). Plantilla `expo-template-default@58.0.29`
  (`create-expo-app --template default@sdk-58`): React Native **0.88.0**, React **19.3.0**,
  Expo Router **58.0.27**, TypeScript **6.0**.
- `apps/mobile` es un proyecto **npm** independiente, fuera del workspace de pnpm (D2). Tiene su
  propio `package-lock.json`. Los contratos se copian de `packages/shared/src` con
  `npm run sync-shared` (`scripts/sync-shared.mjs`, encabezado "archivo generado, no editar";
  `--check` falla si la copia quedó vieja).
- Librerías, todas instaladas con `npx expo install` (versiones resueltas para SDK 58):

| Librería | Versión | Nota |
|---|---|---|
| expo-sqlite | 58.0.14 | **SQLCipher** soportado con el plugin `{ useSQLCipher: true }` (solo build nativo). `PRAGMA key` justo después de abrir |
| expo-secure-store | 58.0.2 | `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; `configureAndroidBackup: false` |
| expo-audio | 58.0.10 | `useAudioRecorder` + `useAudioRecorderState` (metering). Plugin con `enableBackgroundPlayback: false` (si no, agrega un servicio en primer plano con notificación) |
| expo-camera | 58.0.13 | `CameraView` dentro de la app: la foto queda en caché, nunca en la galería |
| expo-image-picker | 58.0.10 | Solo para elegir una foto que ya existe (Photo Picker, sin permiso de almacenamiento) |
| expo-screen-capture | 58.0.6 | `usePreventScreenCapture` (FLAG_SECURE en Android) |
| expo-sharing | 58.0.20 | PDF de la denuncia |
| expo-file-system | 58.0.12 | API nueva (`File`, `Directory`, `Paths`) |
| expo-crypto | 58.0.7 | `getRandomBytes` para IV y llaves |
| expo-network | 58.0.4 | Estado de conexión para la cola |
| expo-clipboard | 58.0.4 | "Pegar mensaje" |
| expo-share-intent | 9.0.0 | Su README: SDK 58 → 9.0+. Peer `expo ^58`. Copia el archivo compartido a `cacheDir` |
| react-native-svg | 15.16.0 | Papel cuadriculado e íconos de trazo |
| @expo-google-fonts/atkinson-hyperlegible, /kalam | 0.4.1 | 400 y 700 |
| @noble/ciphers | 2.4.0 | AES-256-GCM (`@noble/ciphers/aes.js`) |
| @noble/curves | 2.4.0 | P-256 (`@noble/curves/nist.js`), firma compacta = IEEE P1363 |
| @noble/hashes | 2.4.0 | SHA-256 y PBKDF2 |
| zod | 4.x | Los esquemas compartidos validan cada respuesta de la API |
| jest-expo | 58.0.12 | Jest 30, @testing-library/react-native 14 |

- `expo install` de `expo-share-intent` falló primero por un conflicto de peer de `react-dom`
  (19.3.1 vs react 19.3.0). Se resolvió instalando `react-dom@19.3.0` explícito.
- Build nativo: `npx expo prebuild --platform android` + `./gradlew assembleDebug
  -PreactNativeArchitectures=x86_64` con `JAVA_HOME` = JBR 21 de Android Studio: **BUILD
  SUCCESSFUL en 12 min 31 s**, sin problemas de ruta larga (la ruta del repo es corta y
  `LongPathsEnabled=1` en el registro). El `java` del PATH es un JDK 8: hay que exportar
  `JAVA_HOME` antes de cualquier comando de Gradle.

### Decisiones

- **Nombre, esquema y paquete neutrales**: `Cuaderno`, `cuaderno://`, `pe.bodega.cuaderno`. Nada
  en el launcher, en Ajustes del sistema ni en el selector de apps menciona el proyecto.
- **Permisos bloqueados** en el manifiesto: `POST_NOTIFICATIONS` (cero notificaciones),
  almacenamiento y medios, servicios en primer plano, arranque al encender. `allowBackup=false`.
- **Dos bases**: `cuaderno.db` (datos del disfraz, inofensivos) y `notas.db` cifrada con
  SQLCipher (cola, archivos retenidos, notas del señuelo). La evidencia confirmada por el servidor
  no queda en el celular; el reporte del servidor se guarda solo en memoria y se borra al bloquear.
- **PIN**: PBKDF2-SHA256 con sal, dentro del almacenamiento seguro. Se compara siempre contra el
  PIN y el señuelo para no delatar cuál coincidió. Después de 5 intentos fallidos la calculadora
  deja de probar PIN durante 60 s, en silencio.
- **Teclado del PIN = calculadora de vuelto real** (Total / Pagó con). Si lo último que se tecleó
  en el campo activo son de 4 a 8 dígitos, se prueba como PIN; si no coincide, la calculadora
  muestra el vuelto como si nada.

## 2026-10-28 03:30 · Pantallas, cola cifrada, tests

### Hecho

- **Disfraces** (funcionan de verdad, `cuaderno.db`): Cuaderno de ventas (ventas, fiados, total del
  día, borrar con pulsación larga, fiado pagado con un toque), Lista de compras y Calculadora de
  vueltos. El cuaderno abre la calculadora con un botón directo (no un menú modal de un solo ítem).
- **Entradas secretas**: mantener presionado el título 2 s y monto secreto (S/ 18.18 por defecto),
  configurables en el onboarding y en Ajustes (la app no deja apagar las dos). Una venta con el
  monto secreto no se anota.
- **Calculadora de vuelto = teclado del PIN** (`src/disguise/vuelto.ts`). PIN señuelo → notas vacías
  y creíbles; lo que se "guarda" ahí queda solo como fila local (`senuelo`) y nunca se sube.
- **Onboarding privado** (7 pasos): código de invitación (registra la llave P-256), PIN, PIN señuelo,
  disfraz y entradas, muestra de voz de 10 s (se sube y se borra), consentimiento (solo mi denuncia
  siempre activo, comunitario apagado) con sector y distrito opcionales, y resumen de cómo entrar.
- **Notas privadas** con chip honesto: "Guardado cifrado, fuera de este celular", "Subiendo,
  cifrado…" o "N notas esperan conexión". Cada fila dice su estado. "Lo que encontramos" se llena
  con `hallazgos` del reporte del servidor.
- **Grabar** (mantener presionado, onda con metering, tiempo; modo tocar para lectores de pantalla),
  **Foto** (cámara dentro de la app; o elegir una foto existente con el Photo Picker), **Pegar
  mensaje** (limpia el portapapeles al guardar), **Archivos recibidos** desde WhatsApp (retenidos
  hasta aceptarlos con el PIN), **detalle de nota** con transcripción resaltada y SHA-256,
  **Preparar mi denuncia** (4 pasos), **Denuncia lista** (resumen, ficha, cronología, evidencia con
  huella, interruptor comunitario con confirmación, PDF con expo-sharing, Línea 1818, botón fijo del
  105), **Avisos del proveedor** y **Ajustes** (disfraz, entradas, PIN, consentimiento, borrar caso
  de la nube, borrado de emergencia).
- **Cola cifrada** (`src/sync/queue.ts`): AES-256-GCM con AAD = id de la fila; se borra el archivo
  solo si el servidor confirma el mismo SHA-256; reintentos 5 s · 15 s · 45 s… hasta 10 min; corre
  también desde el disfraz (cada 20 s y al volver la conexión).
- **Servidor simulado** (`src/api/mock.ts`) con el mismo contrato: registro, refresh, casos,
  evidencia (422 si la huella no coincide), reporte que se "procesa" en segundos, submit, PDF mínimo
  válido, consentimiento, alertas y muestra de voz. Contenido ficticio.
- **Tests (jest-expo, 69)**: cifrado (ida y vuelta, IV único en 500 cifrados, manipulación, AAD,
  interoperabilidad con WebCrypto), firma P-256 verificada con WebCrypto (P1363), PIN y señuelo,
  entradas secretas (monto y 2 s con temporizadores falsos), calculadora y freno de intentos, salir
  rápido (bloquea, limpia la pila, el contenido desaparece), bloqueo al pasar a segundo plano, cola
  (cifrado en disco, borrado tras confirmar, huella distinta no borra, sin conexión reintenta,
  retenidos), punta a punta con el simulador, esquemas Zod y `VICTIM_FORBIDDEN_KEYS`, palabras
  prohibidas sobre los textos y las pantallas renderizadas del disfraz y sobre nombre/esquema/paquete,
  contraste ≥ 4.5:1 de todos los pares de tokens y borrado de emergencia.

### Problemas y soluciones

- **TypeScript 6** ya no incluye `@types/*` por defecto: `tsconfig.json` declara `types: ["jest", "node"]`.
- **@testing-library/react-native 14** es asíncrona: `await render`, `await fireEvent.press`,
  `await renderHook`, `await act`.
- **Permisos**: el diálogo del sistema pausa la actividad y RN reporta `background`, lo que habría
  bloqueado las notas. Antes de pedir micrófono o cámara, y al abrir el selector de fotos o la hoja
  de compartir, la app marca `expectExternal()`; vence solo y se limpia al volver a `active`.
- **`File.write` es asíncrono** en el expo-file-system de SDK 58: hay que esperarlo antes de leer o
  compartir.
- **PDF de la denuncia**: no se borra apenas vuelve la hoja de compartir (la app de destino puede
  leerlo después); se borra al bloquear y al abrir la app.
- **Emulador**: se apagó dos veces solo cuando corría dentro de una consola de Git Bash (recibía la
  señal de cierre de la consola); con `Start-Process` quedó estable. Metro en modo no interactivo
  dentro de una consola separada falló con `kill ENOSYS`: correrlo en una terminal normal.
- **A pedido del orquestador** (RAM de la máquina del equipo) se apagaron emulador, Metro y Gradle.
  El build nativo de Android ya había pasado (12 min 31 s) y la app arrancó en el emulador hasta la
  pantalla de bienvenida con el ícono del disfraz; las capturas de `docs/screenshots/` quedan para
  la corrida única final.

### Ajustes por los skills de diseño (`.agents/skills`)

- Toques de **48 dp** (Material), por encima de los 44 del sistema Cuaderno.
- **Teclado**: con edge-to-edge (Android 15+) el sistema ya no achica la ventana; `Paper` usa
  `KeyboardAvoidingView` con `padding` en API 35+ e iOS.
- **Quitar animaciones**: la transición entre pantallas pasa a `none` si el sistema lo pide (180 ms
  de fundido si no).
- **Errores anunciados**: `Notice` con `accessibilityRole="alert"` y región viva.
- **Sin modal para una sola acción** (menú del cuaderno reemplazado por un botón directo).
- Se mantiene el tema claro: el papel cuadriculado es parte del disfraz y los tokens del diseño son
  claros. El monoespaciado solo se usa para las huellas SHA-256 (dato, no adorno).

### Muse Glimmer (D6)

Glimmer es un modelo denso de 30B (≈17 GB a 4 bits): no cabe en un celular de gama media ni con
ExecuTorch. Con D1 (todo vive en la nube) la ficha se arma en el servidor al llegar la evidencia y
"Lo que encontramos" se llena con el reporte. No se agregó ningún flag en la app: no hay modelo
que activar en el dispositivo.

### Íconos alternativos (siguiente paso)

Los PNG ya existen (`assets/images/*-lista.png`, `*-vueltos.png`, generados con
`scripts/make-icons.py`). Falta: config plugin con un `activity-alias` por disfraz (quitar
`LAUNCHER` de `MainActivity`), y un módulo nativo local que llame a
`PackageManager.setComponentEnabledSetting` al cambiar el disfraz. Ninguna librería publicada
declara soporte para SDK 58 y agregar código nativo sin poder compilarlo pondría en riesgo el build
final, así que se dejó para después.

### Qué necesita la app del API

- Para evidencia de tipo `texto`, devolver el texto como un turno en `transcripcion` (o un campo
  `preview`), para citarlo en la lista sin guardarlo en el celular. El simulador ya lo hace.
- Aceptar `audio/mp4` (AAC/M4A de expo-audio) en evidencia y en `/v1/me/voice-sample`
  (`docs/ML_API.md` dice que el normalizador acepta M4A).
- Si un caso ya no acepta evidencia (enviado), responder `409` o `404`: la app abre un caso nuevo y
  reintenta.
