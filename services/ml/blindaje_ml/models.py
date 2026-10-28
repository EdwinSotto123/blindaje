"""Modelos con carga perezosa. torch, speechbrain y transformers se importan solo al usarlos.

Los pesos se leen de `ML_MODELS_DIR` (en la imagen: `/models`, descargados durante el build);
nunca se descarga nada en tiempo de ejecución (HF_HUB_OFFLINE=1 en la imagen).
"""

from __future__ import annotations

import contextlib
import threading
import time
from collections.abc import Callable
from typing import Any

import numpy as np

from .config import get_settings
from .logs import log, log_exception

VOICE_MODEL = "speechbrain/spkrec-ecapa-voxceleb"
TEXT_MODEL = "intfloat/multilingual-e5-small"
IMAGE_MODEL = "facebook/dinov2-small"
AUDIOSEAL_MODEL = "facebook/audioseal"
VIDEOSEAL_MODEL = "facebook/videoseal"
# Para los detectores de marcas de agua, `dim` es la cantidad de bits del mensaje.
DIMS = {"voice": 192, "text": 384, "image": 384, "audioseal": 16, "videoseal": 256}
NAMES = {"voice": VOICE_MODEL, "text": TEXT_MODEL, "image": IMAGE_MODEL, "audioseal": AUDIOSEAL_MODEL,
         "videoseal": VIDEOSEAL_MODEL}

_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class ModelUnavailable(RuntimeError):
    """Faltan los pesos o las dependencias del extra `models`."""


_torch_ready = False


def _torch():
    global _torch_ready
    try:
        import torch
    except ImportError as e:
        raise ModelUnavailable("torch_not_installed") from e
    if not _torch_ready:
        torch.set_num_threads(get_settings().threads)
        _torch_ready = True
    return torch


def _flush_denormals(torch) -> None:
    """Los denormales en las activaciones de ECAPA hacen ~35 % más lenta la inferencia en CPU.
    El flag es por hilo, así que se activa en el hilo que corre cada inferencia."""
    torch.set_flush_denormal(True)


def _l2(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-12)


class EcapaEmbedder:
    name = VOICE_MODEL
    dim = 192
    batch_size = 16

    def __init__(self) -> None:
        torch = _torch()
        src = get_settings().voice_dir
        if not (src / "hyperparams.yaml").exists():
            raise ModelUnavailable("voice_weights_missing")
        try:
            from speechbrain.inference.speaker import EncoderClassifier
            from speechbrain.utils.fetching import LocalStrategy
        except ImportError as e:
            raise ModelUnavailable("speechbrain_not_installed") from e
        self._torch = torch
        self._model = EncoderClassifier.from_hparams(
            source=str(src),
            savedir=str(src),
            run_opts={"device": "cpu"},
            overrides={"pretrained_path": str(src)},
            local_strategy=LocalStrategy.NO_LINK,
        )
        self._model.eval()
        self._lock = threading.Lock()

    def embed(self, waves: list[np.ndarray]) -> np.ndarray:
        """Lotes de segmentos ordenados por largo: casi no hay relleno, que además de costar CPU
        cambia un poco el vector (las convoluciones ven los ceros del relleno)."""
        torch = self._torch
        out = np.zeros((len(waves), self.dim), dtype=np.float32)
        order = sorted(range(len(waves)), key=lambda i: waves[i].size)
        batches: list[list[int]] = []
        for i in order:  # lotes de largo parecido (a lo más 5 % de relleno)
            if batches and len(batches[-1]) < self.batch_size and waves[i].size <= 1.05 * waves[batches[-1][0]].size:
                batches[-1].append(i)
            else:
                batches.append([i])
        with self._lock, torch.inference_mode():
            _flush_denormals(torch)
            for idx in batches:
                n = max(waves[i].size for i in idx)
                x = torch.zeros(len(idx), n)
                for j, i in enumerate(idx):
                    x[j, : waves[i].size] = torch.from_numpy(np.ascontiguousarray(waves[i], dtype=np.float32))
                lens = torch.tensor([waves[i].size / n for i in idx])
                out[idx] = self._model.encode_batch(x, lens).squeeze(1).cpu().numpy()
        return _l2(out)


class E5Embedder:
    name = TEXT_MODEL
    dim = 384
    batch_size = 32
    max_length = 512

    def __init__(self) -> None:
        torch = _torch()
        src = get_settings().text_dir
        if not (src / "config.json").exists():
            raise ModelUnavailable("text_weights_missing")
        try:
            from transformers import AutoModel, AutoTokenizer
        except ImportError as e:
            raise ModelUnavailable("transformers_not_installed") from e
        self._torch = torch
        self._tok = AutoTokenizer.from_pretrained(str(src))
        self._model = AutoModel.from_pretrained(str(src)).eval()
        self._lock = threading.Lock()

    def embed(self, texts: list[str], kind: str) -> np.ndarray:
        torch = self._torch
        prefix = "query: " if kind == "query" else "passage: "
        out: list[np.ndarray] = []
        with self._lock, torch.inference_mode():
            for i in range(0, len(texts), self.batch_size):
                batch = [prefix + t for t in texts[i : i + self.batch_size]]
                enc = self._tok(batch, max_length=self.max_length, padding=True, truncation=True,
                                return_tensors="pt")
                hidden = self._model(**enc).last_hidden_state
                mask = enc["attention_mask"].unsqueeze(-1).to(hidden.dtype)
                pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
                out.append(pooled.cpu().numpy())
        return _l2(np.concatenate(out, axis=0)) if out else np.zeros((0, self.dim), np.float32)


class DinoEmbedder:
    """DINOv2 ViT-S/14. Vector = token CLS tras la capa de normalización (`pooler_output`), L2.

    Preprocesamiento propio (sin torchvision): se rellena a cuadrado con gris medio para no
    recortar placas o notas alargadas, se escala a 224x224 y se normaliza con la media de ImageNet.
    """

    name = IMAGE_MODEL
    dim = 384
    size = 224
    batch_size = 16

    def __init__(self) -> None:
        torch = _torch()
        src = get_settings().image_dir
        if not (src / "config.json").exists():
            raise ModelUnavailable("image_weights_missing")
        try:
            from transformers import AutoModel
        except ImportError as e:
            raise ModelUnavailable("transformers_not_installed") from e
        self._torch = torch
        self._model = AutoModel.from_pretrained(str(src)).eval()
        self._lock = threading.Lock()

    def _prep(self, img: Any) -> np.ndarray:
        from PIL import Image

        img = img.convert("RGB")
        w, h = img.size
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), (124, 116, 104))
        canvas.paste(img, ((side - w) // 2, (side - h) // 2))
        canvas = canvas.resize((self.size, self.size), Image.Resampling.BICUBIC)
        arr = np.asarray(canvas, dtype=np.float32) / 255.0
        return ((arr - _IMAGENET_MEAN) / _IMAGENET_STD).transpose(2, 0, 1)

    def embed(self, images: list[Any]) -> np.ndarray:
        torch = self._torch
        out: list[np.ndarray] = []
        with self._lock, torch.inference_mode():
            for i in range(0, len(images), self.batch_size):
                x = torch.from_numpy(np.stack([self._prep(im) for im in images[i : i + self.batch_size]]))
                pooled = self._model(pixel_values=x).pooler_output
                out.append(pooled.cpu().numpy())
        return _l2(np.concatenate(out, axis=0)) if out else np.zeros((0, self.dim), np.float32)


# Un modelo a la vez: los imports perezosos de transformers no son seguros entre hilos (dos cargas
# simultáneas de e5 y DINOv2 daban ImportError y 503) y además se evita sumar picos de memoria.
_LOAD_LOCK = threading.Lock()


class _Slot:
    def __init__(self, key: str, factory: Callable[[], Any]):
        self.key = key
        self.factory = factory
        self.instance: Any = None
        self.error: str | None = None
        self.load_ms: int | None = None
        self.lock = threading.Lock()

    def get(self) -> Any:
        if self.instance is not None:
            return self.instance
        with self.lock:
            if self.instance is None:
                t0 = time.perf_counter()
                try:
                    with _LOAD_LOCK:
                        self.instance = self.factory()
                except ModelUnavailable as e:
                    self.error = str(e)
                    log("model_unavailable", model=self.key, reason=self.error)
                    raise
                except Exception as e:
                    self.error = type(e).__name__
                    log_exception("model_load_failed", model=self.key)
                    raise ModelUnavailable(f"{self.key}_load_failed") from e
                self.load_ms = int((time.perf_counter() - t0) * 1000)
                self.error = None
                log("model_loaded", model=self.key, load_ms=self.load_ms)
        return self.instance

    def status(self) -> dict[str, Any]:
        return {
            "name": NAMES[self.key],
            "dim": DIMS[self.key],
            "loaded": self.instance is not None,
            "load_ms": self.load_ms,
            "error": self.error,
        }


def _audioseal() -> Any:
    from .watermark import AudioSealDetector

    return AudioSealDetector()


def _videoseal() -> Any:
    from .watermark import VideoSealDetector

    return VideoSealDetector()


class Registry:
    def __init__(self, factories: dict[str, Callable[[], Any]] | None = None):
        f = factories or {"voice": EcapaEmbedder, "text": E5Embedder, "image": DinoEmbedder,
                          "audioseal": _audioseal, "videoseal": _videoseal}
        self._slots = {k: _Slot(k, v) for k, v in f.items()}

    def get(self, key: str) -> Any:
        if key not in self._slots:
            raise ModelUnavailable(f"{key}_not_configured")
        return self._slots[key].get()

    def status(self) -> dict[str, dict[str, Any]]:
        return {k: s.status() for k, s in self._slots.items()}

    def preload(self, keys: tuple[str, ...]) -> None:
        wanted = list(self._slots) if "all" in keys else [k for k in keys if k in self._slots]
        for k in wanted:
            with contextlib.suppress(ModelUnavailable):
                self._slots[k].get()
