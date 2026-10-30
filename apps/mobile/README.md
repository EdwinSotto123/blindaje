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

En el simulador, el registro no pide código: el celular queda en la organización central
(`org-central`), como en el API. Si llega un código de invitación (los APK antiguos lo mandan), se
valida como antes: de 4 a 32 letras, números o guiones, y los que empiezan con `NO` devuelven 400
`bad_request` para probar el error. Los avisos y recomendaciones del simulador son de San Juan de
Lurigancho y San Juan de Miraflores: con otro distrito elegido, la pantalla de avisos sale vacía.

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

### Sin código, por distrito (rediseño del 28/10)

- La víctima reporta directo, sin código de invitación (`docs/rediseno.md`). "Empezar" registra el
  celular con su llave P-256 y espera como mucho 8 s. Sin internet, la configuración sigue igual: la
  primera llamada que necesita sesión (la muestra de voz o la primera subida de la cola) lo registra.
- El distrito se elige de la lista fija de los 50 de Lima Metropolitana y el Callao
  (`src/shared/zones.ts`): con búsqueda (también SJL, VES, Surco, Chosica), agrupado por área y sin
  internet. Se guarda el id y va en `zona` al crear un caso. "Prefiero no decirlo" no manda nada.
  Nunca una dirección; el texto libre de versiones anteriores solo se manda si es un distrito.
- En Ajustes se cambia el distrito: vale para los casos nuevos y para los avisos. El caso actual
  conserva el suyo. Avisos y recomendaciones se piden con `?zona=<id del distrito>`.

### Seguridad del dispositivo

- **Salir rápido** en todas las pantallas privadas: bloquea, limpia la pila y vuelve al disfraz. El
  botón "atrás" del sistema en las notas hace lo mismo.
- **Bloqueo** al pasar a segundo plano y **cubierta neutra** cuando la ventana pierde el foco. En
  Android, FLAG_SECURE (prevención de capturas) además deja en blanco la miniatura del selector de apps.
- **Cero notificaciones**: `POST_NOTIFICATIONS` bloqueado en el manifiesto; los avisos de la zona,
  aprobados por el equipo central, solo se ven dentro de la app ("Avisos del proveedor").
- **Nada en la galería ni en archivos recientes**: cámara dentro de la app (`expo-camera`), todo en
  el sandbox privado, `allowBackup=false`, portapapeles limpio después de pegar.
- **Base cifrada**: `notas.db` con SQLCipher (`expo-sqlite` con `useSQLCipher`), llave de 256 bits
  en el Keystore.
- **Llave del dispositivo P-256** (`@noble/curves`): la privada en el Keystore; el refresh firma
  `refresh:${device_id}:${timestamp}` (IEEE P1363), verificado contra WebCrypto en los tests.
- **Borrado de emergencia** (Ajustes): cierra la sesión en el servidor, borra la base cifrada, la
  cola, la caché y todas las llaves. La app queda como un cuaderno común; lo ya subido sigue en la nube.

### Llamadas y widget (Android, módulo nativo local)

`modules/cuaderno-nativo` es un módulo Expo local (Kotlin) que se enlaza solo al compilar. No pide
permisos nuevos en el manifiesto: ni contactos, ni registro de llamadas, ni notificaciones.

- **Llamadas** (`/privado/llamadas`, apagado hasta que la persona lo activa; Android 10+). Un
  `CallScreeningService` anota la hora y el número de las llamadas entrantes de números que **no están
  en los contactos** (Android solo le pasa esas). La persona revisa cada una:
  - **Fue extorsión**: puede escribir qué le dijeron y adjuntar la grabación (selector de archivos del
    sistema). Se guarda en su denuncia por la cola cifrada como nota de texto con `source: "llamada"` y
    la hora de la llamada; el número queda marcado.
  - **No era**: se borra del celular. Nunca se sube.
  - Ella elige qué se anota (todas las desconocidas o solo las marcadas) y qué pasa si vuelve a llamar
    un número marcado: que suene (por defecto), silenciar o rechazar. El filtro nunca bloquea por su
    cuenta.
  - Ninguna app puede grabar la voz de una llamada en Android 10+ ni con la política de Google Play
    (desde mayo de 2022). La pantalla explica cómo activar la grabación automática del teléfono del
    celular (Samsung, Xiaomi, Teléfono de Google) y adjuntar ese audio.
  - Lo anotado y los números marcados se guardan cifrados (AES-256-GCM, llave del Keystore) en
    `noBackupFilesDir`. Lo que no se revisa se borra a los 30 días; como mucho 300 llamadas.
  - **Costo para el disfraz**: Android pide elegir a Cuaderno como "app de identificación de llamadas",
    y ese nombre se ve en Ajustes del teléfono. La pantalla lo dice antes de activar.
  - En modo señuelo no aparece ni se lee nada. El borrado de emergencia apaga el filtro y borra lo
    anotado, los números y la llave. Quitar a Cuaderno del rol solo lo puede hacer la persona en Ajustes
    del teléfono; la pantalla la lleva ahí.
- **Widget** "Cuaderno" (4×1): sigue al disfraz elegido. Cuaderno de ventas: "Anotar venta" y "Anotar
  fiado" (`cuaderno://anotar`); lista y vueltos: abren la app. Nunca muestra ni abre nada privado: a las
  notas se llega como siempre, con la entrada secreta (por ejemplo, anotar una venta de S/ 18.18) y el
  PIN. `test/disguise-words.test.tsx` revisa también sus textos.

### Pantallas

| Ruta | Pantalla |
|---|---|
| `/` | Disfraz elegido (cuaderno, lista o vueltos) |
| `/anotar` | Anotar venta o fiado |
| `/calculadora` | Calculadora de vuelto y teclado del PIN |
| `/bienvenida/*` | Onboarding privado: bienvenida (registra el celular), PIN, PIN señuelo, disfraz, muestra de voz, consentimiento y distrito |
| `/privado` | Notas privadas |
| `/privado/grabar` | Grabar (mantener presionado, onda y tiempo, transcripción con datos resaltados) |
| `/privado/foto` | Foto con la cámara de la app o una foto que ya existe |
| `/privado/pegar` | Pegar mensaje |
| `/privado/recibido` | Archivos compartidos desde otra app, retenidos hasta aceptarlos |
| `/privado/nota` | Detalle de una nota con su huella SHA-256 |
| `/privado/denuncia` | Preparar mi denuncia (4 pasos) |
| `/privado/lista` | Denuncia lista: resumen, cronología, evidencia, consentimiento comunitario, PDF, 1818 y 105 |
| `/privado/avisos` | Avisos del proveedor: avisos y recomendaciones de su distrito |
| `/privado/llamadas` | Llamadas: revisar las anotadas, marcar extorsión, adjuntar la grabación, ajustes del filtro |
| `/privado/ajustes` | PIN, disfraz, entradas secretas, distrito, consentimiento, borrado |

### Estructura

```
src/app/          rutas de Expo Router
src/disguise/     disfraces, calculadora de vuelto, entradas secretas y sus textos
src/private/      notas privadas: datos en memoria, filas, transcripción, pantalla privada
src/onboarding/   borrador del onboarding
src/security/     AES-GCM, SHA-256, PIN, llave P-256, salir rápido, borrado
src/sync/         cola de subida cifrada
src/native/       puente con el módulo nativo local (llamadas y widget)
modules/          módulo Expo local cuaderno-nativo (Kotlin: filtro de llamadas, registro cifrado, widget)
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
