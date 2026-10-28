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
