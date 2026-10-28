"""Llama Prompt Guard 2: revisión de inyección de instrucciones en el texto de la evidencia."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..config import get_settings
from ..logs import log
from ..models import ModelUnavailable
from ..prompt_guard import PromptGuardUnavailable
from ..schemas import PromptGuardRequest
from .deps import ml

router = APIRouter()


@router.post("/safety/prompt-guard")
def prompt_guard(body: PromptGuardRequest, request: Request) -> dict:
    threshold = get_settings().prompt_guard_threshold
    try:
        guard = ml(request).registry.get("prompt_guard")
    except ModelUnavailable as e:
        raise PromptGuardUnavailable(str(e)) from e
    scored = guard.score(body.texts) if body.texts else []
    results = [
        {
            "score": round(float(r["score"]), 6),
            "label": "inyeccion" if r["score"] >= threshold else "benigno",
            "chunks": int(r["chunks"]),
        }
        for r in scored
    ]
    # Solo conteos: nunca el texto.
    log("prompt_guard", textos=len(results), ventanas=sum(r["chunks"] for r in results),
        inyecciones=sum(r["label"] == "inyeccion" for r in results))
    return {"model": guard.name, "threshold": threshold, "results": results}
