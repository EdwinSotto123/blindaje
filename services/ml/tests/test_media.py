from __future__ import annotations

import io
import subprocess
import wave

import pytest

from blindaje_ml import media

from .conftest import ffmpeg_encode, needs_ffmpeg, silence, to_wav, tone

pytestmark = needs_ffmpeg


def _wav_params(data: bytes) -> tuple[int, int, int, int]:
    with wave.open(io.BytesIO(data), "rb") as w:
        return w.getnchannels(), w.getframerate(), w.getsampwidth(), w.getnframes()


@pytest.mark.parametrize(
    ("args", "suffix"),
    [
        (["-c:a", "libopus", "-b:a", "16k", "-ar", "48000"], ".ogg"),
        (["-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "64k"], ".m4a"),
        (["-ac", "2", "-ar", "44100"], ".wav"),
    ],
)
def test_normalize_formats(client, tmp_path, args, suffix):
    src = to_wav(tone(440, 2.5), sr=16_000)
    encoded = ffmpeg_encode(src, args, suffix, tmp_path)
    r = client.post("/audio/normalize", content=encoded)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/wav"
    ch, sr, width, frames = _wav_params(r.content)
    assert (ch, sr, width) == (1, 16_000, 2)
    assert abs(int(r.headers["x-duration-ms"]) - 2500) < 120
    assert abs(frames - 40_000) < 2_000


def test_normalize_garbage_is_422(client):
    r = client.post("/audio/normalize", content=b"esto no es audio" * 100)
    assert r.status_code == 422
    assert r.json()["error"] in {"ffmpeg_failed", "no_audio"}


def test_normalize_empty_is_422(client):
    r = client.post("/audio/normalize", content=b"")
    assert r.status_code == 422


def test_wav_to_array_resamples_other_formats():
    # 8000 muestras etiquetadas a 8 kHz = 1 s -> 16000 muestras a 16 kHz.
    x = media.wav_to_array(to_wav(tone(300, 0.5), sr=8_000))
    assert abs(x.size - 16_000) < 50


@pytest.fixture(scope="module")
def sample_video(tmp_path_factory) -> bytes:
    out = tmp_path_factory.mktemp("v") / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
         "testsrc=size=321x241:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=500:duration=3",
         # yuv444p admite dimensiones impares: el servicio debe devolver dimensiones pares.
         "-c:v", "libx264", "-pix_fmt", "yuv444p", "-c:a", "aac", "-shortest", str(out)],
        check=True,
    )
    return out.read_bytes()


def test_video_sample(client, sample_video):
    r = client.post("/video/sample?fps=5&max_frames=300", content=sample_video)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "video/mp4"
    assert r.headers["x-frames"] == "15"
    assert r.headers["x-fps"] == "5"
    # Dimensiones pares para H.264 yuv420p.
    assert int(r.headers["x-width"]) % 2 == 0 and int(r.headers["x-height"]) % 2 == 0
    assert abs(int(r.headers["x-width"]) - 321) <= 1
    # faststart: el átomo moov va antes que mdat.
    assert 0 <= r.content.find(b"moov") < r.content.find(b"mdat")


def test_video_sample_max_frames_and_downscale(client, sample_video):
    r = client.post("/video/sample?fps=10&max_frames=7&max_side=160", content=sample_video)
    assert r.status_code == 200, r.text
    assert r.headers["x-frames"] == "7"
    assert int(r.headers["x-width"]) == 160


def test_video_frame(client, sample_video):
    r = client.post("/video/frame?index=3&fps=5", content=sample_video)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/jpeg"
    assert r.content[:3] == b"\xff\xd8\xff"


def test_video_frame_out_of_range(client, sample_video):
    r = client.post("/video/frame?index=99&fps=5", content=sample_video)
    assert r.status_code == 422
    assert r.json()["error"] == "frame_out_of_range"


def test_audio_without_video_is_422(client, tmp_path):
    audio = ffmpeg_encode(to_wav(silence(1.0)), ["-c:a", "aac"], ".m4a", tmp_path)
    r = client.post("/video/sample", content=audio)
    assert r.status_code == 422
