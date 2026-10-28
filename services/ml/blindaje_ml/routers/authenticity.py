"""Señales técnicas de autenticidad (`SenalesTecnicas` de packages/shared/src/authenticity.ts).

Cuerpo crudo con el archivo ORIGINAL (no el WAV normalizado ni el MP4 muestreado: esos ya
perdieron metadatos, C2PA y parte de la marca de agua).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request
from starlette.concurrency import run_in_threadpool

from .. import imaging, media, provenance
from ..app import read_body
from ..config import get_settings
from ..logs import log
from ..models import ModelUnavailable
from ..watermark import AUDIOSEAL_NAME, VIDEOSEAL_NAME
from .deps import ml

router = APIRouter()

# No hay un detector de voz sintética abierto, liviano y confiable para audio de WhatsApp (ver
# docs/devlog/ml.md); el campo existe para que el contrato no cambie el día que lo haya.
NO_SYNTHETIC_SPEECH = {"detector": "ninguno", "score": 0.0, "available": False}


def _detector(request: Request, key: str) -> Any | None:
    try:
        return ml(request).registry.get(key)
    except ModelUnavailable:
        return None


def _audio_watermark(request: Request, data: bytes) -> dict[str, Any] | None:
    """AudioSeal sobre la primera pista de audio. Decodifica siempre (valida el archivo) aunque el
    detector no esté disponible."""
    wav, _ = media.normalize_audio(data)
    det = _detector(request, "audioseal")
    if det is None:
        return None
    res = det.detect(media.wav_to_array(wav))
    return {"detector": AUDIOSEAL_NAME, "detected": res["detected"], "score": res["score"]}


def _audio(request: Request, data: bytes) -> dict[str, Any]:
    kind, mime = provenance.sniff(data)
    info = media.probe(data)
    if info is not None and not any(s.get("codec_type") == "audio" for s in info.get("streams") or []):
        raise media.MediaError("no_audio")
    watermark = _audio_watermark(request, data)
    out = {
        "watermark": watermark,
        "c2pa": provenance.read_c2pa(data, mime),
        "metadata": provenance.container_metadata(info, data, kind),
        "synthetic_speech": dict(NO_SYNTHETIC_SPEECH),
    }
    _log("audio", kind, out)
    return out


def _image(request: Request, data: bytes) -> dict[str, Any]:
    if not data:
        raise imaging.ImageError("empty_body")
    kind, mime = provenance.sniff(data)
    try:
        img = imaging.decode(data)
    except imaging.ImageError:
        # HEIC/AVIF sin decodificador: igual se revisan C2PA y metadatos. Otra cosa: no es una imagen.
        if kind not in ("heic", "avif"):
            raise
        img = None
    watermark = None
    det = _detector(request, "videoseal") if img is not None else None
    if det is not None:
        res = det.detect([img])
        watermark = {"detector": VIDEOSEAL_NAME, "detected": res["detected"], "score": res["score"]}
    out = {
        "watermark": watermark,
        "c2pa": provenance.read_c2pa(data, mime),
        "metadata": provenance.image_metadata(data, kind),
        "synthetic_speech": None,
    }
    _log("image", kind, out)
    return out


def _video(request: Request, data: bytes, frames: int) -> dict[str, Any]:
    if not data:
        raise media.MediaError("empty_body")
    kind, mime = provenance.sniff(data)
    info = media.probe(data)
    streams = (info or {}).get("streams") or []
    if info is not None and not any(s.get("codec_type") == "video" for s in streams):
        raise media.MediaError("no_video")
    duration = None
    try:
        duration = float((info or {}).get("format", {}).get("duration") or 0) or None
    except ValueError:
        duration = None
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    watermark = None
    vdet = _detector(request, "videoseal")
    if vdet is not None:
        size = (vdet.size, vdet.size) if isinstance(getattr(vdet, "size", None), int) else None
        imgs = media.sample_frames(data, frames, duration, size=size)
        v = vdet.detect(imgs)
        del imgs
        watermark = {"detector": VIDEOSEAL_NAME, "detected": v["detected"], "score": v["score"],
                     "frames_checked": v["frames"]}
    # La pista de audio de un video generado también puede traer AudioSeal.
    if has_audio:
        a = _audio_watermark(request, data)
        if a is not None:
            if watermark is None:
                watermark = a
            else:
                watermark = {
                    "detector": f"{VIDEOSEAL_NAME}+{AUDIOSEAL_NAME}",
                    "detected": watermark["detected"] or a["detected"],
                    "score": max(watermark["score"], a["score"]),
                    "frames_checked": watermark["frames_checked"],
                }
    out = {
        "watermark": watermark,
        "c2pa": provenance.read_c2pa(data, mime),
        "metadata": provenance.container_metadata(info, data, kind),
        "synthetic_speech": dict(NO_SYNTHETIC_SPEECH) if has_audio else None,
    }
    _log("video", kind, out)
    return out


def _log(tipo: str, kind: str, out: dict[str, Any]) -> None:
    """Solo banderas y conteos: nunca valores de metadatos."""
    wm, c2, md = out["watermark"], out["c2pa"], out["metadata"]
    log("authenticity", tipo=tipo, formato=kind,
        watermark=None if wm is None else wm["detected"],
        c2pa=None if c2 is None else c2["present"],
        c2pa_ai=None if c2 is None else c2["ai_generated"],
        metadata_suspicious=0 if md is None else len(md["suspicious"]))


@router.post("/authenticity/audio")
async def authenticity_audio(request: Request) -> dict:
    data = await read_body(request)
    if not data:
        raise media.MediaError("empty_body")
    return await run_in_threadpool(_audio, request, data)


@router.post("/authenticity/image")
async def authenticity_image(request: Request) -> dict:
    data = await read_body(request)
    return await run_in_threadpool(_image, request, data)


@router.post("/authenticity/video")
async def authenticity_video(
    request: Request,
    frames: int | None = Query(None, ge=1, le=64),
) -> dict:
    data = await read_body(request)
    n = frames or get_settings().wm_video_frames
    return await run_in_threadpool(_video, request, data, n)
