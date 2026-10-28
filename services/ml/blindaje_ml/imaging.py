"""Imágenes: decodificación segura, hash perceptual, recortes y pixelado de regiones.

Todas las salidas JPEG se escriben sin EXIF (sin GPS ni datos del teléfono).
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

import imagehash
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 60_000_000  # ~ 60 MP: suficiente para fotos de celular, evita bombas


class ImageError(Exception):
    pass


@dataclass(frozen=True)
class Box:
    x1: int
    y1: int
    x2: int
    y2: int

    def as_dict(self) -> dict[str, int]:
        return {"x1": self.x1, "y1": self.y1, "x2": self.x2, "y2": self.y2}


def decode(data: bytes) -> Image.Image:
    """Decodifica y aplica la orientación EXIF (las cajas se interpretan sobre la imagen ya rotada)."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError) as e:
        raise ImageError("invalid_image") from e
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        background.paste(rgba, mask=rgba.getchannel("A"))
        img = background
    return img.convert("RGB")


def phash_hex(img: Image.Image) -> str:
    """Hash perceptual de 64 bits (imagehash.phash) en 16 caracteres hex."""
    return str(imagehash.phash(img, hash_size=8))


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def resolve_box(box: dict, width: int, height: int) -> Box | None:
    """Cajas en píxeles; si las cuatro coordenadas están en [0, 1] y alguna no es entera, se toman
    como fracciones del ancho y alto.

    Se recortan a los bordes de la imagen. Devuelve None si la caja queda vacía.
    """
    x1, y1, x2, y2 = (float(box[k]) for k in ("x1", "y1", "x2", "y2"))
    vals = (x1, y1, x2, y2)
    if all(0.0 <= v <= 1.0 for v in vals) and any(not v.is_integer() for v in vals):
        x1, x2 = x1 * width, x2 * width
        y1, y2 = y1 * height, y2 * height
    x1, x2 = sorted((x1, x2))
    y1, y2 = sorted((y1, y2))
    bx = Box(
        max(0, math.floor(x1)), max(0, math.floor(y1)), min(width, math.ceil(x2)), min(height, math.ceil(y2))
    )
    if bx.x2 - bx.x1 < 2 or bx.y2 - bx.y1 < 2:
        return None
    return bx


def _longest_run(active, max_gap: int) -> tuple[int, int] | None:
    """Tramo [a, b) más largo de posiciones activas, uniendo huecos de hasta `max_gap`."""
    best, start, last = None, None, None
    for i, on in enumerate(active):
        if not on:
            continue
        if start is None or i - last > max_gap + 1:
            start = i
        last = i
        if best is None or last + 1 - start > best[1] - best[0]:
            best = (start, last + 1)
    return best


def _box_from_mask(content, k: float, w: int, h: int) -> Box | None:
    """`content(a2d) -> (filas, columnas)`: máscaras de contenido. Tramo más largo de filas y, dentro,
    de columnas, llevado al tamaño original."""
    rows_on, _ = content(None)
    rows = _longest_run(rows_on, max_gap=max(2, len(rows_on) // 50))
    if rows is None:
        return None
    _, cols_on = content(rows)
    cols = _longest_run(cols_on, max_gap=max(2, len(cols_on) // 50))
    if cols is None:
        return None
    box = Box(math.floor(cols[0] / k), math.floor(rows[0] / k), min(w, math.ceil(cols[1] / k)),
              min(h, math.ceil(rows[1] / k)))
    bw, bh = box.x2 - box.x1, box.y2 - box.y1
    if bw * bh > 0.95 * w * h or bw < 64 or bh < 64:
        return None
    return box


def content_boxes(img: Image.Image, flat_std: float = 4.0, bg_diff: float = 30.0) -> list[Box]:
    """Zonas con contenido dentro de bordes lisos, como una foto dentro de una captura de pantalla (barras
    de la app, fondo de un color). Dos criterios, porque ninguno sirve siempre:

    - una fila o columna tiene contenido si no es lisa (desviación estándar alta): falla con una nota
      sobre papel liso, que parece fondo;
    - o además si la mayoría de sus píxeles se aleja del color de fondo (mediana del borde de la imagen):
      falla cuando la foto ocupa los bordes y la mediana ya no es el fondo.

    Para cada uno se toma el tramo más largo de filas con contenido y, dentro, el de columnas. Devuelve
    las cajas distintas (vacío si la imagen ya es todo contenido o si lo que queda es muy chico)."""
    import numpy as np

    w, h = img.size
    k = min(1.0, 512 / max(w, h))
    small = img.convert("L").resize((max(1, round(w * k)), max(1, round(h * k))), Image.Resampling.BOX)
    a = np.asarray(small, dtype=np.float32)
    bg = float(np.median(np.concatenate([a[:3].ravel(), a[-3:].ravel(), a[:, :3].ravel(), a[:, -3:].ravel()])))
    away = np.abs(a - bg) > bg_diff

    def flat_only(rows):
        if rows is None:
            return a.std(axis=1) > flat_std, None
        return None, a[rows[0] : rows[1]].std(axis=0) > flat_std

    def flat_or_color(rows):
        if rows is None:
            return (a.std(axis=1) > flat_std) | (away.mean(axis=1) > 0.6), None
        band, band_away = a[rows[0] : rows[1]], away[rows[0] : rows[1]]
        return None, (band.std(axis=0) > flat_std) | (band_away.mean(axis=0) > 0.6)

    out: list[Box] = []
    for content in (flat_only, flat_or_color):
        box = _box_from_mask(content, k, w, h)
        if box is not None and all(max(abs(box.x1 - b.x1), abs(box.y1 - b.y1), abs(box.x2 - b.x2),
                                       abs(box.y2 - b.y2)) > 8 for b in out):
            out.append(box)
    return out


def to_jpeg(img: Image.Image, quality: int = 88) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def pixelate(img: Image.Image, boxes: list[Box], blocks: int = 8, min_block: int = 10) -> Image.Image:
    """Pixela cada región con bloques grandes (al menos `min_block` px, a lo más `blocks` por lado)."""
    out = img.copy()
    for b in boxes:
        region = out.crop((b.x1, b.y1, b.x2, b.y2))
        w, h = region.size
        block = max(min_block, math.ceil(max(w, h) / blocks))
        small = region.resize((max(1, math.ceil(w / block)), max(1, math.ceil(h / block))), Image.Resampling.BOX)
        out.paste(small.resize((w, h), Image.Resampling.NEAREST), (b.x1, b.y1))
    return out
