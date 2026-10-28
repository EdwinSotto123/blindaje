from __future__ import annotations

import platform
import time
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version

from fastapi import APIRouter, Request

from .. import __version__
from ..media import ffmpeg_version
from .deps import ml

router = APIRouter()

_PACKAGES = ("fastapi", "numpy", "faiss-cpu", "networkx", "torch", "torchaudio", "speechbrain",
             "transformers", "weasyprint", "pillow", "imagehash")


@lru_cache(maxsize=1)
def versions() -> dict[str, str | None]:
    out: dict[str, str | None] = {"service": __version__, "python": platform.python_version()}
    for p in _PACKAGES:
        try:
            out[p] = version(p)
        except PackageNotFoundError:
            out[p] = None
    out["ffmpeg"] = ffmpeg_version()
    return out


@router.get("/health")
def health(request: Request) -> dict:
    s = ml(request)
    return {
        "ok": True,
        "service": "blindaje-ml",
        "models": s.registry.status(),
        "indices": s.store.sizes(),
        "index_version": s.store.version,
        "index_updated_at": s.store.updated_at,
        "cohort": {"size": s.cohort.size()},
        "versions": versions(),
        "uptime_s": round(time.time() - s.started_at, 1),
    }
