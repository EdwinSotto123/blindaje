# Blindaje ML (`services/ml`)

Servicio Python (FastAPI) que corre como Cloudflare Container detrás del Worker `blindaje-api`.
Hace lo que no cabe en un Worker: ffmpeg, huella de voz (SpeechBrain ECAPA-TDNN), embeddings de
texto (multilingual-e5-small) e imagen (DINOv2 + hash perceptual), índices FAISS, análisis de
grafo (networkx), los PDF de la denuncia y del expediente (WeasyPrint), las señales técnicas de
autenticidad (marcas de agua de Meta AudioSeal y Video Seal, credenciales C2PA y metadatos), la
trazabilidad de filtraciones (las mismas marcas de Meta, insertadas con un código de quien vio la
evidencia) y la revisión de inyección de instrucciones con Llama Prompt Guard 2.

Built with Llama: `/safety/prompt-guard` usa Llama Prompt Guard 2 (Llama 4 Community License).

El contrato está en [`docs/ML_API.md`](../../docs/ML_API.md), incluida la sección de detalles de
la implementación. Las decisiones y mediciones, en [`docs/devlog/ml.md`](../../docs/devlog/ml.md).

## Correr con Docker (lo normal)

```bash
docker build --platform linux/amd64 -t blindaje-ml services/ml
docker run --rm -p 8080:8080 blindaje-ml
curl -s localhost:8080/health
```

La imagen trae los pesos en `/models`, descargados en el build con revisiones y checksums fijados;
no descarga nada en tiempo de ejecución. También trae la cohorte de s-norm de la evaluación
(`assets/cohort.npy`, ver `assets/README.md`). Con el WSL del equipo limitado, córrela con
`docker run --rm -m 3g --cpus 2 -p 8080:8080 blindaje-ml` (pico medido bajo estrés: ~2 GiB). Para exigir un token: `-e ML_TOKEN=...` y mandar el
header `x-ml-token` en cada petición.

## Desarrollo local con uv

```bash
cd services/ml
uv sync --extra dev                      # liviano: sin torch ni modelos
uv run ruff check .
uv run pytest -m "not heavy"             # tests livianos (embebedores falsos)

uv sync --extra dev --extra models       # torch CPU desde el índice de PyTorch
uv run python scripts/download_models.py --verify   # pesos y fuentes en services/ml/models/
uv run pytest -m heavy                   # modelos reales
uv run uvicorn blindaje_ml.main:app --port 8080
```

`services/ml/models/` no se versiona. El generador de AudioSeal y el embebedor de Video Seal
(`videoseal/embedder.jit`, que el script extrae del modelo completo) van en la imagen: insertan las
marcas de la trazabilidad. El modelo completo de Video Seal (`models/videoseal/y_256b_img.jit`) solo
sirve para un test pesado que compara el embebedor con el original; la imagen final no lo lleva.

Llama Prompt Guard 2 tiene acceso restringido en Hugging Face: se descarga en el host con un token y
el Dockerfile lo copia desde `.models-gated/` (ver [`.models-gated/README.md`](.models-gated/README.md)).
Sin esos pesos la imagen se construye igual y `/safety/prompt-guard` responde 503.

```bash
uv run python scripts/eval_watermark.py      # robustez de las marcas: eval/results/watermark.json
uv run python scripts/eval_prompt_guard.py   # 86M contra 22M en español: eval/results/prompt_guard.json
```

Los tests pesados de voz usan voces sintéticas que genera
`scripts/make_test_audio.ps1` (Windows); sin ellas se saltan. Los tests de PDF necesitan pango
(en Linux: `apt install libpango-1.0-0 libpangoft2-1.0-0`); en Windows se saltan.

Para correr todos los tests dentro de la imagen (Linux, con pango, ffmpeg y los modelos):

```bash
docker build --platform linux/amd64 --target test -t blindaje-ml-test services/ml
docker run --rm -v "$PWD/services/ml/models/test-audio:/models/test-audio:ro" blindaje-ml-test
```

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `ML_TOKEN` | (vacío) | Si existe, toda petición debe traer `x-ml-token` igual |
| `ML_MODELS_DIR` | `/models` en la imagen, `services/ml/models` en local | Pesos, fuentes y cohorte |
| `ML_COHORT_PATH` | `$ML_MODELS_DIR/cohort.npy` | Cohorte de s-norm (N x 192) |
| `ML_PRELOAD` | `voice` en la imagen, vacío en local | `all` o `voice,text,image`: carga esos modelos en segundo plano al arrancar; el resto se carga al primer uso |
| `ML_THREADS` | cuota de CPU del cgroup | Hilos de torch y FAISS |
| `ML_MAX_BODY_MB` | 128 | Tope del cuerpo de cada petición |
| `ML_FFPROBE` | `ffprobe` | Binario de ffprobe (metadatos del contenedor en `/authenticity`) |
| `ML_WM_AUDIO_MAX_S` | 120 | Segundos de audio que revisa AudioSeal (ventanas de 10 s repartidas) |
| `ML_WM_VIDEO_FRAMES` | 16 | Cuadros que revisa Video Seal si la petición no trae `frames` |
| `ML_WM_EMBED_MAX_S` | 600 | Duración máxima del audio al que `/watermark/audio/embed` inserta la marca (más: 422 `audio_too_long`) |
| `ML_PROMPT_GUARD_MODEL` | `meta-llama/Llama-Prompt-Guard-2-86M` | Modelo de `/safety/prompt-guard` (carpeta en minúsculas dentro de `ML_MODELS_DIR`) |
| `ML_PROMPT_GUARD_THRESHOLD` | ver `docs/ML_API.md` | Puntaje desde el que un texto se etiqueta `inyeccion` |
| `NO_TORCH_COMPILE` | `1` en la imagen | Evita que audioseal intente `torch.compile` (no hay compilador de C) |
| `ML_SNORM_TOP_K` | 200 | Tamaño de la cohorte adaptativa de s-norm |
| `MALLOC_ARENA_MAX` | `2` en la imagen | Limita la fragmentación de memoria con peticiones concurrentes |

## Estructura

```text
blindaje_ml/
  app.py        FastAPI, middleware (token, tope de cuerpo, logs) y errores
  config.py     variables de entorno
  media.py      ffmpeg: WAV 16 kHz, muestreo de video, cuadros
  voice.py      segmentación, centroides, exclusión de la víctima, s-norm
  models.py     ECAPA, e5, DINOv2, marcas de agua y Prompt Guard, con carga perezosa
  watermark.py  AudioSeal y Video Seal: detectores, generador y embebedor, mensajes y umbrales
  prompt_guard.py  Llama Prompt Guard 2 con ventanas de 512 tokens
  provenance.py C2PA, EXIF, XMP, IPTC y etiquetas de ffprobe (sin modelos)
  imaging.py    decodificación, pHash, recortes, pixelado, zona con contenido de una captura
  indices.py    FAISS IndexIDMap2(IndexFlatIP), snapshots
  graph.py      Louvain y centralidad
  pdf/          plantillas Jinja2 (denuncia, expediente) con el sistema Cuaderno
  routers/      un módulo por grupo de endpoints
scripts/
  download_models.py   pesos y fuentes con revisiones y SHA-256 fijados (--test-dest aparta el
                       Video Seal completo, que solo usan los tests; --gated baja Prompt Guard con
                       HF_TOKEN y --stage-gated lo copia a .models-gated/)
  eval_watermark.py    robustez de la trazabilidad (WhatsApp, recorte, captura) y falsos positivos
  eval_prompt_guard.py Prompt Guard 2 86M contra 22M sobre eval/data/prompt_guard_es.jsonl
  make_test_audio.ps1  voces sintéticas para los tests pesados
assets/
  cohort.npy           cohorte de s-norm (copia de eval/cohort.npy, CC BY-SA 4.0)
tests/                 pytest (marca heavy = modelos reales)
```
