"""Detectores de marcas de agua de Meta: AudioSeal (audio) y Video Seal (imagen y video).

Carga perezosa como el resto de los modelos: torch y audioseal se importan al primer uso. Los pesos
se leen de `ML_MODELS_DIR` (en la imagen, horneados en el build); nunca se descarga nada.

- AudioSeal (`facebook/audioseal`, MIT, código y pesos): el detector da, para cada muestra a 16 kHz,
  la probabilidad de que tenga marca. Puntaje = fracción de muestras con probabilidad > 0.5.
- Video Seal 1.0 (`facebookresearch/videoseal`, MIT): el extractor devuelve 256 bits (logits). No
  hay un canal de "presencia", así que el puntaje es la confianza media de los bits:
  mean(|2·sigmoid(logit) − 1|). Una imagen sin marca da bits al azar con poca confianza; una con
  marca, bits muy confiados. En video se promedian los logits de los cuadros antes de medir.

Los umbrales están calibrados en `docs/devlog/ml.md` (fotos y audios sin marca contra los mismos con
marca, con y sin compresión de WhatsApp).
"""

from __future__ import annotations

import os
import threading
from typing import Any

import numpy as np

from .config import get_settings
from .models import ModelUnavailable, _torch

# audioseal envuelve capas en torch.compile al importarse; en la imagen no hay compilador de C y en
# CPU no hace falta. Tiene que estar definido antes del primer import del paquete.
os.environ.setdefault("NO_TORCH_COMPILE", "1")

AUDIOSEAL_NAME = "audioseal-16bits"
VIDEOSEAL_NAME = "videoseal-1.0"
AUDIO_SR = 16_000

# Fracción de muestras marcadas a partir de la cual se declara la marca. Audio sin marca: ≤ 0.015;
# con marca y Opus a 16 kbps: ≥ 0.49 (calibración en el devlog).
AUDIOSEAL_THRESHOLD = 0.3
# Confianza media de los bits. Fotos sin marca: 0.09 a 0.50; con marca, también tras JPEG 60,
# recorte y doble reenvío: ≥ 0.93.
VIDEOSEAL_THRESHOLD = 0.8


def bit_confidence(logits: np.ndarray) -> float:
    """Confianza media de los bits de Video Seal, en [0, 1]."""
    x = np.asarray(logits, dtype=np.float64)
    return float(np.mean(np.abs(2.0 / (1.0 + np.exp(-x)) - 1.0)))


def audio_windows(n_samples: int, max_s: float, chunk_s: float = 10.0) -> list[tuple[int, int]]:
    """Ventanas de `chunk_s` a revisar. Si el audio supera `max_s`, se reparten a lo largo de todo el
    audio (no solo el comienzo) para no perder un tramo sintético empalmado al final."""
    chunk = int(chunk_s * AUDIO_SR)
    starts = list(range(0, n_samples, chunk))
    budget = max(1, int(max_s // chunk_s))
    if len(starts) > budget:
        idx = np.linspace(0, len(starts) - 1, budget).round().astype(int)
        starts = [starts[i] for i in sorted(set(idx.tolist()))]
    return [(s, min(n_samples, s + chunk)) for s in starts if min(n_samples, s + chunk) - s >= AUDIO_SR // 10]


class AudioSealDetector:
    name = AUDIOSEAL_NAME
    dim = 16  # bits del mensaje
    threshold = AUDIOSEAL_THRESHOLD

    def __init__(self) -> None:
        torch = _torch()
        src = get_settings().audioseal_dir / "detector_base.pth"
        if not src.exists():
            raise ModelUnavailable("audioseal_weights_missing")
        try:
            from audioseal.builder import AudioSealDetectorConfig, create_detector
            from audioseal.loader import (
                AudioSeal,
                convert_state_dict_for_scriptable_model,
                load_local_model_config,
                load_state_dict,
            )
            from omegaconf import OmegaConf
        except ImportError as e:
            raise ModelUnavailable("audioseal_not_installed") from e
        cfg = OmegaConf.to_container(load_local_model_config("audioseal_detector_16bits"))
        cfg.pop("checkpoint", None)  # la tarjeta apunta a Hugging Face; se usa el archivo local
        ckpt = torch.load(src, map_location="cpu", weights_only=False)  # SHA-256 fijado en el build
        cfg = {**ckpt.get("xp.cfg", {}), **cfg}
        conf = AudioSeal.parse_config(cfg, config_type=AudioSealDetectorConfig)
        model = create_detector(conf)
        load_state_dict(model, state_dict=convert_state_dict_for_scriptable_model(ckpt["model"]))
        self._model = model.eval()
        self._torch = torch
        self._lock = threading.Lock()

    def detect(self, samples: np.ndarray, max_s: float | None = None) -> dict[str, Any]:
        """`samples`: mono 16 kHz float32 en [-1, 1]. Devuelve score, detected y segundos revisados."""
        torch = self._torch
        max_s = get_settings().wm_audio_max_s if max_s is None else max_s
        windows = audio_windows(samples.size, max_s)
        positive = total = 0
        with self._lock, torch.inference_mode():
            for a, b in windows:
                x = torch.from_numpy(np.ascontiguousarray(samples[a:b], dtype=np.float32))[None, None]
                result, _ = self._model(x)  # (1, 2, T): probabilidad sin/con marca por muestra
                positive += int((result[0, 1] > 0.5).sum())
                total += int(result.shape[-1])
        score = positive / total if total else 0.0
        return {
            "score": round(score, 4),
            "detected": bool(total and score >= self.threshold),
            "seconds": round(total / AUDIO_SR, 2),
        }


class VideoSealDetector:
    """Solo el extractor de Video Seal 1.0 (TorchScript), sin el embebedor: la mitad de memoria."""

    name = VIDEOSEAL_NAME
    dim = 256
    size = 256  # el modelo redimensiona cada cuadro a 256 x 256 (bilineal con antialias)
    batch_size = 8
    threshold = VIDEOSEAL_THRESHOLD

    def __init__(self) -> None:
        torch = _torch()
        src = get_settings().videoseal_dir / "detector.jit"
        if not src.exists():
            raise ModelUnavailable("videoseal_weights_missing")
        self._torch = torch
        self._model = torch.jit.load(str(src), map_location="cpu").eval()
        self._lock = threading.Lock()

    def _prep(self, img: Any) -> np.ndarray:
        from PIL import Image

        small = img.convert("RGB").resize((self.size, self.size), Image.Resampling.BILINEAR)
        return (np.asarray(small, dtype=np.float32) / 255.0).transpose(2, 0, 1)

    def logits(self, images: list[Any]) -> np.ndarray:
        """Logits de los 256 bits por imagen: (n, 256)."""
        torch = self._torch
        out: list[np.ndarray] = []
        with self._lock, torch.inference_mode():
            for i in range(0, len(images), self.batch_size):
                x = torch.from_numpy(np.stack([self._prep(im) for im in images[i : i + self.batch_size]]))
                preds = self._model(x)  # (b, 1 + 256): canal 0 sin uso, luego los bits
                out.append(preds[:, 1:].cpu().numpy())
        return np.concatenate(out, axis=0) if out else np.zeros((0, self.dim), np.float32)

    def detect(self, images: list[Any]) -> dict[str, Any]:
        logits = self.logits(images)
        score = bit_confidence(logits.mean(axis=0)) if len(logits) else 0.0
        return {"score": round(score, 4), "detected": bool(len(logits) and score >= self.threshold),
                "frames": len(logits)}
