# Devlog: cliente de la Meta Model API (`packages/meta-client`)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 01:05 · Documentación leída y decisiones

- La documentación oficial tiene versión Markdown de cada página: `https://dev.meta.ai/docs/<página>.md`
  (índice en `https://dev.meta.ai/llms.txt`). Leídas: responses, structured-output, tool-calling,
  reasoning, speech-to-text, media-segmentation, sam/overview, sam/segmenting,
  sam/reading-segmentation, sam/client-libraries, file-handling, image-generation,
  pricing-rate-limits, error-handling y las referencias de transcribe, files e images.
- Cliente propio sobre `fetch`, sin SDK y sin APIs de Node. Se typechequea dos veces: con
  `@types/node` y con `@cloudflare/workers-types` (`tsconfig.workers.json`, solo `src`), porque
  `services/api` compila nuestro `src` con los tipos de Workers.
- `@meta-sam/parser@0.1.0`: ESM puro, cero dependencias, sin `node:` ni `Buffer`. Funciona en
  Workers (verificado en workerd, ver 01:40). Usamos su `decodeMaskToRaster`: la carga de la
  máscara es base85 con un códec aritmético propio, no vale la pena reescribirlo. El parseo de
  líneas `<Nf>id<|box…|><|mask…|>` es propio (`src/sam.ts`) para devolver el token crudo de la
  máscara; un test compara nuestras cajas y máscaras con las del parser oficial sobre capturas
  reales. Ojo: su licencia es la "SAM License" de Meta, no una licencia OSI.
- `responses.parse` y SAM mandan `store: false` por defecto (la evidencia no queda guardada en
  Meta). El bucle de agente usa `store: true` + `previous_response_id`, como pide la
  documentación, y reenvía `instructions`, `tools`, `reasoning` y `text` en cada turno.
- El subconjunto strict se revisa localmente antes de llamar (raíz objeto, sin allOf/oneOf,
  `additionalProperties: false` y `required` completo): un esquema con `.optional()` falla en
  local con un mensaje que sugiere `.nullable()`.
- En el último turno permitido el agente va sin herramientas y con un mensaje que pide la
  respuesta final (no existe `tool_choice: "none"`).

## 2026-10-28 01:21 · Formato observado: SAM 3.1 (imagen, SSE)

Imagen de prueba generada (256×192: círculo rojo de radio 48 en 80,96 y un cuadrado azul),
concepto `circle`. Capturas crudas en `packages/meta-client/test/fixtures/sam-image-*.sse`.

- `Content-Type: text/event-stream`, header `x-request-id`. Cada evento trae línea `event:` y
  `data:` con JSON que **también** incluye `type` y `sequence_number`. Termina con `data: [DONE]`.
- Secuencia: `response.created` → `response.in_progress` → `response.output_item.added` →
  `response.content_part.added` → **un** `response.output_text.delta` por frame →
  `response.output_text.done` → `response.content_part.done` → `response.output_item.done` →
  `response.completed`.
- Cada delta es una línea completa **terminada en `\n`**:

```text
<0f>0<|box;x1=33;y1=49;x2=127;y2=143;w=256;h=192;c=0.9139785170555115|><|mask;x=0;y=0;c=0.9139785170555115;data=95,95,~!!!F[#K{$focc…|>\n
```

- Solo devolvió el círculo (el cuadrado no), con confianza 0.914. Caja inclusiva en píxeles de
  la fuente. **La máscara es un raster del tamaño exacto de la caja** (H = y2−y1+1 = 95,
  W = x2−x1+1 = 95) anclado en (x1, y1): decodificada tiene 7179 píxeles encendidos (área teórica
  del círculo ≈ 7238) y la caja ajustada a la máscara coincide con la caja de SAM.
- `metadata.mask_encoding: "one_bit"` → marcador `!` y carga mucho más chica para el mismo
  círculo: 88 caracteres contra 3,473 de `~` lossless (el lossless guarda cobertura parcial de
  borde; el decodificador la umbraliza a 0/1).
- `usage` en `response.completed`: `{"images_processed":1,"input_tokens":0,"output_tokens":0,…}`.
- `store: false` aceptado; `response.created` repite `metadata`.

## 2026-10-28 01:21 · Formato observado: Voice Transcribe (archivo)

WAV de prueba: diálogo ficticio de 13.9 s en español con dos voces (TTS de Windows; la segunda
con el tono bajado por ffmpeg), mono PCM16 a 16 kHz. Script: `scripts/make-audio-fixture.ps1`.
Multipart armado a mano: parte `request` con `Content-Type: application/json` y sin nombre de
archivo, parte `audio` con `filename="audio.wav"` y `Content-Type: audio/wav`.

```json
{"sessionId":"voyager/transcribe/0453817EC90F4899BC687D51784A469B",
 "transcript":"Hola, habla el jefe. Tienes que yapear quinientos soles de cupo antes del viernes. No tengo esa plata. Por favor, denme más ese plazo.",
 "audioDurationMs":14000,
 "turns":[{"turnId":0,"startMs":60,"endMs":140,"transcript":""},
          {"turnId":1,"startMs":140,"endMs":6940,"transcript":"Hola, habla el jefe. …","speaker":"A"},
          {"turnId":2,"startMs":7740,"endMs":13500,"transcript":"No tengo esa plata. …","speaker":"B"}]}
```

- La diarización separó bien las dos voces (A y B). "yapear", "soles" y "cupo" salieron bien
  con `keywords`.
- **Sin header `x-request-id`** (los demás endpoints sí lo traen): el id de correlación es
  `sessionId`, que el cliente devuelve y usa como `response_id` en `onUsage`.
- `audioDurationMs` = 14000 para un archivo de 13.92 s; se factura `floor(14000/1000)` = 14 s.
- Un turno inicial de 80 ms con texto vacío y sin `speaker`: el cliente descarta los turnos
  vacíos (`keepEmptyTurns: true` los conserva). En otra corrida no apareció y los `turnId`
  empezaron en 0. El texto varía un poco entre corridas ("No tengo tengo esa plata").

## 2026-10-28 01:27 · Primera corrida live: 6 de 7

- Falló el video: un cuadrado rojo de 32 px en un clip de 160×120 con el concepto `red square`
  dio **cero coincidencias, pero se facturaron 50 frames** (0.01 USD). Lección: un video sin
  coincidencias igual cuesta el mínimo. El test ahora usa un clip de 2 s a 10 fps de la imagen
  del círculo, que SAM sí detecta.

## 2026-10-28 01:33 · Segunda corrida live: 7 de 7

| Prueba | Resultado | Unidades | Costo (USD) |
|---|---|---|---|
| `listModels` | incluye `muse-spark-1.1`, además de los ya anotados en DEVLOG.md | — | 0 |
| Estructurada strict, `reasoning.effort: "minimal"` | `{"canal":"yape","monto_soles":500,"plazo_horas":48,…}`; salida `[reasoning, message]` | 167 in, 343 out (297 de razonamiento) | 0.00167 |
| Agente con 2 herramientas y `finalSchema` | 3 turnos: 2 `obtener_caso` en paralelo, luego `sumar`, luego JSON `{"total_soles":750}` | 2,726 in (2,387 en caché), 473 out | 0.00279 |
| Transcribe DIARIZATION | A: 0–6700 ms, B: 7740–13500 ms | 14 s | 0.00070 |
| SAM imagen (`circle`, con confianza) | 1 objeto, caja 33,49–127,143, c = 0.914 | 1 imagen | 0.00250 |
| SAM video por `file_id` | 20 frames (0–19), mismo id 0 en todos | `video_frames_processed: 50` | 0.01000 |
| Files upload / delete | `status: "uploaded"`, `expires_at` = created_at + 3600; delete → `deleted: true` | — | 0 |

Total de la corrida: **≈ 0.0177 USD**.

- `text.format` json_schema strict **se combina bien con herramientas**: el modelo llama
  herramientas y la respuesta final sale con el esquema.
- Zod `.nullable()` genera `"type": ["number","null"]` y strict lo acepta.
- Con `previous_response_id` los turnos siguientes vienen con caché (881 de 944 tokens).
- Incluso con `minimal`, una extracción mínima usó ~300 tokens de razonamiento (más que la salida
  visible): el razonamiento domina el costo de las llamadas cortas.

## 2026-10-28 01:40 · Verificación en workerd

Bundle de `src/index.ts` con esbuild (0 imports `node:`, 9 módulos de `@meta-sam/parser`)
ejecutado con `wrangler dev --local` (workerd, `compatibility_date` 2026-10-01, sin
`nodejs_compat`). Dentro del Worker: `segmentImage` con el SSE real entregado en trozos de 777
bytes y `decodeMask` (7179 píxeles, igual que en Node); `transcribe` con multipart
(`crypto.getRandomValues`) y un WAV armado en memoria; y una llamada real a `GET /v1/models`
con el `fetch` global. Todo OK.

## Diferencias entre la documentación y la realidad

1. Voice Transcribe no manda `x-request-id`; el correlativo es `sessionId`
   (`voyager/transcribe/<hex>`).
2. Voice Transcribe puede devolver un turno vacío, sin `speaker`, al inicio; la documentación
   muestra turnos siempre con texto y numerados desde 1.
3. SAM en imagen reporta `usage.images_processed: 1`; la documentación solo menciona
   `video_frames_processed` (para video).
4. La documentación dice que la máscara es "más chica que el frame"; en la práctica es
   exactamente del tamaño de la caja y se ancla en (x1, y1).
5. Cada delta de SAM termina en `\n` (la documentación habla de "una línea por evento" sin
   mencionar el salto).
6. La página de salida estructurada solo muestra Chat Completions (`response_format`); en la
   Responses API el formato es plano: `text.format = {type, name, schema, strict}`. Confirmado
   con llamadas reales.
7. La página de la Responses API lista los niveles de `reasoning.effort` sin `max`; la de
   razonamiento sí lo incluye para `muse-spark-1.3` y `muse-wonder-1.0`.

## Gasto del frente (desarrollo completo)

Capturas de fixtures 0.0157 + primera corrida live 0.0198 + segunda corrida 0.0177 + humo 0.0044
≈ **0.058 USD**. Una corrida de `test:live` cuesta ≈ 0.018 USD (≈ 0.008 sin video, con
`LIVE_VIDEO=0`).

## Cómo correr

```bash
pnpm --filter @blindaje/meta-client typecheck   # Node y Workers
pnpm --filter @blindaje/meta-client lint
pnpm --filter @blindaje/meta-client test        # unitarios, fetch simulado
pnpm --filter @blindaje/meta-client test:live   # API real; LIVE_VIDEO=0 salta el video
pnpm --filter @blindaje/meta-client smoke       # humo; `-- --all` agrega Transcribe y SAM
pnpm --filter @blindaje/meta-client exec tsx scripts/capture-fixtures.ts image   # rehace capturas
```
