# DEVLOG

Bitácora del proyecto. Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 00:30 · M0: arranque

- Leído completo el documento de diseño y las tres pantallas de `design/cuaderno/`.
- Herramientas: Node 22.18, pnpm 9.15, Python 3.13, uv, Docker 29, ffmpeg 7.1, gh (sesión
  activa), wrangler 4.154 (sesión activa; la cuenta ya tiene Containers, así que tiene Workers Paid).
  Android SDK con emulador `Medium_Phone_2` y JDK 21 de Android Studio. Sin sesión de Expo/EAS.
- Meta Model API verificada con la key del equipo: `GET /v1/models` lista `muse-spark-1.3`,
  `muse-spark-1.2`, `muse-wonder-1.0`, `muse-voice-transcribe-1.0`, `sam-3.1`, `muse-image-1.0`
  (y las variantes contributor, que no usamos).
- Llamada real a `POST /v1/responses` con `text.format` `json_schema` strict: devuelve un ítem
  `reasoning` (contenido cifrado) y un `message` con el JSON en `output_text`.

### Lo que dice la documentación oficial (y difiere o precisa el prompt)

- **Muse Glimmer** es un modelo denso de **30B parámetros** (texto + imagen, Apache-2.0). No es
  viable en un celular: incluso a 4 bits pesa unos 17 GB. Decisión D6: se documenta la
  evaluación, queda detrás de un flag y la ficha se arma en el servidor.
- **Tool calling**: solo `tool_choice: "auto"`; `none`, `required` o una función específica dan
  HTTP 400. El modelo puede responder texto sin llamar herramientas: el bucle lo maneja.
- **Responses API**: `truncation` solo `"disabled"`; cuerpo máximo 1 MiB; `reasoning.effort` no
  acepta `none` en Muse Spark; `include` no se combina con `previous_response_id`.
- **Voice Transcribe por archivo**: `multipart/form-data` con partes `request` (JSON con `model`,
  `mode`, `audioEncoding: "WAV"`, `languageBias`, `keywords`) y `audio` (WAV mono PCM16 de 16 o
  24 kHz). Máximo 32 MB y 10 minutos. Modo `DIARIZATION` devuelve `turns[]` con `speaker`,
  `startMs`, `endMs`.
- **SAM 3.1**: por la Responses API con `stream: true`. Un concepto por petición (frase nominal
  corta). Salida en tokens: `<0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|><|mask;x=..;y=..;data=H,W,~…|>`,
  máscaras en base85. Parsers oficiales `@meta-sam/parser` (npm) y `meta-sam-parser` (pip).
  Confianza con `metadata.include_confidence: "true"` (string). Video: MP4/MOV H.264, subir con
  Files API (`purpose=user_data`), mínimo 50 frames facturados por petición.
- **Precios** confirmados: Spark 1.25/4.25 USD por millón (cache 0.15), Wonder 4/20, SAM 2.50 por
  1,000 imágenes y 0.20 por 1,000 frames, Transcribe 0.18 USD por hora, Image 0.01.
- **Límites**: Spark 3,000 RPM; Image 150 RPM; Transcribe 256 streams concurrentes.

### Decisión del equipo: todo vive en la nube

A pedido del equipo, la evidencia ya no se queda solo en el celular: se sube a Cloudflare al
capturarla, se guarda cifrada (AES-256-GCM) en R2 y se procesa al llegar. Interpretamos
"accesible a todos" como accesible para todos los actores **autorizados** (la víctima y, según su
rol, revisores y analistas), no como público: exponer evidencia pondría en riesgo a las víctimas
y contradice la sección 5 del documento de diseño. Sin conexión, la evidencia espera cifrada en
el celular y se borra de ahí al confirmar la subida. Ver D1 en `PLAN.md`.

### Esqueleto

- Monorepo pnpm, TypeScript 5.9 estricto (TypeScript 7 todavía no es compatible con
  typescript-eslint), Vitest 4.1 (lo exige `@cloudflare/vitest-pool-workers`), Zod 4.
- `packages/shared`: enums, etiquetas citables, ficha, salidas de agentes, motor de vinculación,
  contrato de la API y reglas de seguridad. 12 tests, incluido uno que verifica que los esquemas
  de salida cumplen el subconjunto strict de Meta.
- `infra/migrations/0001_init.sql`: modelo de datos completo.
