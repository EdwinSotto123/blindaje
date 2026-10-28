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
HAS_FFPROBE = shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg no está instalado")
needs_ffprobe = pytest.mark.skipif(not (HAS_FFMPEG and HAS_FFPROBE), reason="ffmpeg o ffprobe no están instalados")


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


class FakeAudioSeal:
    """Sin modelo: nunca detecta marca."""

    name = "fake/audioseal"
    dim = 16

    def detect(self, samples: np.ndarray, max_s: float | None = None) -> dict:
        return {"score": 0.0, "detected": False, "seconds": round(samples.size / SR, 2)}

    def decode(self, samples: np.ndarray, max_s: float | None = None) -> dict:
        bits = [0.9 if i % 2 else 0.1 for i in range(self.dim)]
        return {**self.detect(samples, max_s), "bits": bits, "message": None, "bit_confidence": 0.8}


class FakeAudioSealEmbedder:
    """Devuelve el audio tal cual y anota el mensaje pedido."""

    name = "fake/audioseal-embedder"
    dim = 16

    def __init__(self) -> None:
        self.messages: list[int] = []

    def embed(self, samples: np.ndarray, message: int) -> np.ndarray:
        self.messages.append(message)
        return samples.copy()


class FakeVideoSeal:
    name = "fake/videoseal"
    dim = 256

    def __init__(self) -> None:
        self.frames = 0

    def detect(self, images: list) -> dict:
        self.frames += len(images)
        return {"score": 0.1, "detected": False, "frames": len(images)}

    def decode(self, images: list) -> dict:
        return {**self.detect(images), "bits": [0.5] * self.dim, "message_hex": "0" * (self.dim // 4)}


class FakeVideoSealEmbedder:
    """Devuelve la imagen tal cual y anota los bits pedidos."""

    name = "fake/videoseal-embedder"
    nbits = 256
    dim = 256

    def __init__(self) -> None:
        self.bits: list[np.ndarray] = []

    def embed(self, img, bits: np.ndarray):
        self.bits.append(np.asarray(bits))
        return img.copy()


class FakePromptGuard:
    """'Inyección' = el texto pide ignorar instrucciones. Una ventana por cada 2000 caracteres."""

    name = "fake/prompt-guard"

    def __init__(self) -> None:
        self.calls = 0

    def score(self, texts: list[str]) -> list[dict]:
        self.calls += 1
        out = []
        for t in texts:
            low = t.lower()
            score = 0.97 if ("ignora" in low or "ignore" in low) else 0.02
            out.append({"score": score if t.strip() else 0.0, "chunks": 0 if not t.strip() else 1 + len(t) // 2000})
        return out


def assert_senales(body: dict) -> None:
    """La respuesta cumple `SenalesTecnicas` (packages/shared/src/authenticity.ts), con tipos exactos."""
    assert set(body) == {"watermark", "c2pa", "metadata", "synthetic_speech"}
    wm = body["watermark"]
    if wm is not None:
        assert set(wm) <= {"detector", "detected", "score", "frames_checked"}
        assert isinstance(wm["detector"], str) and isinstance(wm["detected"], bool)
        assert isinstance(wm["score"], (int, float)) and 0 <= wm["score"] <= 1
        if "frames_checked" in wm:
            assert isinstance(wm["frames_checked"], int)
    c2 = body["c2pa"]
    if c2 is not None:
        assert set(c2) == {"present", "ai_generated", "generator", "claims"}
        assert isinstance(c2["present"], bool) and c2["ai_generated"] in (True, False, None)
        assert c2["generator"] is None or isinstance(c2["generator"], str)
        assert all(isinstance(x, str) for x in c2["claims"])
    md = body["metadata"]
    if md is not None:
        assert set(md) == {"present", "software", "digital_source_type", "suspicious", "fields"}
        assert isinstance(md["present"], bool)
        assert md["software"] is None or isinstance(md["software"], str)
        assert md["digital_source_type"] is None or isinstance(md["digital_source_type"], str)
        assert all(isinstance(x, str) for x in md["suspicious"])
        assert all(isinstance(k, str) and isinstance(v, str) for k, v in md["fields"].items())
    ss = body["synthetic_speech"]
    if ss is not None:
        assert set(ss) == {"detector", "score", "available"}
        assert isinstance(ss["available"], bool) and isinstance(ss["score"], (int, float))


@pytest.fixture
def fakes() -> dict:
    return {"voice": FakeVoice(), "text": FakeText(), "image": FakeImage(), "audioseal": FakeAudioSeal(),
            "videoseal": FakeVideoSeal(), "audioseal_embedder": FakeAudioSealEmbedder(),
            "videoseal_embedder": FakeVideoSealEmbedder(), "prompt_guard": FakePromptGuard()}


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
