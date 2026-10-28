"""Backends de huella de voz.

- `ml`: el contenedor de ML (docs/ML_API.md), POST /voice/embed con turns=null. Es el backend
  oficial de la evaluación: mide exactamente lo que usa el pipeline.
- `local`: el mismo modelo (SpeechBrain ECAPA-TDNN, speechbrain/spkrec-ecapa-voxceleb, Apache-2.0)
  y la misma regla del contrato (ventanas de 3 s sobre todo el audio, un solo hablante, centroide =
  promedio normalizado de los segmentos). Sirve para medir mientras el contenedor no está arriba y
  para verificar los audios del demo. El reporte siempre dice qué backend se usó.

Los resultados se cachean por SHA-256 del WAV y backend en eval/data/cache/voice/.
"""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf

from .paths import CACHE_DIR, ML_TOKEN, ML_URL, MODELS_DIR

VENTANA_S = 3.0
SR = 16000


@dataclass
class Huella:
    centroid: np.ndarray  # (dim,) normalizado L2
    segmentos: np.ndarray  # (n, dim) normalizados
    duracion_s: float
    modelo: str


def _norm(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Backend:
    nombre = "base"

    def __init__(self) -> None:
        self.cache_dir = CACHE_DIR / "voice" / f"{self.nombre}-{getattr(self, 'cache_version', 'v1')}"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _embed(self, wav: Path) -> Huella:  # pragma: no cover - interfaz
        raise NotImplementedError

    def embed(self, wav: Path) -> Huella:
        key = self.cache_dir / f"{_sha(wav)}.json"
        if key.exists():
            d = json.loads(key.read_text())
            return Huella(
                centroid=np.asarray(d["centroid"], dtype=np.float32),
                segmentos=np.asarray(d["segmentos"], dtype=np.float32),
                duracion_s=d["duracion_s"],
                modelo=d["modelo"],
            )
        h = self._embed(wav)
        key.write_text(
            json.dumps(
                {
                    "centroid": h.centroid.tolist(),
                    "segmentos": h.segmentos.tolist(),
                    "duracion_s": h.duracion_s,
                    "modelo": h.modelo,
                }
            )
        )
        return h


class MlBackend(Backend):
    nombre = "ml"

    def __init__(self, url: str = ML_URL) -> None:
        super().__init__()
        self.url = url
        headers = {"x-ml-token": ML_TOKEN} if ML_TOKEN else {}
        self.client = httpx.Client(base_url=url, headers=headers, timeout=120)

    def disponible(self) -> bool:
        try:
            r = self.client.get("/health", timeout=5)
            return r.status_code == 200 and bool(r.json().get("ok"))
        except Exception:  # noqa: BLE001
            return False

    def health(self) -> dict:
        return self.client.get("/health", timeout=10).json()

    def _embed(self, wav: Path) -> Huella:
        body = {
            "wav_b64": base64.b64encode(wav.read_bytes()).decode(),
            "turns": None,
            "exclude_vectors": [],
        }
        import time

        for intento in range(4):
            try:
                r = self.client.post("/voice/embed", json=body)
                if r.status_code >= 500 and intento < 3:
                    raise httpx.HTTPStatusError("5xx", request=r.request, response=r)
                break
            except (httpx.TransportError, httpx.HTTPStatusError):
                if intento == 3:
                    raise
                time.sleep(2 * (intento + 1))
        r.raise_for_status()
        d = r.json()
        sp = d["speakers"][0]
        segs = np.asarray([s["vector"] for s in sp["segments"]], dtype=np.float32)
        return Huella(
            centroid=_norm(np.asarray(sp["centroid"], dtype=np.float32)),
            segmentos=_norm(segs) if len(segs) else segs,
            duracion_s=float(sp.get("duration_sec", 0.0)),
            modelo=str(d.get("model", "ml")),
        )


class LocalBackend(Backend):
    nombre = "local"
    cache_version = "v2"  # v2: misma segmentación y VAD que services/ml
    modelo_id = "speechbrain/spkrec-ecapa-voxceleb"

    def __init__(self) -> None:
        super().__init__()
        self._model = None

    def _load(self):
        if self._model is None:
            from speechbrain.inference.speaker import EncoderClassifier
            from speechbrain.utils.fetching import LocalStrategy

            self._model = EncoderClassifier.from_hparams(
                source=self.modelo_id,
                savedir=str(MODELS_DIR / "spkrec-ecapa-voxceleb"),
                run_opts={"device": "cpu"},
                local_strategy=LocalStrategy.COPY,
            )
        return self._model

    def _embed(self, wav: Path) -> Huella:
        import torch

        audio, sr = sf.read(str(wav), dtype="float32", always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != SR:
            raise ValueError(f"{wav} debe ser WAV de 16 kHz (es {sr})")
        # Igual que services/ml (voice.windows_over + voiced_ratio): ventanas de 3 s, el sobrante
        # se suma a la última, y se descartan las ventanas con menos de 30 % de cuadros con voz.
        dur_ms = len(audio) * 1000 // SR
        n = dur_ms // 3000
        wins = [(i * 3000, (i + 1) * 3000) for i in range(n)]
        if wins:
            wins[-1] = (wins[-1][0], dur_ms)
        chunks = [audio[s * SR // 1000 : e * SR // 1000] for s, e in wins]
        chunks = [c for c in chunks if voiced_ratio(c) >= 0.3]
        if not chunks:
            raise ValueError(f"{wav}: sin segmentos de 3 s con voz")
        model = self._load()
        with torch.inference_mode():
            m = max(c.size for c in chunks)
            x = torch.zeros(len(chunks), m)
            for j, c in enumerate(chunks):
                x[j, : c.size] = torch.from_numpy(np.ascontiguousarray(c))
            lens = torch.tensor([c.size / m for c in chunks])
            emb = model.encode_batch(x, lens).squeeze(1).cpu().numpy().astype(np.float32)
        segs = _norm(emb)
        centroid = _norm(segs.mean(axis=0))
        return Huella(centroid=centroid, segmentos=segs, duracion_s=sum(c.size for c in chunks) / SR, modelo=self.modelo_id)


def voiced_ratio(wave: np.ndarray, frame_ms: int = 30) -> float:
    """VAD de energía igual al del contenedor: cuadros sobre max(-50 dB, pico - 35 dB)."""
    frame = SR * frame_ms // 1000
    n = wave.size // frame
    if n == 0:
        return 0.0
    frames = wave[: n * frame].reshape(n, frame)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-10))
    floor = max(-50.0, float(np.max(db)) - 35.0)
    return float(np.mean(db > floor))


def get_backend(nombre: str) -> Backend:
    if nombre == "ml":
        return MlBackend()
    if nombre == "local":
        return LocalBackend()
    raise ValueError(nombre)


def elegir_backend(preferido: str = "auto") -> Backend:
    """auto: el contenedor si responde; si no, el backend local con el mismo modelo."""
    if preferido in ("ml", "auto"):
        ml = MlBackend()
        if ml.disponible():
            return ml
        if preferido == "ml":
            raise RuntimeError(f"El contenedor ML no responde en {ML_URL}")
    return LocalBackend()
