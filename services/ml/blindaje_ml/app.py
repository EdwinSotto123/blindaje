"""Aplicación FastAPI: middleware (token, límite de cuerpo, logs) y manejo de errores."""

from __future__ import annotations

import hmac
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import faiss
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import __version__
from .config import get_settings
from .imaging import ImageError
from .indices import IndexError_, IndexStore
from .logs import log, log_exception, setup_logging
from .media import MediaError
from .models import ModelUnavailable, Registry
from .pdf import PdfUnavailable
from .voice import Cohort


@dataclass
class MlState:
    registry: Registry
    store: IndexStore
    cohort: Cohort
    started_at: float = field(default_factory=time.time)


class BodyTooLarge(Exception):
    pass


async def read_body(request: Request) -> bytes:
    """Lee el cuerpo crudo con tope (también cuando no hay Content-Length)."""
    limit = get_settings().max_body_bytes
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise BodyTooLarge()
        chunks.append(chunk)
    return b"".join(chunks)


def _error(status: int, code: str, detail: str | None = None) -> JSONResponse:
    body = {"error": code}
    if detail:
        body["detail"] = detail
    return JSONResponse(body, status_code=status)


def create_app(
    registry: Registry | None = None, store: IndexStore | None = None, cohort: Cohort | None = None
) -> FastAPI:
    settings = get_settings()
    setup_logging()
    # FAISS usa OpenMP con todos los núcleos del host; en un contenedor con fracción de vCPU eso
    # sobresuscribe. Se limita a la cuota del cgroup (torch hace lo mismo al cargar un modelo).
    faiss.omp_set_num_threads(settings.threads)
    state = MlState(
        registry=registry or Registry(),
        store=store or IndexStore(),
        cohort=cohort or Cohort(settings.cohort_path, top_k=settings.snorm_top_k),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log("startup", version=__version__, threads=settings.threads, token_required=bool(settings.token),
            preload=list(settings.preload))
        if settings.preload:
            threading.Thread(target=state.registry.preload, args=(settings.preload,), daemon=True).start()
        yield
        log("shutdown")

    app = FastAPI(title="Blindaje ML", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.ml = state

    @app.middleware("http")
    async def guard_and_log(request: Request, call_next):
        t0 = time.perf_counter()
        path = request.url.path
        status = 500
        try:
            if settings.token:
                given = request.headers.get("x-ml-token", "")
                if not hmac.compare_digest(given.encode(), settings.token.encode()):
                    status = 401
                    return _error(401, "unauthorized")
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > settings.max_body_bytes:
                status = 413
                return _error(413, "body_too_large")
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            log(
                "request",
                method=request.method,
                path=path,
                status=status,
                ms=round((time.perf_counter() - t0) * 1000, 1),
                req_bytes=int(request.headers.get("content-length") or 0),
                request_id=request.headers.get("x-request-id") or request.headers.get("cf-ray"),
            )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        # Sin "input": la validación por defecto devolvería textos, vectores o base64 del cuerpo.
        errors = [
            {"loc": [str(x) for x in e.get("loc", ())], "msg": e.get("msg"), "type": e.get("type")}
            for e in exc.errors()[:20]
        ]
        return JSONResponse({"error": "invalid_request", "errors": errors}, status_code=422)

    @app.exception_handler(BodyTooLarge)
    async def _too_large(_: Request, __: BodyTooLarge):
        return _error(413, "body_too_large")

    @app.exception_handler(MediaError)
    async def _media(_: Request, exc: MediaError):
        return _error(422, str(exc))

    @app.exception_handler(ImageError)
    async def _image(_: Request, exc: ImageError):
        return _error(422, str(exc))

    @app.exception_handler(IndexError_)
    async def _index(_: Request, exc: IndexError_):
        return _error(400, "index_error", str(exc))

    @app.exception_handler(ModelUnavailable)
    async def _model(_: Request, exc: ModelUnavailable):
        return _error(503, "model_unavailable", str(exc))

    @app.exception_handler(PdfUnavailable)
    async def _pdf(_: Request, exc: PdfUnavailable):
        return _error(503, "pdf_unavailable", str(exc))

    @app.exception_handler(ValueError)
    async def _value(_: Request, exc: ValueError):
        return _error(422, str(exc).split(":")[0][:64] or "invalid_value")

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception):
        log_exception("unhandled_error", path=request.url.path)
        return _error(500, "internal_error")

    from .routers import authenticity, graph, health, image, index, media, pdf, text, voice

    for r in (health, media, voice, text, image, index, graph, pdf, authenticity):
        app.include_router(r.router)
    return app
