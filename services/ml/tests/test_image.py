from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image

from blindaje_ml import imaging


def _img_b64(img: Image.Image, fmt: str = "JPEG", **kw) -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, **kw)
    return base64.b64encode(buf.getvalue()).decode()


def _pattern(w=320, h=200) -> Image.Image:
    rng = np.random.default_rng(0)
    arr = (rng.random((h, w, 3)) * 255).astype(np.uint8)
    arr[50:150, 100:220] = [200, 30, 30]
    return Image.fromarray(arr)


def test_phash_is_64_bit_hex_and_stable():
    img = _pattern()
    h1 = imaging.phash_hex(img)
    h2 = imaging.phash_hex(img.resize((160, 100)))
    assert len(h1) == 16 and int(h1, 16) >= 0
    assert imaging.hamming(h1, h2) <= 6


def test_resolve_box_pixels_fractions_and_clamp():
    b = imaging.resolve_box({"x1": 10, "y1": 20, "x2": 110, "y2": 90}, 320, 200)
    assert b.as_dict() == {"x1": 10, "y1": 20, "x2": 110, "y2": 90}
    f = imaging.resolve_box({"x1": 0.25, "y1": 0.5, "x2": 0.75, "y2": 1.0}, 320, 200)
    assert f.as_dict() == {"x1": 80, "y1": 100, "x2": 240, "y2": 200}
    c = imaging.resolve_box({"x1": -50, "y1": 150, "x2": 9999, "y2": 120}, 320, 200)
    assert c.as_dict() == {"x1": 0, "y1": 120, "x2": 320, "y2": 150}
    assert imaging.resolve_box({"x1": 5, "y1": 5, "x2": 6, "y2": 6}, 320, 200) is None


def test_crops_route(client):
    r = client.post(
        "/image/crops",
        json={
            "image_b64": _img_b64(_pattern(), "PNG"),
            "boxes": [
                {"x1": 100, "y1": 50, "x2": 220, "y2": 150, "concept": "nota escrita a mano"},
                {"x1": 0.0, "y1": 0.0, "x2": 0.5, "y2": 0.5, "concept": "fachada de tienda"},
                {"x1": 1, "y1": 1, "x2": 1, "y2": 1, "concept": "vacía"},
            ],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dim"] == 384
    assert len(body["full"]["phash"]) == 16 and len(body["full"]["vector"]) == 384
    assert [c["concept"] for c in body["crops"]] == ["nota escrita a mano", "fachada de tienda"]
    first = body["crops"][0]
    assert first["box"] == {"x1": 100, "y1": 50, "x2": 220, "y2": 150}
    crop = Image.open(io.BytesIO(base64.b64decode(first["crop_jpeg_b64"])))
    assert crop.size == (120, 100)
    assert not crop.getexif()


def _smooth_with_noisy_corner(w=320, h=200) -> Image.Image:
    yy, xx = np.mgrid[0:h, 0:w]
    arr = np.stack([xx * 255 / w, yy * 255 / h, np.full_like(xx, 120)], axis=-1).astype(np.float32)
    checker = ((xx[:80, :80] // 2 + yy[:80, :80] // 2) % 2) * 255
    arr[:80, :80] = checker[..., None]
    return Image.fromarray(arr.astype(np.uint8))


def test_redact_route_pixelates_only_regions(client):
    img = _smooth_with_noisy_corner()
    r = client.post(
        "/image/redact",
        json={"image_b64": _img_b64(img, "PNG"), "regions": [{"x1": 0, "y1": 0, "x2": 80, "y2": 80}]},
    )
    assert r.status_code == 200
    assert r.headers["x-regions"] == "1"
    out = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB")).astype(np.float32)
    src = np.asarray(img).astype(np.float32)
    # Dentro de la región: el damero de 2 px queda en bloques casi lisos de 10 px.
    assert src[0:10, 0:10].std() > 100
    assert out[1:9, 1:9].std(axis=(0, 1)).max() < 12
    # Fuera de la región: la imagen sigue igual (salvo compresión JPEG).
    assert np.abs(out[100:, 120:] - src[100:, 120:]).mean() < 4


def test_redact_strips_exif(client):
    img = _pattern()
    exif = Image.Exif()
    exif[0x010F] = "MarcaTelefono"  # Make
    r = client.post("/image/redact", json={"image_b64": _img_b64(img, exif=exif.tobytes()), "regions": []})
    assert r.status_code == 200
    assert b"MarcaTelefono" not in r.content


def test_exif_orientation_is_applied():
    img = Image.new("RGB", (40, 20), (0, 0, 255))
    exif = Image.Exif()
    exif[0x0112] = 6  # rotar 90 grados
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    assert imaging.decode(buf.getvalue()).size == (20, 40)


def test_invalid_image(client):
    r = client.post("/image/crops", json={"image_b64": base64.b64encode(b"no soy imagen").decode()})
    assert r.status_code == 422
    assert r.json()["error"] == "invalid_image"
