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

## Endpoints

| Método | Ruta | Entrada | Salida |
|---|---|---|---|
| GET | `/health` | | `{ ok, models: {voice,text,image}, indices: {voz,voz_segmento,texto,imagen}, index_version }` |
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
