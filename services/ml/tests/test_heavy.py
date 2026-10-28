"""Tests con los modelos reales. Requieren el extra `models` y los pesos en ML_MODELS_DIR:

    uv sync --extra dev --extra models
    uv run python scripts/download_models.py
    powershell -File scripts/make_test_audio.ps1   # voces sintéticas para la huella de voz
    uv run pytest -m heavy
"""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from .conftest import HAS_FFMPEG, ffmpeg_encode, to_wav

pytestmark = pytest.mark.heavy

_DEFAULT_MODELS = Path(__file__).resolve().parent.parent / "models"
MODELS = Path(os.environ.get("ML_MODELS_DIR", _DEFAULT_MODELS))
AUDIO = Path(os.environ.get("ML_TEST_AUDIO_DIR", MODELS / "test-audio"))


def _have_models() -> bool:
    try:
        import speechbrain  # noqa: F401
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return all((MODELS / d / "config.json").exists() for d in ("multilingual-e5-small", "dinov2-small")) and (
        MODELS / "spkrec-ecapa-voxceleb" / "hyperparams.yaml"
    ).exists()


if not _have_models():
    pytest.skip("faltan el extra models o los pesos", allow_module_level=True)


@pytest.fixture(scope="module")
def real_client():
    from blindaje_ml.app import create_app
    from blindaje_ml.config import reset_settings
    from blindaje_ml.indices import IndexStore
    from blindaje_ml.voice import Cohort

    os.environ["ML_MODELS_DIR"] = str(MODELS)
    os.environ.pop("ML_TOKEN", None)
    reset_settings()
    with TestClient(create_app(store=IndexStore(), cohort=Cohort(MODELS / "_no_cohort.npy"))) as c:
        yield c
    reset_settings()


def _wav(name: str) -> bytes:
    p = AUDIO / f"{name}.wav"
    if not p.exists():
        pytest.skip(f"falta {p} (scripts/make_test_audio.ps1)")
    return p.read_bytes()


def _cos(a, b) -> float:
    a, b = np.asarray(a), np.asarray(b)
    return float(a @ b / np.linalg.norm(a) / np.linalg.norm(b))


def test_text_e5_semantics(real_client):
    r = real_client.post(
        "/text/embed",
        json={
            "kind": "passage",
            "texts": [
                "Audio de voz masculina, pago por Yape con plazo de 48 horas, amenaza de dañar el local",
                "Exigen dinero por Yape en dos días o atacan la bodega, mensajes de voz",
                "Receta de ceviche con limón, cebolla y ají limo",
            ],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["model"] == "intfloat/multilingual-e5-small" and body["dim"] == 384
    v = np.asarray(body["vectors"])
    np.testing.assert_allclose(np.linalg.norm(v, axis=1), 1.0, atol=1e-4)
    assert _cos(v[0], v[1]) > _cos(v[0], v[2]) + 0.05
    q = real_client.post("/text/embed", json={"kind": "query", "texts": ["extorsión por Yape"]}).json()
    assert _cos(q["vectors"][0], v[0]) > _cos(q["vectors"][0], v[2])


def _scene(seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    img = Image.new("RGB", (480, 320), tuple(int(x) for x in rng.integers(0, 255, 3)))
    d = ImageDraw.Draw(img)
    for _ in range(12):
        x, y = rng.integers(0, 440), rng.integers(0, 280)
        d.ellipse((x, y, x + rng.integers(20, 120), y + rng.integers(20, 120)),
                  fill=tuple(int(c) for c in rng.integers(0, 255, 3)))
    return img


def _b64(img: Image.Image, quality: int = 92) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode()


def test_image_dinov2_reuse(real_client):
    a = _scene(1)
    a_recompressed = a.resize((360, 240)).rotate(3)
    b = _scene(2)
    outs = [
        real_client.post("/image/crops", json={"image_b64": _b64(x, q), "boxes": [
            {"x1": 0.1, "y1": 0.1, "x2": 0.6, "y2": 0.7, "concept": "fachada de tienda"}]}).json()
        for x, q in ((a, 92), (a_recompressed, 40), (b, 92))
    ]
    assert outs[0]["model"] == "facebook/dinov2-small" and outs[0]["dim"] == 384
    fa, fa2, fb = (np.asarray(o["full"]["vector"]) for o in outs)
    np.testing.assert_allclose(np.linalg.norm(fa), 1.0, atol=1e-4)
    # Escenas sintéticas parecidas entre sí: basta con que la reutilizada quede más cerca.
    assert _cos(fa, fa2) > _cos(fa, fb) + 0.03
    from blindaje_ml.imaging import hamming

    assert hamming(outs[0]["full"]["phash"], outs[1]["full"]["phash"]) <= 12
    assert hamming(outs[0]["full"]["phash"], outs[2]["full"]["phash"]) > 12
    assert len(outs[0]["crops"]) == 1 and len(outs[0]["crops"][0]["vector"]) == 384


def _embed(client, wav: bytes, turns=None, exclude=None) -> dict:
    r = client.post("/voice/embed", json={
        "wav_b64": base64.b64encode(wav).decode(), "turns": turns, "exclude_vectors": exclude or []})
    assert r.status_code == 200, r.text
    return r.json()


def test_voice_same_speaker_closer_than_other(real_client):
    s1 = _embed(real_client, _wav("sabina_1"))["speakers"][0]
    s2 = _embed(real_client, _wav("sabina_2"))["speakers"][0]
    z1 = _embed(real_client, _wav("zira_1"))["speakers"][0]
    assert s1["n_segments"] >= 4
    same = _cos(s1["centroid"], s2["centroid"])
    other = _cos(s1["centroid"], z1["centroid"])
    print(f"ECAPA coseno misma voz={same:.3f}, otra voz (mismo texto)={other:.3f}")
    assert same > other + 0.15


def test_voice_enroll_and_exclusion_with_turns(real_client):
    from blindaje_ml.media import wav_to_array

    r = real_client.post("/voice/enroll", content=_wav("sabina_2"))
    assert r.status_code == 200, r.text
    victim = r.json()["vector"]
    assert r.json()["model"] == "speechbrain/spkrec-ecapa-voxceleb" and len(victim) == 192

    a = wav_to_array(_wav("sabina_1"))
    z = wav_to_array(_wav("zira_1"))
    mixed = np.concatenate([a, z])
    cut = a.size * 1000 // 16_000
    end = mixed.size * 1000 // 16_000
    body = _embed(real_client, to_wav(mixed), turns=[
        {"speaker": "S1", "start_ms": 0, "end_ms": cut}, {"speaker": "S2", "start_ms": cut, "end_ms": end}],
        exclude=[victim])
    sp = {s["speaker"]: s for s in body["speakers"]}
    print(f"similitud con la víctima: S1={sp['S1']['victim_similarity']}, S2={sp['S2']['victim_similarity']}")
    assert sp["S1"]["excluded"] is True
    assert sp["S2"]["excluded"] is False


def test_voice_compare_and_whatsapp_opus(real_client, tmp_path):
    if not HAS_FFMPEG:
        pytest.skip("sin ffmpeg")
    # Simula WhatsApp: Opus a 16 kbps y de vuelta por /audio/normalize.
    opus = ffmpeg_encode(_wav("sabina_1"), ["-c:a", "libopus", "-b:a", "16k"], ".ogg", tmp_path)
    norm = real_client.post("/audio/normalize", content=opus)
    assert norm.status_code == 200
    s1o = _embed(real_client, norm.content)["speakers"][0]["centroid"]
    s2 = _embed(real_client, _wav("sabina_2"))["speakers"][0]["centroid"]
    z2 = _embed(real_client, _wav("zira_2"))["speakers"][0]["centroid"]
    same = real_client.post("/voice/compare", json={"a": s1o, "b": s2}).json()
    other = real_client.post("/voice/compare", json={"a": s1o, "b": z2}).json()
    print(f"Opus 16k: misma voz={same['cosine']:.3f}, otra voz={other['cosine']:.3f}")
    assert same["cosine"] > other["cosine"] + 0.1
    assert same["snorm"] is None  # sin cohorte
