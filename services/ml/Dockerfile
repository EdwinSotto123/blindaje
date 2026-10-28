# syntax=docker/dockerfile:1.7
# Contenedor de ML de Blindaje (Cloudflare Containers, linux/amd64, CPU).
#   docker build --platform linux/amd64 -t blindaje-ml services/ml
#   docker run --rm -p 8080:8080 blindaje-ml
ARG PYTHON_IMAGE=python:3.11-slim

# ffmpeg estático (incluye libx264 y libopus): ~144 MB frente a ~420 MB de librerías del paquete de Debian.
FROM mwader/static-ffmpeg:9.0.2-1 AS ffmpeg

FROM ${PYTHON_IMAGE} AS builder
COPY --from=ghcr.io/astral-sh/uv:0.11.12 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src
COPY pyproject.toml uv.lock README.md ./
# torch CPU sale del índice de PyTorch para CPU (fijado en pyproject.toml y uv.lock).
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra models --no-install-project
COPY blindaje_ml ./blindaje_ml
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra models --no-editable
# Recorte: cabeceras C++ y archivos de CMake de torch no hacen falta en tiempo de ejecución.
RUN rm -rf /opt/venv/lib/python3.11/site-packages/torch/include \
           /opt/venv/lib/python3.11/site-packages/torch/share \
           /opt/venv/lib/python3.11/site-packages/torch/test \
    && find /opt/venv -type d -name tests -path "*/site-packages/*/tests" -prune -exec rm -rf {} + \
    && find /opt/venv -name "*.pyi" -delete

# Pesos de los modelos y fuentes, con revisiones y checksums fijados. Se verifica que carguen sin red.
FROM builder AS models
COPY scripts/download_models.py ./scripts/download_models.py
RUN /opt/venv/bin/python scripts/download_models.py /models --verify \
    && rm -rf /models/*/.cache

FROM ${PYTHON_IMAGE} AS runtime
# Librerías nativas de WeasyPrint (pango, harfbuzz) y una fuente de respaldo para glifos raros.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin app
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=builder /opt/venv /opt/venv
COPY --from=models /models /models
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ML_MODELS_DIR=/models \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HOME=/tmp/hf \
    TORCH_HOME=/tmp/torch \
    TMPDIR=/tmp
USER app
WORKDIR /tmp
EXPOSE 8080
CMD ["uvicorn", "blindaje_ml.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log", "--timeout-keep-alive", "75"]

# Tests dentro de la imagen (Linux, con pango y los modelos). No forma parte de la imagen final:
#   docker build --platform linux/amd64 --target test -t blindaje-ml-test services/ml
#   docker run --rm -v "$PWD/services/ml/models/test-audio:/models/test-audio:ro" blindaje-ml-test
FROM runtime AS test
USER root
COPY --from=ghcr.io/astral-sh/uv:0.11.12 /uv /usr/local/bin/uv
RUN uv pip install --python /opt/venv/bin/python --no-cache "pytest>=8.3" "httpx>=0.27"
WORKDIR /src
COPY pyproject.toml ./
COPY tests ./tests
USER app
ENV HOME=/tmp
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"]

# Imagen final por defecto.
FROM runtime
