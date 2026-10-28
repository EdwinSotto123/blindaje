from __future__ import annotations

import io

import numpy as np
from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from .. import media, voice
from ..app import read_body
from ..schemas import CompareRequest, VoiceEmbedRequest, b64decode
from .deps import ml

router = APIRouter()


def _vec(v: np.ndarray | None) -> list[float] | None:
    return None if v is None else [round(float(x), 7) for x in v]


def _sim(x: float | None) -> float | None:
    return None if x is None else round(x, 6)


@router.post("/voice/enroll")
async def voice_enroll(request: Request) -> dict:
    data = await read_body(request)
    state = ml(request)

    def work() -> dict:
        wav, duration_ms = media.normalize_audio(data)
        embedder = state.registry.get("voice")
        vec, n = voice.enroll(media.wav_to_array(wav), embedder)
        return {
            "model": embedder.name,
            "dim": embedder.dim,
            "vector": _vec(vec),
            "n_segments": n,
            "duration_ms": duration_ms,
        }

    return await run_in_threadpool(work)


@router.post("/voice/embed")
def voice_embed(body: VoiceEmbedRequest, request: Request) -> dict:
    state = ml(request)
    wave = media.wav_to_array(b64decode(body.wav_b64, "wav_b64"))
    embedder = state.registry.get("voice")
    turns = [voice.Turn(t.speaker, t.start_ms, t.end_ms) for t in body.turns] if body.turns else None
    speakers, skipped = voice.embed_speakers(
        wave, turns, embedder, body.exclude_vectors or None, body.exclude_threshold
    )
    return {
        "model": embedder.name,
        "dim": embedder.dim,
        "duration_ms": int(wave.size * 1000 // media.SAMPLE_RATE),
        "speakers": [
            {
                "speaker": sp.speaker,
                "centroid": _vec(sp.centroid),
                "segments": [
                    {
                        "start_ms": sg.start_ms,
                        "end_ms": sg.end_ms,
                        "vector": _vec(sg.vector),
                        "victim_similarity": _sim(sg.victim_similarity),
                        "excluded": sg.excluded,
                    }
                    for sg in sp.segments
                ],
                # Segmentos que forman el centroide (en un hablante excluido, todos).
                "n_segments": len(sp.segments) if sp.excluded else sum(not sg.excluded for sg in sp.segments),
                "duration_sec": sp.duration_sec,
                "victim_similarity": _sim(sp.victim_similarity),
                "excluded": sp.excluded,
            }
            for sp in speakers
        ],
        "skipped": skipped,
    }


@router.post("/voice/compare")
def voice_compare(body: CompareRequest, request: Request) -> dict:
    state = ml(request)
    if len(body.a) != len(body.b):
        raise ValueError("dim_mismatch")
    a = voice.l2_normalize(np.asarray(body.a, dtype=np.float32))
    b = voice.l2_normalize(np.asarray(body.b, dtype=np.float32))
    cohort = state.cohort.matrix()
    s = voice.snorm(a, b, cohort, state.cohort.top_k)
    return {
        "cosine": round(float(a @ b), 6),
        "snorm": None if s is None else round(s, 6),
        "cohort_size": 0 if cohort is None else int(cohort.shape[0]),
    }


@router.post("/voice/cohort")
async def voice_cohort(request: Request) -> dict:
    """Reemplaza la cohorte de s-norm con un `.npy` (N x 192). Extensión del contrato."""
    data = await read_body(request)
    state = ml(request)
    try:
        arr = np.load(io.BytesIO(data), allow_pickle=False)
    except (ValueError, OSError, EOFError) as e:
        raise ValueError("invalid_npy") from e
    if arr.ndim != 2 or arr.shape[1] != 192:
        raise ValueError("cohort_shape")
    size = await run_in_threadpool(state.cohort.set, arr)
    return {"ok": True, "size": size}
