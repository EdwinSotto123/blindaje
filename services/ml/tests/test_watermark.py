"""Trazabilidad de filtraciones sin modelos: mensajes, tramos, remuestreo y forma de las rutas."""

from __future__ import annotations

import io
import wave

import numpy as np
import pytest
from PIL import Image

from blindaje_ml.watermark import (
    AUDIO_SR,
    aa_weights,
    audio_bits,
    bits_to_hex,
    bits_to_int,
    embed_plan,
    hex_to_bits,
    int_to_bits,
)

from .conftest import needs_ffmpeg, to_wav, tone

# --- mensajes -----------------------------------------------------------------------------------


def test_int_bits_msb_first_roundtrip():
    assert int_to_bits(1, 16).tolist() == [0] * 15 + [1]
    assert int_to_bits(0x8000, 16).tolist() == [1] + [0] * 15
    for v in (0, 1, 513, 0xA5C3, 65535):
        assert bits_to_int(int_to_bits(v, 16)) == v
    for bad in (-1, 65536):
        with pytest.raises(ValueError, match="invalid_message"):
            int_to_bits(bad, 16)


def test_hex_bits_roundtrip_and_validation():
    rng = np.random.default_rng(0)
    bits = rng.integers(0, 2, 256)
    h = bits_to_hex(bits)
    assert len(h) == 64 and h == h.lower()
    assert hex_to_bits(h, 256).tolist() == bits.tolist()
    assert hex_to_bits(h.upper(), 256).tolist() == bits.tolist()
    assert hex_to_bits("8" + "0" * 63, 256)[:4].tolist() == [1, 0, 0, 0]  # primer carácter = bits 0..3
    assert bits_to_hex(np.zeros(256, int)) == "0" * 64
    for bad in ("0" * 63, "0" * 65, "g" * 64, "", "0x" + "0" * 62):
        with pytest.raises(ValueError, match="invalid_message"):
            hex_to_bits(bad, 256)


# --- tramos de audio ----------------------------------------------------------------------------


@pytest.mark.parametrize("seconds", [0.3, 5, 10, 10.5, 20.4, 25, 61.7])
def test_embed_plan_weights_cover_every_sample_once(seconds):
    n = int(seconds * AUDIO_SR)
    plan = embed_plan(n, 10 * AUDIO_SR, AUDIO_SR // 4, AUDIO_SR)
    acc = np.zeros(n)
    for a, b, w in plan:
        assert 0 <= a < b <= n and w.size == b - a
        acc[a:b] += w
    np.testing.assert_allclose(acc, 1.0, atol=1e-6)
    assert embed_plan(0, 10, 2, 1) == []


def test_embedder_chunks_start_on_audioseal_frames():
    """Cada tramo del generador empieza en el borde de un cuadro de 320 muestras (si no, la marca de los
    tramos siguientes queda desfasada y el detector lee mal el mensaje después de los 10 s)."""
    from blindaje_ml.watermark import AUDIOSEAL_HOP, AudioSealEmbedder

    chunk, overlap, tail = AudioSealEmbedder.plan_samples()
    for seconds in (9.9, 25, 61.7, 600):
        for a, _, _ in embed_plan(int(seconds * AUDIO_SR), chunk, overlap, tail):
            assert a % AUDIOSEAL_HOP == 0


def test_embed_plan_merges_short_tail():
    plan = embed_plan(int(20.4 * AUDIO_SR), 10 * AUDIO_SR, AUDIO_SR // 4, AUDIO_SR)
    assert len(plan) == 2  # 0.4 s del final van con el segundo tramo
    assert plan[-1][1] == int(20.4 * AUDIO_SR)
    assert len(embed_plan(int(21.5 * AUDIO_SR), 10 * AUDIO_SR, AUDIO_SR // 4, AUDIO_SR)) == 3


def test_audio_bits_reads_marked_samples_only():
    marked = np.full(16, 4.0) * np.where(np.arange(16) % 2, 1, -1)
    unmarked = -marked  # el tramo sin marca empujaría al revés
    n_marked, n_all = AUDIO_SR, 3 * AUDIO_SR
    bits = audio_bits(marked * n_marked, n_marked, marked * n_marked + unmarked * 2 * AUDIO_SR, n_all)
    assert ((bits > 0.5) == (np.arange(16) % 2 == 1)).all()
    # Con menos de 0.5 s marcado se usa todo lo revisado.
    few = audio_bits(marked * 10, 10, unmarked * n_all, n_all)
    assert ((few > 0.5) == (np.arange(16) % 2 == 0)).all()
    assert audio_bits(np.zeros(16), 0, np.zeros(16), 0).tolist() == [0.5] * 16


# --- remuestreo ---------------------------------------------------------------------------------


@pytest.mark.parametrize(("n_in", "n_out"), [(256, 256), (256, 1066), (1600, 256), (100, 256), (256, 37)])
def test_aa_weights_rows_sum_to_one(n_in, n_out):
    w = aa_weights(n_in, n_out)
    assert w.shape == (n_out, n_in)
    np.testing.assert_allclose(w.sum(axis=1), 1.0, atol=1e-5)
    assert (w >= 0).all()


def test_aa_weights_identity_and_constant():
    np.testing.assert_allclose(aa_weights(64, 64), np.eye(64), atol=1e-7)
    up = aa_weights(256, 1000) @ np.full(256, 0.3)
    np.testing.assert_allclose(up, 0.3, atol=1e-6)


# --- rutas de audio -----------------------------------------------------------------------------


def _wav_info(data: bytes) -> tuple[int, int, int, int]:
    with wave.open(io.BytesIO(data), "rb") as w:
        return w.getnchannels(), w.getframerate(), w.getsampwidth(), w.getnframes()


@needs_ffmpeg
def test_audio_embed_returns_wav_and_headers(client, fakes):
    r = client.post("/watermark/audio/embed?message=513", content=to_wav(tone(300, 2.0)))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/wav"
    assert r.headers["x-watermark-model"] == "audioseal-16bits"
    assert r.headers["x-watermark-message"] == "513"
    assert r.headers["x-duration-ms"] == "2000"
    assert _wav_info(r.content) == (1, 16_000, 2, 32_000)
    assert fakes["audioseal_embedder"].messages == [513]


@needs_ffmpeg
def test_audio_embed_resamples_stereo_44k_m4a(client, tmp_path):
    from .conftest import ffmpeg_encode

    src = ffmpeg_encode(to_wav(tone(440, 1.5)), ["-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "64k"],
                        ".m4a", tmp_path)
    r = client.post("/watermark/audio/embed?message=0", content=src)
    assert r.status_code == 200, r.text
    ch, sr, width, _ = _wav_info(r.content)
    assert (ch, sr, width) == (1, 16_000, 2)


@pytest.mark.parametrize("query", ["", "?message=-1", "?message=65536", "?message=abc"])
def test_audio_embed_bad_message(client, query):
    r = client.post(f"/watermark/audio/embed{query}", content=to_wav(tone(300, 0.5)))
    assert r.status_code == 422
    assert r.json()["error"] == "invalid_request"


def test_audio_embed_empty_body(client):
    r = client.post("/watermark/audio/embed?message=1", content=b"")
    assert r.status_code == 422
    assert r.json() == {"error": "empty_body"}


@needs_ffmpeg
def test_audio_embed_too_long(make_client, monkeypatch):
    monkeypatch.setenv("ML_WM_EMBED_MAX_S", "1")
    c = make_client()
    r = c.post("/watermark/audio/embed?message=1", content=to_wav(tone(300, 1.5)))
    assert r.status_code == 422
    assert r.json() == {"error": "audio_too_long"}


@needs_ffmpeg
def test_audio_detect_shape(client):
    r = client.post("/watermark/audio/detect", content=to_wav(tone(300, 1.0)))
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"detected", "score", "message", "bits", "bit_confidence", "model"}
    assert body["model"] == "audioseal-16bits"
    assert body["detected"] is False and body["message"] is None
    assert len(body["bits"]) == 16 and all(0 <= b <= 1 for b in body["bits"])
    assert isinstance(body["bit_confidence"], float)


@needs_ffmpeg
def test_audio_detect_rejects_non_audio(client):
    r = client.post("/watermark/audio/detect", content=b"esto no es audio" * 10)
    assert r.status_code == 422
    assert r.json()["error"] == "ffmpeg_failed"


def test_audio_embed_without_generator_is_503(make_client, fakes):
    fakes.pop("audioseal_embedder")
    r = make_client().post("/watermark/audio/embed?message=1", content=to_wav(tone(300, 0.5)))
    assert r.status_code == 503
    assert r.json()["error"] == "model_unavailable"


# --- rutas de imagen ----------------------------------------------------------------------------


def _img_bytes(fmt: str = "JPEG", size=(120, 80), mode: str = "RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, (180, 120, 60, 128)[: len(mode)]).save(buf, fmt)
    return buf.getvalue()


def test_image_embed_returns_same_size_jpeg(client, fakes):
    msg = bits_to_hex(np.random.default_rng(1).integers(0, 2, 256))
    r = client.post(f"/watermark/image/embed?message={msg.upper()}", content=_img_bytes())
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["x-watermark-model"] == "videoseal-1.0"
    assert r.headers["x-watermark-nbits"] == "256"
    out = Image.open(io.BytesIO(r.content))
    assert out.format == "JPEG" and out.size == (120, 80)
    assert bits_to_hex(fakes["videoseal_embedder"].bits[-1]) == msg


@pytest.mark.parametrize(("fmt", "mode"), [("PNG", "RGBA"), ("WEBP", "RGB"), ("PNG", "L")])
def test_image_embed_accepts_png_webp_and_gray(client, fmt, mode):
    r = client.post("/watermark/image/embed?message=" + "a" * 64, content=_img_bytes(fmt, (64, 48), mode))
    assert r.status_code == 200, r.text
    assert Image.open(io.BytesIO(r.content)).size == (64, 48)


@pytest.mark.parametrize("msg", ["a" * 63, "a" * 65, "z" * 64])
def test_image_embed_bad_message(client, msg):
    r = client.post(f"/watermark/image/embed?message={msg}", content=_img_bytes())
    assert r.status_code == 422
    assert r.json() == {"error": "invalid_message"}


def test_image_embed_requires_message_and_image(client):
    assert client.post("/watermark/image/embed", content=_img_bytes()).json()["error"] == "invalid_request"
    r = client.post("/watermark/image/embed?message=" + "0" * 64, content=b"no es una imagen")
    assert r.status_code == 422 and r.json() == {"error": "invalid_image"}
    r = client.post("/watermark/image/embed?message=" + "0" * 64, content=b"")
    assert r.status_code == 422 and r.json() == {"error": "empty_body"}


def test_image_detect_shape(client):
    r = client.post("/watermark/image/detect", content=_img_bytes())
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"detected", "score", "bits", "message_hex", "model"}
    assert body["model"] == "videoseal-1.0" and body["detected"] is False
    assert len(body["bits"]) == 256 and len(body["message_hex"]) == 64


def _screenshot(photo_size=(1080, 720), screen=(1080, 2340), photo: Image.Image | None = None
                ) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Captura falsa: fondo oscuro, barras con texto y una 'foto' (con textura si no se da) en el medio."""
    from PIL import ImageDraw

    rng = np.random.default_rng(0)
    shot = Image.new("RGB", screen, (11, 20, 26))
    d = ImageDraw.Draw(shot)
    d.rectangle((0, 0, screen[0], 90), fill=(0, 0, 0))
    d.rectangle((0, 90, screen[0], 250), fill=(31, 44, 52))
    d.text((40, 30), "12:34", fill=(255, 255, 255))
    d.text((140, 150), "Contacto (ficticio)", fill=(230, 230, 230))
    if photo is None:
        photo = Image.fromarray(rng.integers(0, 256, (photo_size[1], photo_size[0], 3), dtype=np.uint8))
    photo_size = photo.size
    x0, y0 = (screen[0] - photo_size[0]) // 2, (screen[1] - photo_size[1]) // 2
    shot.paste(photo, (x0, y0))
    return shot, (x0, y0, x0 + photo_size[0], y0 + photo_size[1])


def _near(box, truth, tol: int = 6) -> bool:
    return max(abs(a - b) for a, b in zip((box.x1, box.y1, box.x2, box.y2), truth, strict=True)) <= tol


def test_content_boxes_find_photo_in_screenshot():
    from blindaje_ml.imaging import content_boxes

    for size in [(1080, 720), (700, 900), (1080, 1900)]:
        shot, truth = _screenshot(size)
        assert any(_near(b, truth) for b in content_boxes(shot)), size


def test_content_boxes_find_flat_paper_in_screenshot():
    """Una nota sobre papel liso parece fondo por su textura, pero no por su color."""
    from PIL import ImageDraw

    paper = Image.new("RGB", (900, 1200), (236, 232, 222))
    d = ImageDraw.Draw(paper)
    for i in range(8):
        d.rectangle((80, 150 + 110 * i, 780, 170 + 110 * i), fill=(40, 40, 60))
    shot, truth = _screenshot(photo=paper.resize((810, 1080)))
    from blindaje_ml.imaging import content_boxes

    assert any(_near(b, truth) for b in content_boxes(shot))


def test_content_boxes_empty_without_borders():
    from blindaje_ml.imaging import content_boxes

    rng = np.random.default_rng(1)
    assert content_boxes(Image.fromarray(rng.integers(0, 256, (480, 640, 3), dtype=np.uint8))) == []
    assert content_boxes(Image.new("RGB", (640, 480), (200, 200, 200))) == []


def test_image_detect_also_reads_cropped_screenshot(client, fakes):
    shot, _ = _screenshot()
    buf = io.BytesIO()
    shot.save(buf, "PNG")
    r = client.post("/watermark/image/detect", content=buf.getvalue())
    assert r.status_code == 200, r.text
    assert fakes["videoseal"].frames >= 2  # la captura entera y la zona de la foto


def test_image_embed_without_embedder_is_503(make_client, fakes):
    fakes.pop("videoseal_embedder")
    r = make_client().post("/watermark/image/embed?message=" + "0" * 64, content=_img_bytes())
    assert r.status_code == 503
    assert r.json() == {"error": "model_unavailable", "detail": "videoseal_embedder_not_configured"}
