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
