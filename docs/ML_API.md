# Contrato del contenedor de ML (`services/ml`)

Servicio Python 3.11+ con FastAPI, en el puerto `8080`. En producción corre como Cloudflare
Container (`blindaje-ml`) detrás del Worker; en local, con `docker run -p 8080:8080` o
`uvicorn`. El Worker lo usa mediante una interfaz `MlClient` con dos implementaciones: binding
de Containers o `ML_URL` (HTTP), para desarrollo y evaluación.

Todo corre en CPU. Si existe la variable `ML_TOKEN`, cada petición debe traer `x-ml-token`.
Vectores siempre normalizados L2 (`float32`), así que producto interno = coseno.

| Modelo | Uso | Dimensión | Licencia |
|---|---|---|---|
| SpeechBrain ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`) | huella de voz | 192 | Apache-2.0 |
| `intfloat/multilingual-e5-small` | embeddings del resumen_mo | 384 | MIT |
| DINOv2 ViT-S/14 (`facebook/dinov2-small`) | recortes de imagen | 384 | Apache-2.0 |
| FAISS (`faiss-cpu`) | índices `voz`, `voz_segmento`, `texto`, `imagen` (`IndexIDMap2(IndexFlatIP)`) | | MIT |
| networkx | comunidades (Louvain) y centralidad | | BSD-3 |
| AudioSeal de Meta (`facebook/audioseal`, detector de 16 bits) | marca de agua en audio generado | 16 bits | MIT (código y pesos) |
| Video Seal 1.0 de Meta (`facebookresearch/videoseal`, solo el extractor) | marca de agua en imagen y video | 256 bits | MIT |
| `c2pa-python` (SDK de C2PA 0.91) | credenciales de contenido | | MIT o Apache-2.0 |

## Endpoints

| Método | Ruta | Entrada | Salida |
|---|---|---|---|
| GET | `/health` | | `{ ok, models: {voice,text,image,audioseal,videoseal}, indices: {voz,voz_segmento,texto,imagen}, index_version }` |
| POST | `/audio/normalize` | cuerpo crudo (Opus, OGG, M4A, MP3, WAV, AAC) | `audio/wav` mono 16 kHz PCM16, header `x-duration-ms` |
| POST | `/voice/enroll` | cuerpo crudo de audio | `{ model, dim, vector }` (muestra de 10 s de la víctima) |
| POST | `/voice/embed` | `{ wav_b64, turns: [{speaker,start_ms,end_ms}] \| null, exclude_vectors: number[][], exclude_threshold?: 0.6 }` | `{ model, dim, speakers: [{ speaker, centroid, segments: [{start_ms,end_ms,vector}], n_segments, duration_sec, victim_similarity, excluded }] }` |
| POST | `/voice/compare` | `{ a: number[], b: number[] }` | `{ cosine, snorm }` (s-norm contra la cohorte de referencia si existe) |
| POST | `/text/embed` | `{ texts: string[], kind: "query" \| "passage" }` | `{ model, dim, vectors }` |
| POST | `/image/crops` | `{ image_b64, boxes: [{x1,y1,x2,y2,concept}] }` | `{ model, dim, full: {phash, vector}, crops: [{concept, box, phash, vector, crop_jpeg_b64}] }` |
| POST | `/image/redact` | `{ image_b64, regions: [{x1,y1,x2,y2}] }` | `image/jpeg` con las regiones pixeladas |
| POST | `/video/sample?fps=5&max_frames=300` | cuerpo crudo de video | `video/mp4` H.264 faststart, headers `x-frames`, `x-fps`, `x-width`, `x-height` |
| POST | `/video/frame?index=N&fps=5` | cuerpo crudo de video | `image/jpeg` del cuadro N del video muestreado |
| POST | `/index/add` | `{ index, ids: number[], vectors: number[][] }` | `{ ok, size }` |
| POST | `/index/search` | `{ index, vector, k, exclude_ids?: number[] }` | `{ results: [{ id, score }] }` |
| POST | `/index/remove` | `{ index, ids }` | `{ ok, size }` |
| POST | `/index/rebuild` | `{ index, ids, vectors }` | `{ ok, size }` (reemplaza el índice completo) |
| GET | `/index/snapshot` | | `application/octet-stream` (zip con los índices y un manifiesto) |
| POST | `/index/load` | `application/octet-stream` (el mismo zip) | `{ ok, sizes }` |
| POST | `/graph/analyze` | `{ nodes: [{id,type}], edges: [{source,target,weight?}] }` | `{ communities: string[][], centrality: {id: number}, degree: {id: number} }` |
| POST | `/pdf/render` | `{ template: "denuncia" \| "expediente", data: object }` | `application/pdf` |
| POST | `/authenticity/audio` | cuerpo crudo del audio ORIGINAL | `SenalesTecnicas` (ver «Autenticidad») |
| POST | `/authenticity/image` | cuerpo crudo de la imagen ORIGINAL | `SenalesTecnicas` |
| POST | `/authenticity/video?frames=16` | cuerpo crudo del video ORIGINAL | `SenalesTecnicas` |

## Autenticidad: señales técnicas

Los tres endpoints devuelven exactamente `SenalesTecnicas` de `packages/shared/src/authenticity.ts`.
Son **indicios**: solo una marca de agua detectada o una credencial C2PA que declara IA justifican
`generado_ia_confirmado`; la ausencia de marca no prueba que el archivo sea real.

Hay que mandar el archivo **original** (el que subió la víctima), no la salida de
`/audio/normalize` ni de `/video/sample`: esas ya no tienen metadatos ni C2PA y la marca se debilita.

```jsonc
{
  "watermark": { "detector": "audioseal-16bits", "detected": false, "score": 0.0 },   // o null
  "c2pa": { "present": false, "ai_generated": null, "generator": null, "claims": [] },  // o null
  "metadata": {                                                                        // o null
    "present": true, "software": "Lavc61.19.101", "digital_source_type": null,
    "suspicious": ["codificado con ffmpeg (Lavc61.19.101): el archivo pasó por un programa de conversión"],
    "fields": { "formato": "jpeg", "dimensiones": "1600x1066", "jpeg.comentario": "Lavc61.19.101" }
  },
  "synthetic_speech": { "detector": "ninguno", "score": 0.0, "available": false }     // o null
}
```

**`watermark`** (`null` si el detector no está disponible; `/health` dice por qué en
`models.audioseal` y `models.videoseal`).

| Endpoint | `detector` | `score` (0 a 1) | `detected` |
|---|---|---|---|
| audio | `audioseal-16bits` | fracción de muestras (16 kHz) con probabilidad de marca > 0.5. Revisa hasta `ML_WM_AUDIO_MAX_S` (120 s) en ventanas de 10 s repartidas por todo el audio | `score ≥ 0.3` |
| imagen | `videoseal-1.0` | confianza media de los 256 bits del extractor, `mean(\|2·sigmoid(logit) − 1\|)` | `score ≥ 0.8` |
| video | `videoseal-1.0`, o `videoseal-1.0+audioseal-16bits` si hay pista de audio | Video Seal: la misma confianza sobre el promedio de los logits de `frames` cuadros equiespaciados (16 por defecto, máximo 64; `frames_checked`). Con audio: el máximo de los dos puntajes | Video Seal `≥ 0.8` o AudioSeal `≥ 0.3` |

Umbrales calibrados (detalle en `docs/devlog/ml.md`): audio sin marca ≤ 0.015, con marca ≥ 0.49 aun tras
Opus a 16 kbps; fotos sin marca 0.09 a 0.50, con marca ≥ 0.83 tras reducirlas y JPEG 60. En video
comprimido la marca de Video Seal pierde fuerza: H.264 CRF 18 da 0.8 a 0.96 y CRF 28 cerca de 0.5–0.64
(no se declara). El puntaje se devuelve siempre para que el análisis forense lo pondere.

**`c2pa`** (`null` solo si falta la librería). `present` = hay manifiesto (o restos ilegibles de
uno). `ai_generated` = `true` si alguna acción de cualquier manifiesto (también de ingredientes)
declara `digitalSourceType` `trainedAlgorithmicMedia` o `compositeWithTrainedAlgorithmicMedia`, `false`
si declara otro origen (por ejemplo `digitalCapture`) y `null` si no dice nada o el manifiesto está
dañado. `generator` = `claim_generator_info` del manifiesto activo. `claims`: acciones (`c2pa.created
(trainedAlgorithmicMedia) con <agente>`), `firmado por <emisor>`, `generador: …`, `validación:
Valid|Trusted|Invalid` y los códigos de aviso. La firma se valida sin red y sin lista de confianza
(un certificado desconocido sale como `signingCredential.untrusted`). Formatos: JPEG, PNG, WebP,
HEIC, AVIF, TIFF, GIF, MP4, MOV, M4A, MP3, WAV, FLAC, AVI. OGG/Opus y WebM no admiten C2PA
incrustado: `present: false` con la nota `formato sin soporte para credenciales C2PA incrustadas`.

**`metadata`**. Imagen: EXIF (marca, modelo, software, fechas, comentario), XMP (incluido
`Iptc4xmpExt:DigitalSourceType`, `xmp:CreatorTool`, `photoshop:Credit`), IPTC IIM (programa de origen,
crédito, fuente), comentario JPEG y textos PNG. Audio y video: `ffprobe` (contenedor, códecs y
etiquetas del formato y de cada pista, como `encoder`, `handler_name` o `com.apple.quicktime.software`)
más el XMP incrustado. `digital_source_type` va en su forma corta (`trainedAlgorithmicMedia`).
`suspicious` (frases en español, a lo más 10): `DigitalSourceType` de IA o sintético, nombres de
generadores de IA (Midjourney, DALL·E, Stable Diffusion, Firefly, Imagen, Sora, Veo, Kling,
ElevenLabs, Suno, MMS-TTS…), editores (Photoshop, Snapseed, FaceApp, CapCut…), codificación con
ffmpeg (`Lavc`/`Lavf`), parámetros de generación en el PNG o en comentarios, etiqueta AIGC y fecha
de modificación distinta de la de captura. `fields` = hasta 40 campos legibles. **Privacidad**: GPS,
ubicación, autor, artista, copyright, números de serie y contactos nunca salen con su valor, solo
`"presente"`; nada de esto se registra en los logs (solo banderas y conteos).

**`synthetic_speech`**: `{ detector: "ninguno", score: 0, available: false }` en audio y en video con
audio; `null` en imagen y video sin audio. No hay un detector abierto, liviano y calibrado para notas
de voz de WhatsApp (ver el devlog).

**Errores**: 422 `empty_body`, `invalid_image` (imagen que no se puede decodificar, salvo HEIC/AVIF,
que devuelven metadatos y C2PA con `watermark: null`), `no_audio`, `no_video`, `ffmpeg_failed`.

**Costo** (2 vCPU, en caliente): imagen 0.2 a 1 s; audio de 25 s ~1 a 3 s; video de 16 cuadros 2 a
4 s. Primera carga: AudioSeal ~0.3 s (35 MB), Video Seal ~1 s (134 MB).

## Reglas de huella de voz

- Segmentos de al menos 3 segundos. Turnos largos se cortan en ventanas de 3 a 6 segundos.
- Si no hay turnos de diarización, ventanas de 3 s sobre todo el audio con un solo hablante `A`.
- Centroide por hablante = promedio normalizado de sus segmentos.
- Un hablante se marca `excluded: true` si su centroide se parece a alguno de `exclude_vectors`
  (la muestra de la víctima) por encima de `exclude_threshold`.

## Persistencia

D1 es la fuente de verdad de los vectores (tabla `embeddings`). El Worker reconstruye los índices
con `/index/rebuild` si `/health` reporta un índice vacío o una versión distinta, y guarda
snapshots en R2 `blindaje-indices` con `/index/snapshot` después de cada escritura (con
debounce).

## Detalles de la implementación (v0.1, todo retrocompatible)

Lo de arriba sigue valiendo tal cual. Esto precisa campos que el contrato no fijaba y agrega
campos u opciones nuevas; un cliente que los ignore sigue funcionando.

**Errores.** Siempre JSON `{ error, detail? }`: 401 `unauthorized` (falta o no coincide
`x-ml-token`), 413 `body_too_large` (`ML_MAX_BODY_MB`, 128 por defecto), 422 `invalid_request`
(validación; nunca devuelve el contenido enviado), 422 `ffmpeg_failed` / `no_audio` / `no_video` /
`frame_out_of_range` / `invalid_image` / `audio_too_short` / `invalid_wav_b64`, 400 `index_error`
(índice desconocido, dimensión, ids repetidos), 503 `model_unavailable` / `pdf_unavailable`.

**`GET /health`.** `models.{voice,text,image,audioseal,videoseal}` son objetos
`{ name, dim, loaded, load_ms, error }` (carga perezosa: `loaded` pasa a `true` con el primer uso; en los detectores de marcas de agua, `dim` es la cantidad de bits).
`index_version` es `null` hasta que el Worker la fije. Extras: `index_updated_at`,
`cohort: { size }`, `versions` (servicio, Python, torch, faiss, ffmpeg, ffprobe, audioseal, c2pa-python…), `uptime_s`.

**Versión de los índices.** `/index/add`, `/index/remove` y `/index/rebuild` aceptan
`version?: string` y la guardan como `index_version`. El snapshot la incluye en el manifiesto y
`/index/load` la restaura (y la devuelve en `{ ok, sizes, index_version }`). Sugerencia: el Worker
guarda un contador o la marca de su última escritura en D1 y la pasa en cada escritura; si
`/health` reporta otra cosa (por ejemplo `null` tras un arranque en frío), reconstruye.

**`/index/add`** es un upsert: si un id ya existe se reemplaza (reintentos idempotentes).
`/index/add` y `/index/rebuild` aceptan `vectors_b64: string[]` (Float32 little-endian en base64,
el mismo formato de `embeddings.vector_b64` en D1) en lugar de `vectors`. Los vectores se
re-normalizan L2 al entrar. `/index/search` devuelve a lo más `k` resultados; los ids de
`exclude_ids` nunca aparecen.

**Snapshot.** Zip con `manifest.json` (`format: "blindaje-faiss-snapshot/1"`, `index_version`,
y por índice `file`, `dim`, `size`, `sha256`), un `<índice>.faiss` por índice y `cohort.npy` si hay
cohorte. `/index/load` verifica los SHA-256 y reemplaza todo o nada.

**`/voice/enroll`.** Agrega `n_segments` y `duration_ms`. Menos de 3 s de voz: 422
`audio_too_short`.

**`/voice/embed`.**
- `wav_b64` debería ser la salida de `/audio/normalize`; si no es WAV mono 16 kHz, se normaliza.
- `turns` acepta `start_ms/end_ms` o `startMs/endMs` (tal como los devuelve Voice Transcribe).
  Turnos consecutivos del mismo hablante separados por menos de 1 s se unen antes de cortar.
- Las ventanas casi sin voz (VAD de energía, menos de 30 % de cuadros con voz) se descartan.
- Un hablante sin ningún segmento de 3 s no aparece en `speakers`; va en
  `skipped: [{ speaker, reason }]`. Extra: `duration_ms` del audio.
- `victim_similarity` es `null` si no se mandan `exclude_vectors`.
- Exclusión en dos niveles: (1) si el centroide de todos los segmentos del hablante supera el
  umbral, el hablante queda `excluded: true`; (2) si no, los segmentos que por sí solos superan
  el umbral se marcan `excluded: true` y no entran al centroide (sirve cuando no hay diarización y
  la víctima habla en el mismo audio). Cada segmento trae `victim_similarity` y `excluded`.
- `n_segments` = segmentos que forman el centroide; `duration_sec` = suma de todos sus segmentos.

**`/voice/compare`.** S-norm adaptativa: z-score contra los 200 más parecidos de la cohorte
(`ML_SNORM_TOP_K`) de cada lado, promediada. Extra: `cohort_size`. La cohorte se lee de
`/models/cohort.npy` (`ML_COHORT_PATH`) y se recarga sola si el archivo cambia. La imagen trae
horneada la cohorte de la evaluación (60 × 192, SLR73), así que `snorm` funciona desde el arranque.

**Nuevo: `POST /voice/cohort`.** Cuerpo: un `.npy` de N x 192 (N ≥ 2). Reemplaza la cohorte en
caliente; responde `{ ok, size }`. Como el contenedor no tiene disco persistente, la cohorte
también viaja en los snapshots.

**`/image/crops`.** Las cajas van en píxeles; si las cuatro coordenadas están en [0, 1] y alguna
no es entera, se toman como fracciones. Se recortan al borde y las cajas vacías se omiten. La
imagen se decodifica aplicando la orientación EXIF (las cajas se interpretan sobre la imagen
rotada). Extras: `width`, `height` de la imagen. Los JPEG de salida no llevan EXIF. DINOv2 recibe
el recorte rellenado a cuadrado (no se recortan placas ni notas alargadas).

**`/image/redact`.** Pixelado en bloques de al menos 10 px (máximo 8 bloques por lado de la
región). Header `x-regions` con las regiones aplicadas. Salida sin EXIF.

**Video.** `/video/sample` y `/video/frame` aceptan `max_side` (1920 por defecto): si el lado
mayor lo supera, se escala; las dimensiones siempre son pares. Rango: `fps` en (0, 30],
`max_frames` hasta 3000. `/video/frame` con un índice fuera de rango: 422 `frame_out_of_range`.

**`/graph/analyze`.** Si hay nodos con `type` `"caso"` o `"case"`, Louvain (semilla 42) corre
sobre la proyección en los casos: dos casos se unen si tienen arista directa o comparten una
señal (peso = mínimo de las dos aristas). Si no hay casos, corre sobre todo el grafo.
`communities` ordenadas por tamaño. `degree` = número de vecinos (entero) y `centrality` =
intermediación normalizada, ambos sobre el grafo completo. Extra: `membership: { id: índice }`,
que asigna también cada señal a la comunidad de la mayoría de sus casos.

**`/pdf/render`.** Todos los campos son opcionales; lo que falta no se imprime.

- Comunes: `demo` o `datos_ficticios` (marca de agua "Datos ficticios"), `generado_utc` (ISO 8601;
  por defecto, ahora). Las fechas ISO se muestran en hora de Lima.
- `denuncia`: `caso`, `seudonimo`, `resumen`, `narrativa`,
  `ficha` (forma de `FichaExtraction`; `identificadores[]` con `valor` o `ultimos_3`; `zona`),
  `cronologia[{fecha, texto, evidencia[]}]`,
  `evidencia[{label, tipo, size_bytes, sha256, received_utc, captured_at}]`,
  `transcripciones[{evidencia, titulo?, turnos[{speaker, start_ms, end_ms, texto}] | texto}]`.
  Siempre incluye la Línea 1818 y "Si estás en peligro ahora, llama al 105".
  También acepta tal cual la forma `VictimReport` de `packages/shared` (la que arma
  `routes/victim.ts`): `code` en lugar de `caso`, `ficha.resumen`, `hallazgos[]` y las
  transcripciones dentro de `evidencia[].transcripcion` (turnos con `text` y `es_victima`; los de la
  víctima salen como "Denunciante"), además de `evidencia[].nota`.
- `expediente`: los campos de `Expediente` (`red`, `resumen`, `cronologia`, `vinculos[{vinculo,
  texto, evidencia[], puntaje?, casos?[]}]`, `hechos`, `hipotesis`, `brechas`) más `perfil`
  (forma de `PerfilRed`), `aprobado` (si no es `true`: "Borrador para revisión" en cada página),
  `aprobado_por`, `aprobado_utc`, `organizacion`, `evidencia[{label, caso, tipo, sha256,
  received_utc}]` y `custodia[{seq, ts, actor_type, action, target_id, prev_hash, hash}]` (filas
  de `audit_log`).
