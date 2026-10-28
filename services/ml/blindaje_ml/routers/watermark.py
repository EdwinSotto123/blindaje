"""Trazabilidad de filtraciones: marcas de agua de Meta con un mensaje (quién vio la evidencia).

La consola muestra cada audio e imagen con una marca invisible que codifica la cuenta que lo abrió.
Si una copia se filtra, un administrador la sube y la API busca el mensaje emitido más cercano
(distancia de Hamming). Aquí solo se inserta y se decodifica; la atribución es de la API.

Cuerpo crudo en todos: el audio en cualquier formato que lea ffmpeg, la imagen en JPEG, PNG o WebP.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from .. import imaging, media
from ..app import read_body
from ..config import get_settings
from ..logs import log
from ..watermark import AUDIOSEAL_NAME, VIDEOSEAL_NAME, hex_to_bits
from .deps import ml

router = APIRouter()

JPEG_QUALITY = 92


def _samples(data: bytes) -> tuple[Any, int]:
    if not data:
        raise media.MediaError("empty_body")
    wav, duration_ms = media.normalize_audio(data)
    return media.wav_to_array(wav), duration_ms


def _audio_embed(request: Request, data: bytes, message: int) -> tuple[bytes, int]:
    embedder = ml(request).registry.get("audioseal_embedder")
    samples, duration_ms = _samples(data)
    if duration_ms > get_settings().wm_embed_max_s * 1000:
        raise media.MediaError("audio_too_long")
    if samples.size < media.SAMPLE_RATE // 10:  # menos de 0.1 s: no hay dónde poner la marca
        raise media.MediaError("audio_too_short")
    marked = embedder.embed(samples, message)
    log("watermark_embed", tipo="audio", duration_ms=duration_ms)
    return media.array_to_wav(marked), duration_ms


def _audio_detect(request: Request, data: bytes) -> dict[str, Any]:
    detector = ml(request).registry.get("audioseal")
    samples, _ = _samples(data)
    res = detector.decode(samples)
    log("watermark_detect", tipo="audio", detected=res["detected"])
    return {
        "detected": res["detected"],
        "score": res["score"],
        "message": res["message"],
        "bits": res["bits"],
        "bit_confidence": res["bit_confidence"],
        "model": AUDIOSEAL_NAME,
    }


def _image_embed(request: Request, data: bytes, message: str) -> tuple[bytes, int, tuple[int, int]]:
    embedder = ml(request).registry.get("videoseal_embedder")
    bits = hex_to_bits(message, embedder.nbits)
    if not data:
        raise imaging.ImageError("empty_body")
    img = imaging.decode(data)
    marked = embedder.embed(img, bits)
    log("watermark_embed", tipo="imagen", width=img.size[0], height=img.size[1])
    return imaging.to_jpeg(marked, quality=JPEG_QUALITY), embedder.nbits, marked.size


def _image_detect(request: Request, data: bytes) -> dict[str, Any]:
    """Lee la imagen entera y, si tiene bordes lisos (una captura de pantalla con las barras de la app),
    también solo la zona con contenido: Video Seal lleva todo el cuadro a 256 x 256 y con las barras la
    marca queda a otra escala. Se devuelve la lectura con mayor puntaje."""
    detector = ml(request).registry.get("videoseal")
    if not data:
        raise imaging.ImageError("empty_body")
    img = imaging.decode(data)
    res = detector.decode([img])
    box = imaging.content_box(img)
    if box is not None:
        cropped = detector.decode([img.crop((box.x1, box.y1, box.x2, box.y2))])
        if cropped["score"] > res["score"]:
            res = cropped
    log("watermark_detect", tipo="imagen", detected=res["detected"], recorte=box is not None)
    return {
        "detected": res["detected"],
        "score": res["score"],
        "bits": res["bits"],
        "message_hex": res["message_hex"],
        "model": VIDEOSEAL_NAME,
    }


@router.post("/watermark/audio/embed")
async def watermark_audio_embed(request: Request, message: int = Query(..., ge=0, le=65535)) -> Response:
    data = await read_body(request)
    wav, duration_ms = await run_in_threadpool(_audio_embed, request, data, message)
    return Response(wav, media_type="audio/wav", headers={
        "x-watermark-model": AUDIOSEAL_NAME,
        "x-watermark-message": str(message),
        "x-duration-ms": str(duration_ms),
    })


@router.post("/watermark/audio/detect")
async def watermark_audio_detect(request: Request) -> dict:
    data = await read_body(request)
    return await run_in_threadpool(_audio_detect, request, data)


@router.post("/watermark/image/embed")
async def watermark_image_embed(
    request: Request, message: str = Query(..., min_length=1, max_length=1024)
) -> Response:
    data = await read_body(request)
    jpg, nbits, (w, h) = await run_in_threadpool(_image_embed, request, data, message)
    return Response(jpg, media_type="image/jpeg", headers={
        "x-watermark-model": VIDEOSEAL_NAME,
        "x-watermark-nbits": str(nbits),
        "x-width": str(w),
        "x-height": str(h),
    })


@router.post("/watermark/image/detect")
async def watermark_image_detect(request: Request) -> dict:
    data = await read_body(request)
    return await run_in_threadpool(_image_detect, request, data)
