# App móvil: Cuaderno

App Expo (SDK 58, React Native 0.88, Expo Router, TypeScript estricto) disfrazada de cuaderno de
ventas de bodega. Por dentro tiene las **Notas privadas**, donde una persona extorsionada guarda
audios, mensajes y fotos de las amenazas y prepara su denuncia. Bitácora y decisiones en
[`docs/devlog/mobile.md`](../../docs/devlog/mobile.md).

`apps/mobile` es un proyecto **npm** independiente, fuera del workspace de pnpm (decisión D2).

## Correr

```bash
cd apps/mobile
npm install
npm run sync-shared          # copia packages/shared/src a src/shared (la copia se sube al repo)
npm run typecheck
npm test                     # jest-expo
```

La app usa módulos nativos (SQLCipher, recibir archivos compartidos, prevención de capturas), así
que **no funciona en Expo Go**: necesita un development build.

```bash
# Android local (Windows): JDK 21 de Android Studio
export JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$ANDROID_HOME/emulator/emulator -avd Medium_Phone_2 &
npx expo prebuild --platform android      # genera android/ (no se sube al repo)
npx expo run:android                       # build debug + Metro
npx expo run:android --variant release     # build release con el bundle incluido (para capturas)
```

`android/` e `ios/` se generan con `prebuild`. Toda la configuración nativa vive en
`app.config.ts` y en config plugins.

### Variables de build

| Variable | Valor | Efecto |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://blindaje-api.<cuenta>.workers.dev` | API real (sin `/v1`). |
| `EXPO_PUBLIC_MOCK_API` | `1` | Servidor simulado en memoria que respeta los esquemas de `packages/shared/src/api.ts`. También se activa si no hay `EXPO_PUBLIC_API_URL`. Todo su contenido es ficticio. |
| `EXPO_PUBLIC_DEMO_SEED` | `1` | Llena el cuaderno con ventas y fiados ficticios la primera vez. |
| `EXPO_PUBLIC_ALLOW_SCREENSHOTS` | `1` | **Inseguro para uso real.** Desactiva la prevención de capturas en las pantallas privadas. Existe solo para sacar las capturas del demo, la landing y el README. Nunca en un build para personas reales. |

Ejemplo de build para capturas del demo:

```bash
EXPO_PUBLIC_MOCK_API=1 EXPO_PUBLIC_DEMO_SEED=1 EXPO_PUBLIC_ALLOW_SCREENSHOTS=1 npx expo run:android --variant release
```

En el simulador, cualquier código de invitación de 4 a 32 letras, números o guiones funciona (por
ejemplo `BODEGA-2026`); los que empiezan con `NO` devuelven 404 para probar el error.

## Cómo funciona

### Disfraz y entradas secretas

- Tres disfraces que funcionan de verdad y guardan en `cuaderno.db`: **Cuaderno de ventas** (ventas,
  fiados, total del día), **Lista de compras** y **Calculadora de vueltos**. Se elige en el onboarding
  y en Ajustes.
- Nombre `Cuaderno`, esquema `cuaderno://` y paquete `pe.bodega.cuaderno`: nada en el launcher ni en
  Ajustes del sistema menciona el proyecto.
- Entradas secretas configurables: **mantener presionado el título 2 s** o **anotar una venta de
  S/ 18.18** (o el monto que se elija). Las dos abren la **calculadora de vuelto**, que es el teclado
  del PIN: se escribe el PIN en "Pagó con" y se toca "Calcular". Si no coincide, la calculadora
  muestra el vuelto como si nada. Tras 5 intentos fallidos deja de probar PIN por 60 s, en silencio.
- **PIN señuelo**: abre unas notas privadas vacías y creíbles. Lo que se "guarde" ahí no se sube.
- `test/disguise-words.test.tsx` recorre todos los textos del disfraz (y las pantallas renderizadas)
  contra `DISGUISE_FORBIDDEN_WORDS`.

### Todo vive en la nube (D1)

1. Al capturar, el archivo se cifra con **AES-256-GCM** (`@noble/ciphers`, IV de 96 bits nuevo en
   cada cifrado, llave en el Keystore vía `expo-secure-store`) y el original en claro se borra.
2. La cola (`src/sync/queue.ts`) lo sube a `POST /v1/cases/:id/evidence` con su SHA-256.
3. Si el servidor confirma **el mismo SHA-256**, el archivo se borra del celular. Si no hay
   conexión, queda cifrado y se reintenta (5 s, 15 s, 45 s… hasta 10 min), también desde el disfraz.
4. La interfaz dice dónde está cada cosa: "Guardado cifrado, fuera de este celular", "Subiendo,
   cifrado…" o "N notas esperan conexión".
5. El reporte del servidor (transcripciones, "Lo que encontramos") vive solo en memoria y se
   olvida al bloquear.

### Seguridad del dispositivo

- **Salir rápido** en todas las pantallas privadas: bloquea, limpia la pila y vuelve al disfraz. El
  botón "atrás" del sistema en las notas hace lo mismo.
- **Bloqueo** al pasar a segundo plano y **cubierta neutra** cuando la ventana pierde el foco. En
  Android, FLAG_SECURE (prevención de capturas) además deja en blanco la miniatura del selector de apps.
- **Cero notificaciones**: `POST_NOTIFICATIONS` bloqueado en el manifiesto; los avisos del gremio
  solo se ven dentro de la app ("Avisos del proveedor").
- **Nada en la galería ni en archivos recientes**: cámara dentro de la app (`expo-camera`), todo en
  el sandbox privado, `allowBackup=false`, portapapeles limpio después de pegar.
- **Base cifrada**: `notas.db` con SQLCipher (`expo-sqlite` con `useSQLCipher`), llave de 256 bits
  en el Keystore.
- **Llave del dispositivo P-256** (`@noble/curves`): la privada en el Keystore; el refresh firma
  `refresh:${device_id}:${timestamp}` (IEEE P1363), verificado contra WebCrypto en los tests.
- **Borrado de emergencia** (Ajustes): cierra la sesión en el servidor, borra la base cifrada, la
  cola, la caché y todas las llaves. La app queda como un cuaderno común; lo ya subido sigue en la nube.

### Pantallas

| Ruta | Pantalla |
|---|---|
| `/` | Disfraz elegido (cuaderno, lista o vueltos) |
| `/anotar` | Anotar venta o fiado |
| `/calculadora` | Calculadora de vuelto y teclado del PIN |
| `/bienvenida/*` | Onboarding privado: código de invitación, PIN, PIN señuelo, disfraz, muestra de voz, consentimiento |
| `/privado` | Notas privadas |
| `/privado/grabar` | Grabar (mantener presionado, onda y tiempo, transcripción con datos resaltados) |
| `/privado/foto` | Foto con la cámara de la app o una foto que ya existe |
| `/privado/pegar` | Pegar mensaje |
| `/privado/recibido` | Archivos compartidos desde otra app, retenidos hasta aceptarlos |
| `/privado/nota` | Detalle de una nota con su huella SHA-256 |
| `/privado/denuncia` | Preparar mi denuncia (4 pasos) |
| `/privado/lista` | Denuncia lista: resumen, cronología, evidencia, consentimiento comunitario, PDF, 1818 y 105 |
| `/privado/avisos` | Avisos del proveedor |
| `/privado/ajustes` | PIN, disfraz, entradas secretas, consentimiento, borrado |

### Estructura

```
src/app/          rutas de Expo Router
src/disguise/     disfraces, calculadora de vuelto, entradas secretas y sus textos
src/private/      notas privadas: datos en memoria, filas, transcripción, pantalla privada
src/onboarding/   borrador del onboarding
src/security/     AES-GCM, SHA-256, PIN, llave P-256, salir rápido, borrado
src/sync/         cola de subida cifrada
src/storage/      SQLite (cuaderno.db) y SQLCipher (notas.db), archivos de la cola
src/api/          cliente tipado y servidor simulado
src/shared/       copia generada de packages/shared/src (no editar)
test/             jest-expo
```

## Pendiente

- Íconos alternativos en el launcher (activity-alias por disfraz): los PNG ya están en
  `assets/images/*-lista.png` y `*-vueltos.png`; falta el config plugin y un módulo nativo que
  cambie el alias activo. Hoy el disfraz cambia la pantalla de inicio, no el ícono.
- Muse Glimmer no corre en el celular (D6): ver el devlog.
