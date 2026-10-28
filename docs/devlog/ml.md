# Devlog: contenedor de ML (`services/ml`)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 01:15 · Arranque y licencias

- Contrato: `docs/ML_API.md`. Leídas las secciones 3.3, 5.4, 5.6 y 6.5 del prompt y 7, 9 y 10.3
  del documento de diseño.
- **Licencias verificadas** en la API de Hugging Face (`/api/models/<repo>`, campo `cardData.license`
  y etiqueta `license:`), con la revisión fijada en `scripts/download_models.py`:

  | Modelo | Revisión | Licencia | Tamaño en disco |
  |---|---|---|---|
  | `speechbrain/spkrec-ecapa-voxceleb` | `0f99f2d0` | Apache-2.0 | 85 MB (ckpt) |
  | `intfloat/multilingual-e5-small` | `614241f6` | MIT | 471 MB (safetensors fp32) |
  | `facebook/dinov2-small` | `ed25f3a3` | Apache-2.0 | 85 MB |

  Librerías: SpeechBrain Apache-2.0, FAISS MIT, networkx BSD-3, WeasyPrint BSD-3, imagehash
  BSD-2, torch BSD-3. ECAPA se entrenó con VoxCeleb 1+2; la licencia de los pesos publicada es
  Apache-2.0.
- **Fuente**: Atkinson Hyperlegible (Braille Institute) desde el repo de Google Fonts, fijada al
  commit `95f4904f` y con SHA-256 por archivo. Licencia SIL OFL 1.1 (se copia `OFL.txt` junto a
  los TTF).
- Cloudflare Containers (documentación oficial, límites): `lite` 1/16 vCPU y 256 MiB, `basic`
  1/4 y 1 GiB, `standard-1` 1/2 y 4 GiB, `standard-2` 1 y 6 GiB, `standard-3` 2 y 8 GiB,
  `standard-4` 4 y 12 GiB. El tamaño de imagen se limita al disco de la instancia (8 GB en
  `standard-1`); 50 GB de imágenes por cuenta.

## 2026-10-28 01:40 · Decisiones

- **Python 3.11 en la imagen, compatible 3.11–3.13**. `.python-version` fija 3.11 para que local,
  CI e imagen coincidan.
- **torch 2.11 CPU** desde `download.pytorch.org/whl/cpu` (fuente explícita en `pyproject.toml`).
  El último torchaudio publicado es 2.11 y su extensión nativa depende de la ABI de torch, así que
  torch queda en el mismo minor (2.11.*) aunque exista 2.14. SpeechBrain 1.1.2 exige torchaudio.
- **Extras**: `models` (torch, torchaudio, speechbrain, transformers) y `dev`. CI corre
  `uv sync --extra dev` sin modelos: los tests livianos usan embebedores falsos.
- **Sin sentence-transformers ni torchvision**: e5 con mean pooling propio (máscara de atención)
  y prefijos `query: `/`passage: `; DINOv2 con preprocesamiento propio (relleno a cuadrado, 224 px,
  media y desviación de ImageNet) y `pooler_output` (CLS tras la layernorm). El relleno evita
  recortar placas y notas alargadas, que el center-crop estándar cortaría.
- **Voz**: ventanas de 3 a 6 s del mismo largo; turnos consecutivos del mismo hablante a menos de
  1 s se unen; VAD de energía simple para descartar ventanas de silencio (al final de los audios
  de WhatsApp suele haber silencio que ensucia el centroide). Exclusión de la víctima en dos
  niveles: hablante completo por centroide y, en hablantes no excluidos, segmentos sueltos (caso
  sin diarización donde la víctima habla en el mismo audio). Detalle en `docs/ML_API.md`.
- **s-norm adaptativa** (top-200 de la cohorte por lado). La cohorte se lee de
  `/models/cohort.npy`, se recarga si cambia y además se puede subir con `POST /voice/cohort`
  (extensión del contrato) y viaja en los snapshots, porque el contenedor no tiene disco
  persistente.
- **FAISS**: `IndexIDMap2(IndexFlatIP)`; `add` es upsert para que los reintentos del Workflow sean
  idempotentes. Snapshot zip con manifiesto y SHA-256 por índice; `load` es todo o nada.
  `index_version` la fija el Worker (campo opcional `version` en las escrituras).
- **Grafo**: Louvain con semilla 42 sobre la proyección en casos (como dice 10.3), centralidad de
  intermediación y grado sobre el grafo completo; extra `membership` para ubicar cada señal en
  su red.
- **ffmpeg estático** (`mwader/static-ffmpeg:9.0.2-1`, solo el binario `ffmpeg`, 144 MB) en vez del
  paquete de Debian, que arrastra 205 paquetes y unos 420 MB de librerías. Sin ffprobe: las
  dimensiones y la cantidad de cuadros salen del filtro `showinfo`, y el tope de cuadros va dentro
  del grafo de filtros (`trim`) para que el conteo sea exacto.
- **Privacidad en logs**: un evento JSON por petición con ruta, estado, duración y tamaño. Nunca
  cuerpos, vectores, textos ni el stderr de ffmpeg (puede traer metadatos del archivo). Los
  errores de validación tampoco devuelven el contenido enviado. Los JPEG de salida van sin EXIF.

## 2026-10-28 02:05 · Tests

- 61 tests livianos (rutas, token, límites, ffmpeg con tonos y video `testsrc`, FAISS, snapshot
  con verificación de checksum, grafo, imagen, PDF a nivel HTML) y 5 pesados con los modelos
  reales. Ruff limpio.
- Para la huella de voz real no hay audios con licencia en el repo: `scripts/make_test_audio.ps1`
  genera voces sintéticas con SAPI de Windows (Sabina es-MX y Zira en-US leyendo el mismo guion
  en español). Resultados con ECAPA (coseno entre centroides):
  - misma voz, distinto texto: **0.957**; otra voz, mismo texto: **0.312**;
  - tras Opus a 16 kbps (simulación de WhatsApp) y `/audio/normalize`: **0.948** contra **0.270**;
  - exclusión con turnos: el hablante de la víctima da 0.957 contra su muestra y se excluye; el
    otro da 0.325 y queda.

  Son voces sintéticas, más fáciles que voces reales; la medición de verdad es la de la
  evaluación con SLR73.
EOF
