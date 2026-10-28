"""ffmpeg: normalización de audio y muestreo de video.

Las entradas se escriben a un archivo temporal (los contenedores MP4/M4A pueden tener el
átomo moov al final y no se pueden leer desde un pipe). Las salidas también van a archivo para
que los headers WAV y el faststart de MP4 queden correctos.
"""

from __future__ import annotations

import io
import json
import re
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .config import get_settings

SAMPLE_RATE = 16_000


class MediaError(Exception):
    """El archivo no se pudo decodificar o no tiene la pista esperada."""


@dataclass(frozen=True)
class VideoInfo:
    frames: int
    fps: float
    width: int
    height: int


def _run_ffmpeg(args: list[str], timeout: float, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    s = get_settings()
    cmd = [s.ffmpeg, "-nostdin", "-hide_banner", "-y", "-threads", str(s.threads), *args]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as e:
        raise MediaError("ffmpeg_timeout") from e
    except FileNotFoundError as e:
        raise MediaError("ffmpeg_not_found") from e
    if check and proc.returncode != 0:
        # El stderr de ffmpeg puede incluir metadatos del archivo: no se registra ni se devuelve.
        raise MediaError("ffmpeg_failed")
    return proc


def ffmpeg_version() -> str | None:
    try:
        out = subprocess.run(
            [get_settings().ffmpeg, "-version"], capture_output=True, timeout=10, check=False
        ).stdout.decode("utf-8", "replace")
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.match(r"ffmpeg version (\S+)", out)
    return m.group(1) if m else None


def normalize_audio(data: bytes, timeout: float = 180) -> tuple[bytes, int]:
    """Cualquier audio (Opus, OGG, M4A, MP3, WAV, AAC) o video con audio a WAV mono 16 kHz PCM16.

    Devuelve (wav_bytes, duration_ms).
    """
    if not data:
        raise MediaError("empty_body")
    with tempfile.TemporaryDirectory(prefix="bml-") as tmp:
        src = Path(tmp) / "in"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(data)
        _run_ffmpeg(
            ["-i", str(src), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
             "-c:a", "pcm_s16le", "-f", "wav", "-bitexact", str(dst)],
            timeout,
        )
        if not dst.exists():
            raise MediaError("no_audio")
        wav = dst.read_bytes()
    samples = wav_to_array(wav)
    if samples.size == 0:
        raise MediaError("no_audio")
    return wav, round(samples.size * 1000 / SAMPLE_RATE)


def wav_to_array(wav: bytes) -> np.ndarray:
    """WAV mono 16 kHz PCM16 a float32 en [-1, 1]. Si el formato no es ese, lo normaliza antes."""
    try:
        with wave.open(io.BytesIO(wav), "rb") as w:
            ok = w.getnchannels() == 1 and w.getframerate() == SAMPLE_RATE and w.getsampwidth() == 2
            frames = w.readframes(w.getnframes()) if ok else b""
    except (wave.Error, EOFError):
        ok = False
    if not ok:
        wav, _ = normalize_audio(wav)
        return wav_to_array(wav)
    return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0


def array_to_wav(samples: np.ndarray) -> bytes:
    """float32 en [-1, 1] a WAV mono 16 kHz PCM16 (la misma forma que devuelve normalize_audio)."""
    pcm = np.clip(np.rint(np.asarray(samples, dtype=np.float32) * 32767.0), -32768, 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


_SHOWINFO_RE = re.compile(rb"\bn:\s*(\d+)\b.*?\bs:(\d+)x(\d+)")


def _video_filters(fps: float, max_side: int) -> str:
    # Escala solo si el lado mayor supera max_side; dimensiones pares para H.264 yuv420p.
    m = int(max_side)
    scale = (
        f"scale='if(gt(iw,ih),trunc(min({m},iw)/2)*2,-2)'"
        f":'if(gt(iw,ih),-2,trunc(min({m},ih)/2)*2)'"
    )
    return f"fps={fps:g},{scale}"


def _parse_showinfo(stderr: bytes) -> tuple[int, int, int]:
    frames, width, height = 0, 0, 0
    for line in stderr.splitlines():
        if b"showinfo" not in line:
            continue
        m = _SHOWINFO_RE.search(line)
        if m:
            frames = int(m.group(1)) + 1
            width, height = int(m.group(2)), int(m.group(3))
    return frames, width, height


def sample_video(
    data: bytes, fps: float = 5, max_frames: int = 300, max_side: int = 1920, timeout: float = 600
) -> tuple[bytes, VideoInfo]:
    """Muestrea el video a `fps` cuadros por segundo, hasta `max_frames`, en H.264 + faststart."""
    if not data:
        raise MediaError("empty_body")
    with tempfile.TemporaryDirectory(prefix="bml-") as tmp:
        src = Path(tmp) / "in"
        dst = Path(tmp) / "out.mp4"
        src.write_bytes(data)
        vf = f"{_video_filters(fps, max_side)},trim=end_frame={int(max_frames)},showinfo"
        proc = _run_ffmpeg(
            ["-loglevel", "info", "-i", str(src), "-map", "0:v:0", "-an", "-sn", "-dn",
             "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
             "-pix_fmt", "yuv420p", "-r", f"{fps:g}", "-movflags", "+faststart",
             "-map_metadata", "-1", str(dst)],
            timeout,
        )
        frames, width, height = _parse_showinfo(proc.stderr)
        if not dst.exists() or frames == 0:
            raise MediaError("no_video")
        return dst.read_bytes(), VideoInfo(frames=frames, fps=float(fps), width=width, height=height)


def video_frame(
    data: bytes, index: int, fps: float = 5, max_side: int = 1920, timeout: float = 300
) -> bytes:
    """JPEG del cuadro `index` (desde 0) del video muestreado con los mismos parámetros que sample_video."""
    if not data:
        raise MediaError("empty_body")
    if index < 0:
        raise MediaError("frame_out_of_range")
    with tempfile.TemporaryDirectory(prefix="bml-") as tmp:
        src = Path(tmp) / "in"
        dst = Path(tmp) / "frame.jpg"
        src.write_bytes(data)
        vf = f"{_video_filters(fps, max_side)},trim=start_frame={index}:end_frame={index + 1}"
        proc = _run_ffmpeg(
            ["-loglevel", "warning", "-i", str(src), "-map", "0:v:0", "-an", "-vf", vf,
             "-frames:v", "1", "-q:v", "2", "-map_metadata", "-1", "-f", "image2", str(dst)],
            timeout,
            check=False,
        )
        if dst.exists() and dst.stat().st_size > 0:
            return dst.read_bytes()
        # Video válido pero sin ese cuadro: ffmpeg termina sin escribir nada.
        if proc.returncode == 0 or re.search(
            rb"Nothing was written|Output file is empty|received no packets", proc.stderr
        ):
            raise MediaError("frame_out_of_range")
        raise MediaError("ffmpeg_failed")


def probe(data: bytes, timeout: float = 30) -> dict | None:
    """Formato, pistas y etiquetas con ffprobe (JSON). None si ffprobe no está o no reconoce el archivo.

    La salida puede traer metadatos personales (ubicación, autor): quien la use decide qué expone.
    """
    if not data:
        return None
    s = get_settings()
    with tempfile.TemporaryDirectory(prefix="bml-") as tmp:
        src = Path(tmp) / "in"
        src.write_bytes(data)
        try:
            proc = subprocess.run(
                [s.ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(src)],
                capture_output=True, timeout=timeout, check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
    if proc.returncode != 0:
        return None
    try:
        out = json.loads(proc.stdout.decode("utf-8", "replace"))
    except ValueError:
        return None
    return out if isinstance(out, dict) else None


def ffprobe_version() -> str | None:
    try:
        out = subprocess.run(
            [get_settings().ffprobe, "-version"], capture_output=True, timeout=10, check=False
        ).stdout.decode("utf-8", "replace")
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.match(r"ffprobe version (\S+)", out)
    return m.group(1) if m else None


def sample_frames(
    data: bytes, n: int, duration_s: float | None = None, max_side: int = 1280,
    size: tuple[int, int] | None = None, timeout: float = 300,
) -> list:
    """Hasta `n` cuadros repartidos a lo largo del video, como imágenes PIL RGB.

    ffmpeg solo reduce los cuadros de lado mayor a `max_side` (filtro de área); si se pide `size`, cada
    cuadro se redimensiona con PIL (bilineal con antialias, como Video Seal) apenas se lee, para no
    tener en memoria cuadros de 4K.
    """
    from PIL import Image

    if not data:
        raise MediaError("empty_body")
    n = max(1, int(n))
    m = int(max_side)
    scale = f"scale='if(gt(iw,ih),min({m},iw),-2)':'if(gt(iw,ih),-2,min({m},ih))':flags=area"
    # Cuadros equiespaciados si se conoce la duración; si no, uno por segundo desde el inicio.
    rate = f"fps={n / duration_s:.6f}" if duration_s and duration_s > 0 else "fps=1"
    with tempfile.TemporaryDirectory(prefix="bml-") as tmp:
        src = Path(tmp) / "in"
        src.write_bytes(data)
        _run_ffmpeg(
            ["-loglevel", "error", "-i", str(src), "-map", "0:v:0", "-an", "-sn", "-dn",
             "-vf", f"{rate},{scale}", "-frames:v", str(n), "-map_metadata", "-1",
             str(Path(tmp) / "f%04d.png")],
            timeout,
        )
        frames = []
        for p in sorted(Path(tmp).glob("f*.png")):
            with Image.open(p) as im:
                rgb = im.convert("RGB")
                frames.append(rgb.resize(size, Image.Resampling.BILINEAR) if size else rgb)
    if not frames:
        raise MediaError("no_video")
    return frames
