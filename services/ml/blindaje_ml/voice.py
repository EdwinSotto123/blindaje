"""Huella de voz: segmentación, centroides por hablante, exclusión de la víctima y s-norm.

La lógica no depende del modelo: recibe un `SpeakerEmbedder` (ECAPA-TDNN en producción, uno
falso en los tests livianos).
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np

from .media import SAMPLE_RATE

MIN_SEGMENT_MS = 3_000
MAX_SEGMENT_MS = 6_000
WINDOW_MS = 3_000
# Turnos consecutivos del mismo hablante separados por menos de esto se unen antes de cortar.
MERGE_GAP_MS = 1_000
# Una ventana cuenta como voz si al menos esta fracción de sus cuadros de 30 ms tiene energía.
MIN_VOICED_RATIO = 0.3
DEFAULT_EXCLUDE_THRESHOLD = 0.6


class SpeakerEmbedder(Protocol):
    name: str
    dim: int

    def embed(self, waves: list[np.ndarray]) -> np.ndarray:
        """Una fila normalizada L2 por onda (float32, 16 kHz mono)."""
        ...


@dataclass(frozen=True)
class Turn:
    speaker: str
    start_ms: int
    end_ms: int


@dataclass
class Segment:
    start_ms: int
    end_ms: int
    vector: np.ndarray | None = None
    victim_similarity: float | None = None
    excluded: bool = False


@dataclass
class SpeakerResult:
    speaker: str
    segments: list[Segment] = field(default_factory=list)
    centroid: np.ndarray | None = None
    duration_sec: float = 0.0
    victim_similarity: float | None = None
    excluded: bool = False


def l2_normalize(x: np.ndarray, axis: int = -1) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    norm = np.linalg.norm(x, axis=axis, keepdims=True)
    return (x / np.maximum(norm, 1e-12)).astype(np.float32)


def split_span(start_ms: int, end_ms: int) -> list[tuple[int, int]]:
    """Corta un tramo en ventanas de 3 a 6 s del mismo largo. Menos de 3 s: nada."""
    dur = end_ms - start_ms
    if dur < MIN_SEGMENT_MS:
        return []
    n = max(1, math.ceil(dur / MAX_SEGMENT_MS))
    step = dur / n
    return [(start_ms + round(i * step), start_ms + round((i + 1) * step)) for i in range(n)]


def windows_over(duration_ms: int) -> list[tuple[int, int]]:
    """Ventanas de 3 s sobre todo el audio; el sobrante (< 3 s) se suma a la última ventana."""
    n = duration_ms // WINDOW_MS
    if n == 0:
        return []
    out = [(i * WINDOW_MS, (i + 1) * WINDOW_MS) for i in range(n)]
    out[-1] = (out[-1][0], duration_ms)
    return out


def merge_turns(turns: list[Turn], duration_ms: int) -> dict[str, list[tuple[int, int]]]:
    """Agrupa por hablante, recorta al largo del audio y une turnos consecutivos cercanos."""
    ordered = sorted(
        (Turn(t.speaker, max(0, t.start_ms), min(duration_ms, t.end_ms)) for t in turns),
        key=lambda t: (t.start_ms, t.end_ms),
    )
    spans: dict[str, list[tuple[int, int]]] = {}
    prev: Turn | None = None
    for t in ordered:
        if t.end_ms <= t.start_ms:
            continue
        lst = spans.setdefault(t.speaker, [])
        if prev is not None and prev.speaker == t.speaker and lst and t.start_ms - lst[-1][1] <= MERGE_GAP_MS:
            lst[-1] = (lst[-1][0], max(lst[-1][1], t.end_ms))
        else:
            lst.append((t.start_ms, t.end_ms))
        prev = t
    return spans


def voiced_ratio(wave: np.ndarray, frame_ms: int = 30) -> float:
    """Fracción de cuadros con energía por encima de un piso adaptativo (VAD de energía simple)."""
    frame = SAMPLE_RATE * frame_ms // 1000
    n = wave.size // frame
    if n == 0:
        return 0.0
    frames = wave[: n * frame].reshape(n, frame)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-10))
    floor = max(-50.0, float(np.max(db)) - 35.0)
    return float(np.mean(db > floor))


def _slice(wave: np.ndarray, start_ms: int, end_ms: int) -> np.ndarray:
    return wave[start_ms * SAMPLE_RATE // 1000 : end_ms * SAMPLE_RATE // 1000]


def _max_similarity(vec: np.ndarray, refs: np.ndarray | None) -> float | None:
    if refs is None or refs.size == 0:
        return None
    return float(np.max(refs @ vec))


def plan_segments(wave: np.ndarray, turns: list[Turn] | None) -> dict[str, list[Segment]]:
    """Segmentos de 3 a 6 s por hablante, sin ventanas de silencio."""
    duration_ms = wave.size * 1000 // SAMPLE_RATE
    if turns:
        spans = merge_turns(turns, duration_ms)
        plan = {spk: [w for s, e in lst for w in split_span(s, e)] for spk, lst in spans.items()}
    else:
        plan = {"A": windows_over(duration_ms)}
    out: dict[str, list[Segment]] = {}
    for spk, wins in plan.items():
        segs = [
            Segment(s, e) for s, e in wins if voiced_ratio(_slice(wave, s, e)) >= MIN_VOICED_RATIO
        ]
        out[spk] = segs
    return out


def embed_speakers(
    wave: np.ndarray,
    turns: list[Turn] | None,
    embedder: SpeakerEmbedder,
    exclude_vectors: list[list[float]] | None = None,
    exclude_threshold: float = DEFAULT_EXCLUDE_THRESHOLD,
) -> tuple[list[SpeakerResult], list[dict]]:
    """Calcula segmentos, centroides y exclusión de la víctima.

    Reglas:
    - Un hablante se excluye si el centroide de todos sus segmentos supera `exclude_threshold`
      frente a alguna muestra de la víctima.
    - En un hablante no excluido, los segmentos que por sí solos superan el umbral se marcan
      `excluded` y no entran al centroide (por ejemplo, cuando no hay diarización y la víctima
      habla en el mismo audio).

    Devuelve (hablantes con al menos un segmento, hablantes omitidos por falta de audio útil).
    """
    refs = None
    if exclude_vectors:
        refs = l2_normalize(np.asarray(exclude_vectors, dtype=np.float32).reshape(len(exclude_vectors), -1))
        if refs.shape[1] != embedder.dim:
            raise ValueError("exclude_vectors_dim")
    plan = plan_segments(wave, turns)
    results: list[SpeakerResult] = []
    skipped: list[dict] = []
    all_segs = [(spk, seg) for spk, segs in plan.items() for seg in segs]
    if all_segs:
        vectors = embedder.embed([_slice(wave, seg.start_ms, seg.end_ms) for _, seg in all_segs])
        for (_, seg), vec in zip(all_segs, vectors, strict=True):
            seg.vector = l2_normalize(vec)
            seg.victim_similarity = _max_similarity(seg.vector, refs)
    for spk in sorted(plan):
        segs = plan[spk]
        if not segs:
            skipped.append({"speaker": spk, "reason": "sin_segmentos_de_3s"})
            continue
        res = SpeakerResult(speaker=spk, segments=segs)
        res.duration_sec = round(sum(s.end_ms - s.start_ms for s in segs) / 1000, 3)
        stacked = np.stack([s.vector for s in segs])
        full_centroid = l2_normalize(stacked.mean(axis=0))
        res.victim_similarity = _max_similarity(full_centroid, refs)
        if res.victim_similarity is not None and res.victim_similarity > exclude_threshold:
            res.excluded = True
            for s in segs:
                s.excluded = True
            res.centroid = full_centroid
        else:
            for s in segs:
                s.excluded = s.victim_similarity is not None and s.victim_similarity > exclude_threshold
            kept = [s.vector for s in segs if not s.excluded]
            if kept:
                res.centroid = l2_normalize(np.stack(kept).mean(axis=0))
                res.victim_similarity = _max_similarity(res.centroid, refs)
            else:
                res.centroid = full_centroid
                res.excluded = True
        results.append(res)
    return results, skipped


def enroll(wave: np.ndarray, embedder: SpeakerEmbedder) -> tuple[np.ndarray, int]:
    """Muestra de la víctima: ventanas de 3 s con voz, promedio normalizado. Devuelve (vector, n)."""
    segs = plan_segments(wave, None)["A"]
    if not segs:
        raise ValueError("audio_too_short")
    vecs = embedder.embed([_slice(wave, s.start_ms, s.end_ms) for s in segs])
    return l2_normalize(l2_normalize(vecs).mean(axis=0)), len(segs)


class Cohort:
    """Cohorte de referencia para s-norm (`cohort.npy`, N x dim, normalizada al cargar).

    Se recarga sola si cambia el archivo, para que la evaluación pueda generarla después.
    `set()` la reemplaza en caliente (y la guarda en disco si se puede).
    """

    def __init__(self, path: Path, top_k: int = 200):
        self.path = path
        self.top_k = top_k
        self._lock = threading.Lock()
        self._matrix: np.ndarray | None = None
        self._mtime: float | None = None
        self._in_memory = False

    def matrix(self) -> np.ndarray | None:
        with self._lock:
            if self._in_memory:
                return self._matrix
            try:
                mtime = self.path.stat().st_mtime
            except OSError:
                self._matrix, self._mtime = None, None
                return None
            if self._matrix is None or mtime != self._mtime:
                arr = np.load(self.path, allow_pickle=False)
                if arr.ndim != 2 or arr.shape[0] < 2:
                    raise ValueError("cohort_shape")
                self._matrix = l2_normalize(arr.astype(np.float32))
                self._mtime = mtime
            return self._matrix

    def set(self, arr: np.ndarray, persist: bool = True) -> int:
        arr = np.asarray(arr, dtype=np.float32)
        if arr.ndim != 2 or arr.shape[0] < 2:
            raise ValueError("cohort_shape")
        arr = l2_normalize(arr)
        with self._lock:
            self._matrix, self._mtime, self._in_memory = arr, None, True
            if persist:
                try:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    with open(self.path, "wb") as f:
                        np.save(f, arr, allow_pickle=False)
                    self._mtime, self._in_memory = self.path.stat().st_mtime, False
                except OSError:
                    pass  # disco de solo lectura: queda en memoria
        return int(arr.shape[0])

    def size(self) -> int:
        try:
            m = self.matrix()
        except (ValueError, OSError):
            return 0
        return 0 if m is None else int(m.shape[0])


def snorm(a: np.ndarray, b: np.ndarray, cohort: np.ndarray | None, top_k: int = 200) -> float | None:
    """S-norm adaptativa (AS-norm): z-score del puntaje contra los top-k de la cohorte de cada lado."""
    if cohort is None or cohort.shape[1] != a.shape[0]:
        return None
    score = float(a @ b)
    k = max(2, min(top_k, cohort.shape[0]))

    def stats(v: np.ndarray) -> tuple[float, float]:
        s = cohort @ v
        top = np.partition(s, -k)[-k:]
        return float(top.mean()), float(max(top.std(), 1e-6))

    ma, sa = stats(a)
    mb, sb = stats(b)
    return 0.5 * ((score - ma) / sa + (score - mb) / sb)
