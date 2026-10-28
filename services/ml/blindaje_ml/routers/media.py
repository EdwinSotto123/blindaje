from __future__ import annotations

from fastapi import APIRouter, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from .. import media
from ..app import read_body

router = APIRouter()


@router.post("/audio/normalize")
async def audio_normalize(request: Request) -> Response:
    data = await read_body(request)
    wav, duration_ms = await run_in_threadpool(media.normalize_audio, data)
    return Response(wav, media_type="audio/wav", headers={"x-duration-ms": str(duration_ms)})


@router.post("/video/sample")
async def video_sample(
    request: Request,
    fps: float = Query(5, gt=0, le=30),
    max_frames: int = Query(300, ge=1, le=3000),
    max_side: int = Query(1920, ge=64, le=4096),
) -> Response:
    data = await read_body(request)
    mp4, info = await run_in_threadpool(media.sample_video, data, fps, max_frames, max_side)
    return Response(
        mp4,
        media_type="video/mp4",
        headers={
            "x-frames": str(info.frames),
            "x-fps": f"{info.fps:g}",
            "x-width": str(info.width),
            "x-height": str(info.height),
        },
    )


@router.post("/video/frame")
async def video_frame(
    request: Request,
    index: int = Query(..., ge=0),
    fps: float = Query(5, gt=0, le=30),
    max_side: int = Query(1920, ge=64, le=4096),
) -> Response:
    data = await read_body(request)
    jpg = await run_in_threadpool(media.video_frame, data, index, fps, max_side)
    return Response(jpg, media_type="image/jpeg")
