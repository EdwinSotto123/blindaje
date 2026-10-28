# Blindaje ML (`services/ml`)

Servicio Python (FastAPI) que corre como Cloudflare Container detrás del Worker `blindaje-api`.
Hace lo que no cabe en un Worker: ffmpeg, huella de voz (SpeechBrain ECAPA-TDNN), embeddings de
texto (multilingual-e5-small) e imagen (DINOv2 + hash perceptual), índices FAISS, análisis de
grafo (networkx) y los PDF de la denuncia y del expediente (WeasyPrint).

El contrato está en [`docs/ML_API.md`](../../docs/ML_API.md), incluida la sección de detalles de
la implementación. Las decisiones y mediciones, en [`docs/devlog/ml.md`](../../docs/devlog/ml.md).

## Correr con Docker (lo normal)

```bash
docker build --platform linux/amd64 -t blindaje-ml services/ml
docker run --rm -p 8080:8080 blindaje-ml
curl -s localhost:8080/health
```

La imagen trae los pesos en `/models`, descargados en el build con revisiones y checksums fijados;
no descarga nada en tiempo de ejecución. Para exigir un token: `-e ML_TOKEN=...` y mandar el
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

`services/ml/models/` no se versiona. Los tests pesados de voz usan voces sintéticas que genera
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
| `ML_PRELOAD` | (vacío) | `all` o `voice,text,image`: carga esos modelos en segundo plano al arrancar |
| `ML_THREADS` | cuota de CPU del cgroup | Hilos de torch y FAISS |
| `ML_MAX_BODY_MB` | 128 | Tope del cuerpo de cada petición |
| `ML_SNORM_TOP_K` | 200 | Tamaño de la cohorte adaptativa de s-norm |

## Estructura

```text
blindaje_ml/
  app.py        FastAPI, middleware (token, tope de cuerpo, logs) y errores
  config.py     variables de entorno
  media.py      ffmpeg: WAV 16 kHz, muestreo de video, cuadros
  voice.py      segmentación, centroides, exclusión de la víctima, s-norm
  models.py     ECAPA, e5 y DINOv2 con carga perezosa
  imaging.py    decodificación, pHash, recortes, pixelado
  indices.py    FAISS IndexIDMap2(IndexFlatIP), snapshots
  graph.py      Louvain y centralidad
  pdf/          plantillas Jinja2 (denuncia, expediente) con el sistema Cuaderno
  routers/      un módulo por grupo de endpoints
scripts/
  download_models.py   pesos y fuentes con revisiones fijadas
  make_test_audio.ps1  voces sintéticas para los tests pesados
tests/                 pytest (marca heavy = modelos reales)
```
