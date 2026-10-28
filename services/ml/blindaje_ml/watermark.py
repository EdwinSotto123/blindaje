"""Marcas de agua de Meta: AudioSeal (audio) y Video Seal (imagen y video).

Dos usos:
- Autenticidad (`/authenticity/*`): ¿el archivo trae la marca de un generador de IA? Solo detectores.
- Trazabilidad de filtraciones (`/watermark/*`): cada audio o imagen que muestra la consola lleva una
  marca invisible con un mensaje (quién lo vio). Si la evidencia se filtra, se decodifica el mensaje
  de la copia filtrada. Aquí sí se insertan marcas: generador de AudioSeal y embebedor de Video Seal.

Carga perezosa como el resto de los modelos: torch y audioseal se importan al primer uso. Los pesos
se leen de `ML_MODELS_DIR` (en la imagen, horneados en el build); nunca se descarga nada.

- AudioSeal (`facebook/audioseal`, MIT, código y pesos): el detector da, para cada muestra a 16 kHz,
  la probabilidad de que tenga marca y 16 logits de bits. Puntaje = fracción de muestras con
  probabilidad > 0.5. Mensaje = sigmoid del promedio de los logits de bits sobre las muestras marcadas
  (como `decode_message` de audioseal, pero sin mezclar tramos sin marca).
- Video Seal 1.0 (`facebookresearch/videoseal`, MIT): el extractor devuelve 256 bits (logits). No
  hay un canal de "presencia", así que el puntaje es la confianza media de los bits:
  mean(|2·sigmoid(logit) − 1|). Una imagen sin marca da bits al azar con poca confianza; una con
  marca, bits muy confiados. En video se promedian los logits de los cuadros antes de medir.

Convención de mensajes (la misma en la API): bits en orden MSB primero. Audio: el entero 0..65535
son los 16 bits, `bit[i] = (mensaje >> (15 - i)) & 1`. Imagen: 64 caracteres hex, el primer carácter
son los bits 0 a 3.

Los umbrales están calibrados en `docs/devlog/ml.md` (fotos y audios sin marca contra los mismos con
marca, con y sin compresión de WhatsApp).
"""

from __future__ import annotations

import json
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
# Muestras marcadas mínimas (0.5 s) para leer el mensaje solo de ellas; con menos, de todo el audio.
_MIN_MARKED = AUDIO_SR // 2
# AudioSeal trabaja en cuadros de 320 muestras (SEANet con pasos 8, 5, 4 y 2). Medido: el mensaje solo
# se lee bien si el audio empieza en el borde de un cuadro (tolerancia de ~4 muestras).
AUDIOSEAL_HOP = 320


# --- mensajes ---------------------------------------------------------------------------------


def int_to_bits(value: int, nbits: int) -> np.ndarray:
    """Entero a `nbits` bits (0/1), MSB primero."""
    if not 0 <= int(value) < (1 << nbits):
        raise ValueError("invalid_message")
    return np.array([(int(value) >> (nbits - 1 - i)) & 1 for i in range(nbits)], dtype=np.uint8)


def bits_to_int(bits: Any) -> int:
    out = 0
    for b in np.asarray(bits).reshape(-1):
        out = (out << 1) | int(bool(b))
    return out


def hex_to_bits(message: str, nbits: int) -> np.ndarray:
    """Hex de exactamente nbits/4 caracteres (mayúsculas o minúsculas) a bits, MSB primero."""
    s = (message or "").strip().lower()
    if nbits % 4 or len(s) != nbits // 4 or any(c not in "0123456789abcdef" for c in s):
        raise ValueError("invalid_message")
    return int_to_bits(int(s, 16), nbits)


def bits_to_hex(bits: Any) -> str:
    b = np.asarray(bits).reshape(-1)
    return f"{bits_to_int(b):0{len(b) // 4}x}"


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 0.5 * (1.0 + np.tanh(0.5 * np.asarray(x, dtype=np.float64)))


def bit_confidence(logits: np.ndarray) -> float:
    """Confianza media de los bits de Video Seal, en [0, 1]."""
    x = np.asarray(logits, dtype=np.float64)
    return float(np.mean(np.abs(2.0 * _sigmoid(x) - 1.0)))


# --- audio: ventanas y tramos -------------------------------------------------------------------


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


def embed_plan(n: int, chunk: int, overlap: int, min_tail: int) -> list[tuple[int, int, np.ndarray]]:
    """Tramos (a, b, peso) para insertar la marca por partes con memoria acotada.

    Cada tramo de `chunk` muestras se procesa con `overlap` muestras extra a cada lado y en los bordes
    internos la marca de dos tramos vecinos se funde con rampas lineales complementarias (los pesos
    suman 1 en cada muestra). Un resto final de menos de `min_tail` muestras se une al tramo anterior.
    """
    if n <= 0:
        return []
    starts = list(range(0, n, chunk))
    ends = [*starts[1:], n]
    if len(starts) > 1 and n - starts[-1] < min_tail:
        starts.pop()
        ends.pop()
        ends[-1] = n
    plan = []
    for s, e in zip(starts, ends, strict=True):
        a, b = max(0, s - overlap), min(n, e + overlap)
        t = np.arange(a, b, dtype=np.float64) + 0.5
        w = np.ones(b - a, dtype=np.float64)
        if s > 0:
            w *= np.clip((t - (s - overlap)) / (2 * overlap), 0.0, 1.0)
        if e < n:
            w *= np.clip(((e + overlap) - t) / (2 * overlap), 0.0, 1.0)
        plan.append((a, b, w.astype(np.float32)))
    return plan


def audio_bits(sum_marked: np.ndarray, n_marked: int, sum_all: np.ndarray, n_all: int) -> np.ndarray:
    """Probabilidad de cada bit: sigmoid del logit medio sobre las muestras marcadas (si hay al menos
    0.5 s) o sobre todo lo revisado."""
    if n_marked >= _MIN_MARKED:
        mean = np.asarray(sum_marked, dtype=np.float64) / n_marked
    elif n_all:
        mean = np.asarray(sum_all, dtype=np.float64) / n_all
    else:
        mean = np.zeros_like(np.asarray(sum_all, dtype=np.float64))
    return _sigmoid(mean)


# --- imagen: remuestreo -------------------------------------------------------------------------


def aa_weights(n_in: int, n_out: int) -> np.ndarray:
    """Matriz (n_out, n_in) del remuestreo bilineal con antialias de PyTorch (`interpolate(...,
    mode="bilinear", align_corners=False, antialias=True)`, que a su vez reproduce PIL). Separable:
    una imagen se remuestrea con `Wy @ img @ Wx.T`, también por franjas de filas."""
    scale = n_in / n_out
    support = scale if scale >= 1.0 else 1.0
    invscale = 1.0 / scale if scale >= 1.0 else 1.0
    out = np.zeros((n_out, n_in), dtype=np.float64)
    for i in range(n_out):
        center = scale * (i + 0.5)
        lo = max(int(center - support + 0.5), 0)
        hi = min(int(center + support + 0.5), n_in)
        j = np.arange(lo, hi, dtype=np.float64)
        w = np.clip(1.0 - np.abs((j - center + 0.5) * invscale), 0.0, None)
        total = w.sum()
        if total > 0:
            out[i, lo:hi] = w / total
    return out.astype(np.float32)


# --- AudioSeal ----------------------------------------------------------------------------------


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

    def _raw(self, segments: list[np.ndarray]) -> Any:
        """Salida cruda del detector para segmentos del mismo largo: (n, 2 + bits, T)."""
        torch = self._torch
        x = torch.from_numpy(np.ascontiguousarray(np.stack(segments), dtype=np.float32))[:, None]
        normalizer = getattr(self._model, "normalizer", None)
        if normalizer is not None:
            x = normalizer.loudness_normalization(x)
        return self._model.detector(x)

    def _scan(self, samples: np.ndarray, max_s: float | None) -> dict[str, Any]:
        torch = self._torch
        max_s = get_settings().wm_audio_max_s if max_s is None else max_s
        positive = total = 0
        sum_marked = np.zeros(self.dim, dtype=np.float64)
        sum_all = np.zeros(self.dim, dtype=np.float64)
        for a, b in audio_windows(samples.size, max_s):
            raw = self._raw([samples[a:b]])[0]  # (2 + bits, T): presencia (sin softmax) y logits de bits
            marked = torch.softmax(raw[:2], dim=0)[1] > 0.5
            bits = raw[2:].double()
            n_pos = int(marked.sum())
            positive += n_pos
            total += int(raw.shape[-1])
            sum_all += bits.sum(dim=-1).numpy()
            if n_pos:
                sum_marked += bits[:, marked].sum(dim=-1).numpy()
        return {"positive": positive, "total": total, "sum_marked": sum_marked, "sum_all": sum_all}

    def detect(self, samples: np.ndarray, max_s: float | None = None) -> dict[str, Any]:
        """`samples`: mono 16 kHz float32 en [-1, 1]. Devuelve score, detected y segundos revisados."""
        with self._lock, self._torch.inference_mode():
            s = self._scan(samples, max_s)
        total = s["total"]
        score = s["positive"] / total if total else 0.0
        return {
            "score": round(score, 4),
            "detected": bool(total and score >= self.threshold),
            "seconds": round(total / AUDIO_SR, 2),
        }

    def decode(self, samples: np.ndarray, max_s: float | None = None) -> dict[str, Any]:
        """Lo de `detect` más el mensaje: probabilidad de cada bit, el entero (solo si hay marca) y la
        confianza media de los bits.

        Límite medido: el mensaje solo se lee si el audio conserva la alineación con los cuadros de 320
        muestras desde el inicio (el archivo entero, también recodificado en Opus). Un fragmento cortado
        en cualquier punto suele perder el mensaje; buscar la alineación fue poco confiable o caro
        (ver docs/ML_API.md)."""
        with self._lock, self._torch.inference_mode():
            s = self._scan(samples, max_s)
        total = s["total"]
        score = s["positive"] / total if total else 0.0
        detected = bool(total and score >= self.threshold)
        bits = audio_bits(s["sum_marked"], s["positive"], s["sum_all"], total)
        return {
            "score": round(score, 4),
            "detected": detected,
            "seconds": round(total / AUDIO_SR, 2),
            "bits": [round(float(b), 4) for b in bits],
            "message": bits_to_int(bits > 0.5) if detected else None,
            "bit_confidence": round(float(np.mean(np.abs(2.0 * bits - 1.0))), 4),
        }


class AudioSealEmbedder:
    """Generador de AudioSeal de 16 bits (`audioseal_wm_16bits`), el par del detector de arriba."""

    name = AUDIOSEAL_NAME
    dim = 16
    # Tramos de 10 s (memoria acotada en audios largos) con 0.3 s extra a cada lado y fundido de 0.6 s.
    # Todo múltiplo de 320 muestras: cada tramo empieza en el borde de un cuadro de AudioSeal, así la
    # marca de todos los tramos queda en la misma grilla que el detector lee desde el inicio.
    chunk_s = 10.0
    overlap_s = 0.3
    min_tail_s = 1.0

    def __init__(self) -> None:
        torch = _torch()
        src = get_settings().audioseal_dir / "generator_base.pth"
        if not src.exists():
            raise ModelUnavailable("audioseal_generator_missing")
        try:
            from audioseal.builder import AudioSealWMConfig, create_generator
            from audioseal.loader import (
                AudioSeal,
                convert_state_dict_for_scriptable_model,
                load_local_model_config,
                load_state_dict,
            )
            from omegaconf import OmegaConf
        except ImportError as e:
            raise ModelUnavailable("audioseal_not_installed") from e
        cfg = OmegaConf.to_container(load_local_model_config("audioseal_wm_16bits"))
        cfg.pop("checkpoint", None)
        ckpt = torch.load(src, map_location="cpu", weights_only=False)  # SHA-256 fijado en el build
        conf = AudioSeal.parse_config({**ckpt.get("xp.cfg", {}), **cfg}, config_type=AudioSealWMConfig)
        model = create_generator(conf)
        load_state_dict(model, state_dict=convert_state_dict_for_scriptable_model(ckpt["model"]))
        self._model = model.eval()
        self._torch = torch
        self._lock = threading.Lock()

    @classmethod
    def plan_samples(cls) -> tuple[int, int, int]:
        """(tramo, solape, resto mínimo) en muestras, todos múltiplos de los cuadros de 320."""
        out = tuple(round(v * AUDIO_SR) for v in (cls.chunk_s, cls.overlap_s, cls.min_tail_s))
        if any(v % AUDIOSEAL_HOP for v in out):
            raise ValueError("audioseal_plan_misaligned")
        return out  # type: ignore[return-value]

    def embed(self, samples: np.ndarray, message: int) -> np.ndarray:
        """`samples`: mono 16 kHz float32 en [-1, 1]. Devuelve el audio con la marca, recortado a [-1, 1]."""
        torch = self._torch
        msg = torch.from_numpy(int_to_bits(message, self.dim).astype(np.int64))[None]
        x = np.ascontiguousarray(samples, dtype=np.float32)
        out = x.copy()
        plan = embed_plan(x.size, *self.plan_samples())
        with self._lock, torch.inference_mode():
            for a, b, w in plan:
                wav = torch.from_numpy(x[a:b])[None, None]
                wm = self._model.get_watermark(wav, AUDIO_SR, message=msg)[0, 0].numpy()
                out[a:b] += w * wm
        return np.clip(out, -1.0, 1.0)


# --- Video Seal ---------------------------------------------------------------------------------


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
        """Logits de los 256 bits por imagen: (n, 256). Logit > 0 = bit 1."""
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

    def decode(self, images: list[Any]) -> dict[str, Any]:
        """Lo de `detect` más la probabilidad de cada bit y el mensaje en hex (siempre: con o sin marca;
        sin marca son bits al azar y la atribución por distancia de Hamming no encuentra a nadie)."""
        logits = self.logits(images)
        mean = logits.mean(axis=0) if len(logits) else np.zeros(self.dim, np.float32)
        score = bit_confidence(mean) if len(logits) else 0.0
        bits = _sigmoid(mean)
        return {
            "score": round(score, 4),
            "detected": bool(len(logits) and score >= self.threshold),
            "frames": len(logits),
            "bits": [round(float(b), 4) for b in bits],
            "message_hex": bits_to_hex(mean > 0),
        }


class VideoSealEmbedder:
    """Embebedor de Video Seal 1.0 para imágenes, sin el extractor.

    `videoseal/embedder.jit` lo arma `scripts/download_models.py` a partir del modelo completo
    (`y_256b_img.jit`): el UNet del embebedor, y dentro (archivos extra) la atenuación perceptual
    (JND) y los parámetros. Se reproduce `embed_img` del modelo completo: imagen a 256 x 256
    (bilineal con antialias), canal Y al UNet con el mensaje, marca por el mapa JND, escalada al tamaño
    original y sumada a los tres canales con `scaling_w`. Lo de tamaño completo se hace por franjas de
    filas, así que la memoria no crece con la foto (el modelo completo copia la imagen en float32
    varias veces: ~700 MB para 12 MP).
    """

    name = VIDEOSEAL_NAME
    band = 256  # filas por franja

    def __init__(self) -> None:
        import io

        torch = _torch()
        src = get_settings().videoseal_dir / "embedder.jit"
        if not src.exists():
            raise ModelUnavailable("videoseal_embedder_missing")
        extra = {"blindaje.json": "", "jnd.jit": ""}
        self._model = torch.jit.load(str(src), map_location="cpu", _extra_files=extra).eval()
        if not extra["blindaje.json"] or not extra["jnd.jit"]:
            raise ModelUnavailable("videoseal_embedder_incomplete")
        jnd = extra["jnd.jit"]
        self._jnd = torch.jit.load(io.BytesIO(jnd if isinstance(jnd, bytes) else jnd.encode("latin-1")),
                                   map_location="cpu").eval()
        cfg = json.loads(extra["blindaje.json"])
        self.nbits = int(cfg["nbits"])
        self.dim = self.nbits
        self.size = int(cfg["img_size"])
        self.scaling_i = float(cfg["scaling_i"])
        self.scaling_w = float(cfg["scaling_w"])
        self.clamp = bool(cfg["clamp"])
        # Fila Y de la matriz RGB -> YUV del modelo.
        self._y = torch.tensor(cfg["rgb2yuv"][0], dtype=torch.float32).view(1, 3, 1, 1)
        self._torch = torch
        self._lock = threading.Lock()

    def lowres_mark(self, low: np.ndarray, bits: np.ndarray) -> np.ndarray:
        """(3, size, size) en [0, 1] y bits -> marca (size, size) ya atenuada, antes de `scaling_w`."""
        torch = self._torch
        x = torch.from_numpy(np.ascontiguousarray(low, dtype=np.float32))[None]
        msgs = torch.from_numpy(np.asarray(bits, dtype=np.float32).reshape(1, -1))
        with self._lock, torch.inference_mode():
            y = (x * self._y).sum(dim=1, keepdim=True)
            delta = self._jnd.heatmaps(x, 0.3) * self._model(y, msgs)
        return delta[0, 0].cpu().numpy().astype(np.float32)

    def _downsample(self, rgb: np.ndarray) -> np.ndarray:
        """(H, W, 3) uint8 -> (3, size, size) float32 en [0, 1], por franjas."""
        h, w = rgb.shape[:2]
        wy, wx = aa_weights(h, self.size), aa_weights(w, self.size)
        low = np.zeros((3, self.size, self.size), dtype=np.float32)
        for y0 in range(0, h, self.band):
            y1 = min(h, y0 + self.band)
            block = rgb[y0:y1].astype(np.float32).transpose(2, 0, 1) / 255.0  # (3, b, W)
            low += wy[:, y0:y1] @ (block @ wx.T)
        return low

    def embed(self, img: Any, bits: np.ndarray) -> Any:
        """Imagen PIL y `nbits` bits (0/1) -> imagen PIL RGB del mismo tamaño con la marca."""
        from PIL import Image

        bits = np.asarray(bits, dtype=np.float32).reshape(-1)
        if bits.size != self.nbits:
            raise ValueError("invalid_message")
        rgb = np.asarray(img.convert("RGB"), dtype=np.uint8)
        h, w = rgb.shape[:2]
        d = self.lowres_mark(self._downsample(rgb), bits)  # (size, size)
        cols = d @ aa_weights(self.size, w).T  # (size, W)
        wy = aa_weights(self.size, h)  # (H, size)
        out = np.empty_like(rgb)
        for y0 in range(0, h, self.band):
            y1 = min(h, y0 + self.band)
            mark = (wy[y0:y1] @ cols) * self.scaling_w  # (b, W)
            block = rgb[y0:y1].astype(np.float32) * (self.scaling_i / 255.0) + mark[..., None]
            if self.clamp:
                np.clip(block, 0.0, 1.0, out=block)
            out[y0:y1] = np.clip(np.rint(block * 255.0), 0, 255).astype(np.uint8)
        return Image.fromarray(out, "RGB")
