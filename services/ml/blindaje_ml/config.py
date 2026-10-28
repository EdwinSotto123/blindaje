"""Configuración por variables de entorno. Nada de secretos en el código."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from pathlib import Path

_DEFAULT_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def _cpu_quota() -> int:
    """vCPU disponibles según cgroup v2 (contenedores con fracciones de CPU) o el sistema."""
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()[:2]
        if quota != "max":
            return max(1, math.ceil(int(quota) / int(period)))
    except (OSError, ValueError):
        pass
    return max(1, os.cpu_count() or 1)


@dataclass(frozen=True)
class Settings:
    models_dir: Path = field(default_factory=lambda: Path(os.environ.get("ML_MODELS_DIR", _DEFAULT_MODELS_DIR)))
    token: str | None = field(default_factory=lambda: os.environ.get("ML_TOKEN") or None)
    max_body_bytes: int = field(
        default_factory=lambda: int(float(os.environ.get("ML_MAX_BODY_MB", "128")) * 1024 * 1024)
    )
    threads: int = field(default_factory=lambda: int(os.environ.get("ML_THREADS", "0")) or _cpu_quota())
    preload: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            p.strip() for p in os.environ.get("ML_PRELOAD", "").split(",") if p.strip()
        )
    )
    ffmpeg: str = field(default_factory=lambda: os.environ.get("ML_FFMPEG", "ffmpeg"))
    ffprobe: str = field(default_factory=lambda: os.environ.get("ML_FFPROBE", "ffprobe"))
    # Autenticidad: segundos de audio que revisa AudioSeal y cuadros de video que revisa Video Seal.
    wm_audio_max_s: float = field(default_factory=lambda: float(os.environ.get("ML_WM_AUDIO_MAX_S", "120")))
    wm_video_frames: int = field(default_factory=lambda: int(os.environ.get("ML_WM_VIDEO_FRAMES", "16")))
    snorm_top_k: int = field(default_factory=lambda: int(os.environ.get("ML_SNORM_TOP_K", "200")))
    # Trazabilidad de filtraciones: duración máxima del audio al que se le inserta la marca.
    wm_embed_max_s: float = field(default_factory=lambda: float(os.environ.get("ML_WM_EMBED_MAX_S", "600")))
    # Llama Prompt Guard 2: modelo (carpeta en ML_MODELS_DIR) y umbral de la etiqueta "inyeccion".
    prompt_guard_model: str = field(
        default_factory=lambda: os.environ.get("ML_PROMPT_GUARD_MODEL", "meta-llama/Llama-Prompt-Guard-2-86M")
    )
    prompt_guard_threshold: float = field(
        default_factory=lambda: float(os.environ.get("ML_PROMPT_GUARD_THRESHOLD", "0.5"))
    )

    @property
    def voice_dir(self) -> Path:
        return self.models_dir / "spkrec-ecapa-voxceleb"

    @property
    def text_dir(self) -> Path:
        return self.models_dir / "multilingual-e5-small"

    @property
    def image_dir(self) -> Path:
        return self.models_dir / "dinov2-small"

    @property
    def audioseal_dir(self) -> Path:
        return self.models_dir / "audioseal"

    @property
    def videoseal_dir(self) -> Path:
        return self.models_dir / "videoseal"

    @property
    def prompt_guard_dir(self) -> Path:
        """`meta-llama/Llama-Prompt-Guard-2-86M` -> `$ML_MODELS_DIR/llama-prompt-guard-2-86m`."""
        return self.models_dir / self.prompt_guard_model.rsplit("/", 1)[-1].lower()

    @property
    def fonts_dir(self) -> Path:
        return Path(os.environ.get("ML_FONTS_DIR", self.models_dir / "fonts"))

    @property
    def cohort_path(self) -> Path:
        return Path(os.environ.get("ML_COHORT_PATH", self.models_dir / "cohort.npy"))


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Para tests: vuelve a leer el entorno."""
    global _settings
    _settings = None
