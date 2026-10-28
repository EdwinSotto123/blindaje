from __future__ import annotations

from fastapi import APIRouter, Request

from ..schemas import TextEmbedRequest
from .deps import ml

router = APIRouter()


@router.post("/text/embed")
def text_embed(body: TextEmbedRequest, request: Request) -> dict:
    embedder = ml(request).registry.get("text")
    vecs = embedder.embed(body.texts, body.kind)
    return {
        "model": embedder.name,
        "dim": embedder.dim,
        "vectors": [[round(float(x), 7) for x in v] for v in vecs],
    }
