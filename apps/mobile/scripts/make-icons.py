"""Genera los íconos del disfraz (Cuaderno, Lista, Calculadora) con Pillow.

Uso: python scripts/make-icons.py  (desde apps/mobile). Los PNG resultantes se suben al repo.
Diseño: papel cuadriculado, línea de margen roja y una letra en Kalam (cuaderno-sistema.dc.html).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "images"
KALAM = ROOT / "node_modules/@expo-google-fonts/kalam/700Bold/Kalam_700Bold.ttf"

PAPEL = (0xFB, 0xFC, 0xFE, 255)
CUADRICULA = (0xE3, 0xEB, 0xF5, 255)
BORDE = (0xC9, 0xD6, 0xE6, 255)
TINTA = (0x1E, 0x3A, 0x70, 255)
MARGEN = (0xD6, 0x45, 0x45, 255)

def paper(size: int, grid: bool = True) -> Image.Image:
    img = Image.new("RGBA", (size, size), PAPEL)
    d = ImageDraw.Draw(img)
    if grid:
        step = size // 16
        for x in range(0, size, step):
            d.line([(x, 0), (x, size)], fill=CUADRICULA, width=max(1, size // 512))
        for y in range(0, size, step):
            d.line([(0, y), (size, y)], fill=CUADRICULA, width=max(1, size // 512))
    return img

def glyph(img: Image.Image, letter: str, box: tuple[int, int, int, int], color=TINTA, margin_line=True):
    d = ImageDraw.Draw(img, "RGBA")
    x0, y0, x1, y1 = box
    w = x1 - x0
    if margin_line:
        mx = x0 + int(w * 0.22)
        d.line([(mx, y0), (mx, y1)], fill=(MARGEN[0], MARGEN[1], MARGEN[2], 175), width=max(2, w // 40))
    font = ImageFont.truetype(str(KALAM), int(w * 0.62))
    bbox = d.textbbox((0, 0), letter, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    cx = x0 + int(w * 0.58) - tw // 2 - bbox[0]
    cy = y0 + (y1 - y0) // 2 - th // 2 - bbox[1]
    d.text((cx, cy), letter, font=font, fill=color)

def make(letter: str, suffix: str):
    # Ícono clásico (iOS / legacy): papel completo.
    icon = paper(1024)
    glyph(icon, letter, (0, 0, 1024, 1024))
    icon.save(OUT / f"icon{suffix}.png")
    # Adaptive icon de Android: primer plano transparente dentro de la zona segura (66 %).
    fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    glyph(fg, letter, (192, 192, 832, 832))
    fg.save(OUT / f"android-icon-foreground{suffix}.png")
    mono = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    glyph(mono, letter, (192, 192, 832, 832), color=(0, 0, 0, 255), margin_line=False)
    mono.save(OUT / f"android-icon-monochrome{suffix}.png")

make("C", "")
make("L", "-lista")
make("V", "-vueltos")

# Splash: la misma letra sobre fondo transparente (el fondo lo pone el plugin, color papel).
splash = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(splash)
d.rounded_rectangle([56, 56, 456, 456], radius=72, fill=PAPEL, outline=BORDE, width=8)
glyph(splash, "C", (56, 56, 456, 456))
splash.save(OUT / "splash-icon.png")

fav = paper(64, grid=False)
glyph(fav, "C", (0, 0, 64, 64))
fav.save(OUT / "favicon.png")
print("Íconos listos en", OUT)
