"""Trazabilidad de filtraciones con los modelos reales: insertar un mensaje y recuperarlo.

    uv sync --extra dev --extra models
    uv run python scripts/download_models.py
    uv run pytest -m heavy tests/test_watermark_heavy.py -s
"""

from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFilter

from .conftest import HAS_FFMPEG, to_wav

pytestmark = pytest.mark.heavy

os.environ.setdefault("NO_TORCH_COMPILE", "1")

_DEFAULT_MODELS = Path(__file__).resolve().parent.parent / "models"
MODELS = Path(os.environ.get("ML_MODELS_DIR", _DEFAULT_MODELS))
SR = 16_000
NEEDED = ["audioseal/detector_base.pth", "audioseal/generator_base.pth", "videoseal/detector.jit",
          "videoseal/embedder.jit"]


def _have() -> bool:
    if importlib.util.find_spec("audioseal") is None or importlib.util.find_spec("torch") is None:
        return False
    return all((MODELS / p).exists() for p in NEEDED)


if not _have():
    pytest.skip("faltan el extra models o los pesos de las marcas de agua", allow_module_level=True)


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


def _speechlike(seconds: float = 8.0, seed: int = 0) -> np.ndarray:
    """Voz sintética con sílabas y pausas (la misma de scripts/eval_watermark.py). Ojo: con un tono
    armónico continuo, sin pausas, el mensaje de AudioSeal sale débil (bits cerca de 0.5) aunque se
    inserte de una sola pasada; con voz real o con sílabas se lee completo."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(SR * seconds)) / SR
    base = rng.uniform(95, 230)
    f0 = base + 0.18 * base * np.sin(2 * np.pi * rng.uniform(0.3, 0.9) * t) + 8 * np.sin(2 * np.pi * 5.3 * t)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    x = sum((rng.uniform(0.3, 0.6) / k) * np.sin(k * phase) for k in range(1, 14))
    envelope = np.clip(np.sin(2 * np.pi * rng.uniform(2.5, 4.5) * t), 0, None) ** 0.6
    x = x * envelope + rng.uniform(0.003, 0.02) * rng.standard_normal(t.size)
    return (rng.uniform(0.15, 0.45) * x / np.abs(x).max()).astype(np.float32)


def _scene(w: int = 640, h: int = 480, seed: int = 0) -> Image.Image:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.stack([120 + 60 * np.sin(xx / 37.0), 110 + 50 * np.cos(yy / 23.0), 90 + 40 * np.sin((xx + yy) / 51.0)],
                    axis=-1)
    base += rng.normal(0, 18, base.shape)
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    d = ImageDraw.Draw(img)
    for _ in range(25):
        x, y = int(rng.integers(0, w - 60)), int(rng.integers(0, h - 60))
        d.rectangle((x, y, x + int(rng.integers(10, 60)), y + int(rng.integers(10, 60))),
                    fill=tuple(int(c) for c in rng.integers(0, 255, 3)))
    return img


def _jpeg(img: Image.Image, q: int = 90) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q)
    return buf.getvalue()


def _opus(wav: bytes, tmp: Path, bitrate: str = "16k") -> bytes:
    src, dst = tmp / "wm.wav", tmp / "wm.ogg"
    src.write_bytes(wav)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-ac", "1",
                    "-c:a", "libopus", "-b:a", bitrate, str(dst)], check=True)
    return dst.read_bytes()


def _wav_samples(data: bytes) -> np.ndarray:
    from blindaje_ml.media import wav_to_array

    return wav_to_array(data)


# --- audio ----------------------------------------------------------------------------------------


def test_audio_message_roundtrip(real_client):
    x = _speechlike()
    r = real_client.post("/watermark/audio/embed?message=48879", content=to_wav(x))
    assert r.status_code == 200, r.text
    marked = _wav_samples(r.content)
    assert marked.size == x.size
    noise = marked - x
    snr = 10 * np.log10(np.sum(x**2) / np.sum(noise**2))
    d = real_client.post("/watermark/audio/detect", content=r.content).json()
    print("\naudio marcado:", json.dumps({k: d[k] for k in ("detected", "score", "message", "bit_confidence")}),
          f"SNR {snr:.1f} dB")
    assert d["detected"] is True and d["score"] > 0.9
    assert d["message"] == 48879 and d["bit_confidence"] > 0.3  # medido: ~0.5 con el mensaje exacto
    assert snr > 20  # marca muy por debajo de la señal


def test_audio_clean_has_no_message(real_client):
    d = real_client.post("/watermark/audio/detect", content=to_wav(_speechlike(seed=3))).json()
    print("\naudio sin marca:", json.dumps({k: d[k] for k in ("detected", "score", "message", "bit_confidence")}))
    # Voz sintética sin marca: puntajes de 0 a ~0.14 (umbral 0.3).
    assert d["detected"] is False and d["message"] is None and d["score"] < 0.2


def test_audio_long_is_marked_everywhere(real_client):
    """25 s en tres tramos: la marca y el mensaje están también en el último tramo."""
    x = _speechlike(25.0, seed=100)
    r = real_client.post("/watermark/audio/embed?message=1234", content=to_wav(x))
    assert r.status_code == 200, r.text
    marked = _wav_samples(r.content)
    assert marked.size == x.size
    for a, b in [(0, 6), (8, 12), (18, 24)]:  # incluye los bordes entre tramos (10 y 20 s)
        d = real_client.post("/watermark/audio/detect", content=to_wav(marked[a * SR : b * SR])).json()
        assert d["detected"] is True and d["message"] == 1234, (a, b, d["score"])


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg no está instalado")
def test_audio_message_survives_whatsapp_opus(real_client, tmp_path):
    r = real_client.post("/watermark/audio/embed?message=40961", content=to_wav(_speechlike(10.0, seed=7)))
    d = real_client.post("/watermark/audio/detect", content=_opus(r.content, tmp_path)).json()
    bits = (np.array(d["bits"]) > 0.5).astype(int)
    expected = [(40961 >> (15 - i)) & 1 for i in range(16)]
    print("\naudio marcado tras Opus 16 kbps:", json.dumps({k: d[k] for k in ("detected", "score", "message")}))
    assert d["detected"] is True
    assert int((bits != expected).sum()) <= 1


# --- imagen -------------------------------------------------------------------------------------


def _hex(bits: np.ndarray) -> str:
    return f"{int(''.join(map(str, bits)), 2):064x}"


def test_image_message_roundtrip(real_client):
    bits = np.random.default_rng(11).integers(0, 2, 256)
    src = _jpeg(_scene(), 95)
    r = real_client.post(f"/watermark/image/embed?message={_hex(bits)}", content=src)
    assert r.status_code == 200, r.text
    assert r.headers["x-watermark-nbits"] == "256"
    out = Image.open(io.BytesIO(r.content))
    assert out.size == (640, 480)
    a = np.asarray(out.convert("RGB"), float)
    b = np.asarray(Image.open(io.BytesIO(src)).convert("RGB"), float)
    psnr = 10 * np.log10(255**2 / np.mean((a - b) ** 2))
    d = real_client.post("/watermark/image/detect", content=r.content).json()
    print("\nimagen marcada:", d["detected"], d["score"], f"PSNR {psnr:.1f} dB")
    assert d["detected"] is True and d["message_hex"] == _hex(bits)
    assert psnr > 35


def test_image_message_survives_whatsapp(real_client):
    bits = np.random.default_rng(12).integers(0, 2, 256)
    r = real_client.post(f"/watermark/image/embed?message={_hex(bits)}", content=_jpeg(_scene(2000, 1500, 2), 95))
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    small = img.resize((1600, 1200), Image.Resampling.LANCZOS)
    d = real_client.post("/watermark/image/detect", content=_jpeg(small, 70)).json()
    dec = np.array([int(c) for c in bin(int(d["message_hex"], 16))[2:].zfill(256)])
    print("\nimagen marcada tras WhatsApp:", d["detected"], d["score"], int((dec != bits).sum()), "bits distintos")
    assert d["detected"] is True and int((dec != bits).sum()) <= 8


def test_image_screenshot_is_read_from_photo_area(real_client):
    """Captura de pantalla con barras de la app: el servicio también lee solo la zona de la foto."""
    bits = np.random.default_rng(14).integers(0, 2, 256)
    r = real_client.post(f"/watermark/image/embed?message={_hex(bits)}", content=_jpeg(_scene(1280, 960, 6), 95))
    photo = Image.open(io.BytesIO(r.content)).convert("RGB").resize((1080, 810), Image.Resampling.LANCZOS)
    shot = Image.new("RGB", (1080, 2340), (11, 20, 26))
    d = ImageDraw.Draw(shot)
    d.rectangle((0, 0, 1080, 250), fill=(31, 44, 52))
    d.text((140, 150), "Contacto (ficticio)", fill=(230, 230, 230))
    shot.paste(photo, (0, 765))
    buf = io.BytesIO()
    shot.save(buf, "PNG")
    res = real_client.post("/watermark/image/detect", content=buf.getvalue()).json()
    dec = np.array([int(c) for c in bin(int(res["message_hex"], 16))[2:].zfill(256)])
    print("\ncaptura de pantalla:", res["detected"], res["score"], int((dec != bits).sum()), "bits distintos")
    assert res["detected"] is True and int((dec != bits).sum()) <= 16


def test_image_clean_not_detected(real_client):
    d = real_client.post("/watermark/image/detect", content=_jpeg(_scene(seed=4))).json()
    assert d["detected"] is False and d["score"] < 0.6


def test_embedder_matches_full_videoseal_model():
    """El embebedor por franjas reproduce `embed` del modelo completo (si está, es solo de tests)."""
    full_path = MODELS / "videoseal" / "y_256b_img.jit"
    if not full_path.exists():
        pytest.skip(f"falta {full_path}")
    import torch

    from blindaje_ml.config import reset_settings
    from blindaje_ml.watermark import VideoSealEmbedder

    os.environ["ML_MODELS_DIR"] = str(MODELS)
    reset_settings()
    full = torch.jit.load(str(full_path), map_location="cpu").eval()
    img = _scene(900, 700, 9)
    bits = np.random.default_rng(13).integers(0, 2, 256)
    mine = np.asarray(VideoSealEmbedder().embed(img, bits)).astype(int)
    x = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)[None]
    with torch.inference_mode():
        ref = full.embed(x, torch.from_numpy(bits.astype(np.float32))[None])
    ref = (ref[0].permute(1, 2, 0).numpy() * 255).round().clip(0, 255).astype(int)
    diff = np.abs(mine - ref)
    assert diff.max() <= 1 and (diff > 0).mean() < 0.001


def test_aa_weights_match_torch_interpolate():
    import torch

    from blindaje_ml.watermark import aa_weights

    for n_in, n_out in [(1066, 256), (4000, 256), (256, 1066), (256, 3000), (100, 256), (256, 37)]:
        x = torch.rand(1, 1, n_in, 5)
        ref = torch.nn.functional.interpolate(x, size=(n_out, 5), mode="bilinear", align_corners=False,
                                              antialias=True)[0, 0].numpy()
        np.testing.assert_allclose(aa_weights(n_in, n_out) @ x[0, 0].numpy(), ref, atol=5e-5)
