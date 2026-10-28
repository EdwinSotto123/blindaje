"""Marcas de agua de Meta con los modelos reales: AudioSeal y Video Seal.

Insertan la marca con el generador de cada proyecto (solo para tests: el generador de AudioSeal y el
modelo completo de Video Seal no van en la imagen final) y comprueban que el servicio la detecta, y
que el mismo archivo sin marca no da positivo.

    uv sync --extra dev --extra models
    uv run python scripts/download_models.py
    uv run pytest -m heavy tests/test_authenticity_heavy.py -s   # -s muestra el informe de foto-A
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

from .conftest import HAS_FFMPEG, assert_senales, to_wav

pytestmark = pytest.mark.heavy

# Antes de cualquier import de audioseal: su generador envuelve capas en torch.compile.
os.environ.setdefault("NO_TORCH_COMPILE", "1")

_DEFAULT_MODELS = Path(__file__).resolve().parent.parent / "models"
MODELS = Path(os.environ.get("ML_MODELS_DIR", _DEFAULT_MODELS))
FOTO_A = Path(__file__).resolve().parents[3] / "eval" / "demo" / "foto-A.jpg"
SR = 16_000


def _have() -> bool:
    if importlib.util.find_spec("audioseal") is None or importlib.util.find_spec("torch") is None:
        return False
    return (MODELS / "audioseal" / "detector_base.pth").exists() and (MODELS / "videoseal" / "detector.jit").exists()


if not _have():
    pytest.skip("faltan el extra models o los pesos de AudioSeal y Video Seal", allow_module_level=True)


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


# --- AudioSeal ---------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def audioseal_generator():
    path = MODELS / "audioseal" / "generator_base.pth"
    if not path.exists():
        pytest.skip(f"falta {path} (generador de AudioSeal, solo para tests)")
    import torch
    from audioseal.builder import AudioSealWMConfig, create_generator
    from audioseal.loader import AudioSeal, convert_state_dict_for_scriptable_model, load_local_model_config
    from audioseal.loader import load_state_dict as as_load_state_dict
    from omegaconf import OmegaConf

    cfg = OmegaConf.to_container(load_local_model_config("audioseal_wm_16bits"))
    cfg.pop("checkpoint")
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    conf = AudioSeal.parse_config({**ckpt.get("xp.cfg", {}), **cfg}, config_type=AudioSealWMConfig)
    gen = create_generator(conf)
    as_load_state_dict(gen, convert_state_dict_for_scriptable_model(ckpt["model"]))
    return gen.eval()


def _speechlike(seconds: float = 8.0, seed: int = 0) -> np.ndarray:
    """Señal parecida a voz (sin licencias de por medio): armónicos con vibrato, sílabas y ruido."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(SR * seconds)) / SR
    f0 = 140 + 25 * np.sin(2 * np.pi * 0.7 * t) + 10 * np.sin(2 * np.pi * 5.3 * t)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    x = sum((0.5 / k) * np.sin(k * phase) for k in range(1, 12))
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 3.1 * t) ** 2
    x = x * envelope + 0.01 * rng.standard_normal(t.size)
    return (0.3 * x / np.abs(x).max()).astype(np.float32)


def _watermark_audio(gen, x: np.ndarray) -> np.ndarray:
    import torch

    with torch.inference_mode():
        wav = torch.from_numpy(x)[None, None]
        msg = torch.randint(0, 2, (1, 16))
        return (wav + gen.get_watermark(wav, SR, message=msg))[0, 0].numpy()


def _opus(x: np.ndarray, tmp: Path, bitrate: str = "16k") -> bytes:
    src, dst = tmp / "wm.wav", tmp / "wm.ogg"
    src.write_bytes(to_wav(x))
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-c:a", "libopus",
                    "-b:a", bitrate, str(dst)], check=True)
    return dst.read_bytes()


def test_audioseal_detects_own_watermark(real_client, audioseal_generator):
    x = _speechlike()
    marked = _watermark_audio(audioseal_generator, x)
    r = real_client.post("/authenticity/audio", content=to_wav(marked))
    assert r.status_code == 200, r.text
    body = r.json()
    assert_senales(body)
    wm = body["watermark"]
    print("\naudio con marca:", json.dumps(wm))
    assert wm["detector"] == "audioseal-16bits" and wm["detected"] is True and wm["score"] > 0.9


def test_audioseal_clean_audio_not_detected(real_client):
    r = real_client.post("/authenticity/audio", content=to_wav(_speechlike()))
    assert r.status_code == 200, r.text
    wm = r.json()["watermark"]
    print("\naudio sin marca:", json.dumps(wm))
    assert wm["detected"] is False and wm["score"] < 0.05


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg no está instalado")
def test_audioseal_survives_whatsapp_opus(real_client, audioseal_generator, tmp_path):
    marked = _watermark_audio(audioseal_generator, _speechlike(seed=1))
    wm = real_client.post("/authenticity/audio", content=_opus(marked, tmp_path)).json()["watermark"]
    print("\naudio con marca tras Opus 16 kbps:", json.dumps(wm))
    assert wm["detected"] is True


# --- Video Seal --------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def videoseal_full():
    path = MODELS / "videoseal" / "y_256b_img.jit"
    if not path.exists():
        pytest.skip(f"falta {path} (modelo completo de Video Seal, solo para tests)")
    import torch

    return torch.jit.load(str(path), map_location="cpu").eval()


def _scene(w: int = 640, h: int = 480, seed: int = 0) -> Image.Image:
    """Escena con textura (la marca se esconde en zonas con detalle), sin fotos de terceros."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.stack([120 + 60 * np.sin(xx / 37.0), 110 + 50 * np.cos(yy / 23.0), 90 + 40 * np.sin((xx + yy) / 51.0)],
                    axis=-1)
    base += rng.normal(0, 18, base.shape)
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    d = ImageDraw.Draw(img)
    for _ in range(25):
        x, y = int(rng.integers(0, w - 60)), int(rng.integers(0, h - 60))
        color = tuple(int(c) for c in rng.integers(0, 255, 3))
        d.rectangle((x, y, x + int(rng.integers(10, 60)), y + int(rng.integers(10, 60))), fill=color)
    d.text((20, 20), "BODEGA", fill=(250, 250, 250))
    return img


def _jpeg(img: Image.Image, q: int = 85) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q)
    return buf.getvalue()


def _embed(model, img: Image.Image) -> Image.Image:
    import torch

    x = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)[None]
    with torch.inference_mode():
        y = model.embed(x, torch.randint(0, 2, (1, 256)).float())
    return Image.fromarray((y[0].permute(1, 2, 0).numpy() * 255).round().clip(0, 255).astype(np.uint8))


def test_videoseal_detects_own_watermark(real_client, videoseal_full):
    marked = _embed(videoseal_full, _scene())
    r = real_client.post("/authenticity/image", content=_jpeg(marked))
    assert r.status_code == 200, r.text
    body = r.json()
    assert_senales(body)
    wm = body["watermark"]
    print("\nimagen con marca:", json.dumps(wm))
    assert wm["detector"] == "videoseal-1.0" and wm["detected"] is True and wm["score"] > 0.9
    # Reenvío por WhatsApp: lado mayor 1280 → aquí, reducir a la mitad y JPEG 60.
    small = Image.open(io.BytesIO(_jpeg(marked))).resize((320, 240))
    wm2 = real_client.post("/authenticity/image", content=_jpeg(small, 60)).json()["watermark"]
    print("imagen con marca, reducida y JPEG 60:", json.dumps(wm2))
    assert wm2["detected"] is True


def test_videoseal_clean_image_not_detected(real_client):
    wm = real_client.post("/authenticity/image", content=_jpeg(_scene())).json()["watermark"]
    print("\nimagen sin marca:", json.dumps(wm))
    assert wm["detected"] is False and wm["score"] < 0.6


def _ffmpeg(args: list[str], data: bytes | None = None) -> bytes:
    return subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], input=data,
                          capture_output=True, check=True).stdout


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg no está instalado")
def test_videoseal_video_with_and_without_watermark(real_client, videoseal_full, tmp_path):
    """Video con movimiento suave y textura (zoom de Mandelbrot de ffmpeg), marcado en modo video y
    comprimido en H.264 CRF 12. Con más compresión el puntaje baja (CRF 18: ~0.8; CRF 28: ~0.5, ver
    el devlog): Video Seal en video comprimido es menos robusto que en imagen."""
    import torch

    w, h, n = 640, 480, 16
    raw = _ffmpeg(["-f", "lavfi", "-i", f"mandelbrot=size={w}x{h}:rate=24", "-frames:v", str(n),
                   "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    clean = np.frombuffer(raw, np.uint8).reshape(n, h, w, 3)
    x = torch.from_numpy(clean.astype(np.float32) / 255.0).permute(0, 3, 1, 2)
    with torch.inference_mode():
        y = videoseal_full.embed(x, torch.randint(0, 2, (1, 256)).float(), is_video=True)
    marked = (y.permute(0, 2, 3, 1).numpy() * 255).round().clip(0, 255).astype(np.uint8)

    def encode(arr: np.ndarray, name: str) -> bytes:
        out = tmp_path / name
        _ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", "24", "-i", "-",
                 "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", str(out)], arr.tobytes())
        return out.read_bytes()

    r = real_client.post("/authenticity/video?frames=8", content=encode(marked, "wm.mp4"))
    assert r.status_code == 200, r.text
    assert_senales(r.json())
    wm = r.json()["watermark"]
    print("\nvideo con marca (H.264 CRF 12):", json.dumps(wm))
    assert wm["detector"] == "videoseal-1.0" and wm["frames_checked"] == 8
    assert wm["detected"] is True
    wm0 = real_client.post("/authenticity/video?frames=8", content=encode(clean, "clean.mp4")).json()["watermark"]
    print("video sin marca:", json.dumps(wm0))
    assert wm0["detected"] is False


# --- La foto del demo (generada con Muse Image de Meta) -------------------------------------------


def test_demo_photo_report(real_client):
    """Informa qué señales trae foto-A.jpg sin suponer el resultado (solo valida el contrato)."""
    if not FOTO_A.exists():
        pytest.skip(f"falta {FOTO_A}")
    r = real_client.post("/authenticity/image", content=FOTO_A.read_bytes())
    assert r.status_code == 200, r.text
    body = r.json()
    assert_senales(body)
    print("\nfoto-A.jpg (Muse Image):", json.dumps(body, ensure_ascii=False, indent=1))
