from __future__ import annotations

import hashlib
import io
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from blindaje_ml.app import create_app
from blindaje_ml.config import reset_settings
from blindaje_ml.indices import IndexStore
from blindaje_ml.models import Registry
from blindaje_ml.voice import Cohort

SR = 16_000
HAS_FFMPEG = shutil.which("ffmpeg") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg no está instalado")


def tone(freq: float, seconds: float, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(SR * seconds)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SR * seconds), dtype=np.float32)


def to_wav(x: np.ndarray, sr: int = SR) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def ffmpeg_encode(src: bytes, args: list[str], suffix: str, tmp_path: Path) -> bytes:
    i = tmp_path / f"src-{hashlib.md5(src).hexdigest()[:8]}.wav"
    o = tmp_path / f"out{suffix}"
    i.write_bytes(src)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(i), *args, str(o)],
                   check=True)
    return o.read_bytes()


class FakeVoice:
    """'Hablante' = frecuencia dominante del tono. Misma frecuencia, mismo vector."""

    name = "fake/voice"
    dim = 192

    def __init__(self) -> None:
        self.calls = 0

    def embed(self, waves: list[np.ndarray]) -> np.ndarray:
        self.calls += 1
        out = np.zeros((len(waves), self.dim), dtype=np.float32)
        for i, w in enumerate(waves):
            spec = np.abs(np.fft.rfft(w))
            freq = np.argmax(spec) * SR / w.size
            center = min(self.dim - 1, int(freq / 10))
            idx = np.arange(self.dim)
            out[i] = np.exp(-0.5 * ((idx - center) / 3.0) ** 2) + 0.01
        return out / np.linalg.norm(out, axis=1, keepdims=True)


class FakeText:
    name = "fake/text"
    dim = 384

    def embed(self, texts: list[str], kind: str) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            for tok in t.lower().split():
                out[i, int(hashlib.md5(tok.encode()).hexdigest(), 16) % self.dim] += 1
        out += 1e-3
        return out / np.linalg.norm(out, axis=1, keepdims=True)


class FakeImage:
    name = "fake/image"
    dim = 384

    def embed(self, images: list) -> np.ndarray:
        out = np.zeros((len(images), self.dim), dtype=np.float32)
        for i, im in enumerate(images):
            h = np.asarray(im.convert("RGB").resize((8, 16))).astype(np.float32).reshape(-1)
            out[i] = h[: self.dim] + 1.0
        return out / np.linalg.norm(out, axis=1, keepdims=True)


@pytest.fixture
def fakes() -> dict:
    return {"voice": FakeVoice(), "text": FakeText(), "image": FakeImage()}


@pytest.fixture
def make_client(tmp_path, monkeypatch, fakes):
    def _make(token: str | None = None, max_body_mb: str | None = None) -> TestClient:
        monkeypatch.setenv("ML_MODELS_DIR", str(tmp_path / "models"))
        if token:
            monkeypatch.setenv("ML_TOKEN", token)
        else:
            monkeypatch.delenv("ML_TOKEN", raising=False)
        if max_body_mb:
            monkeypatch.setenv("ML_MAX_BODY_MB", max_body_mb)
        reset_settings()
        registry = Registry({k: (lambda v=v: v) for k, v in fakes.items()})
        app = create_app(registry=registry, store=IndexStore(), cohort=Cohort(tmp_path / "cohort.npy"))
        return TestClient(app)

    yield _make
    reset_settings()


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()
