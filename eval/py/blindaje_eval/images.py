"""Imágenes reutilizadas: hash perceptual (64 bits) y DINOv2 sobre fotos del demo y notas ficticias.

Fuentes (todas ficticias):
- P1 = eval/demo/foto-A.jpg y P2 = eval/demo/foto-alternativa.jpg (Muse Image): una escena
  parecida pero no la misma foto, el caso difícil.
- N1…N12: notas manuscritas ficticias generadas aquí con fuentes de sistema.

Transformaciones que simulan el reenvío: original, whatsapp (lado mayor 1280 px y JPEG 60),
captura (recorte del 90 %, bordes negros de barra de estado y JPEG 75) y doble reenvío.

Rasgos: phash con imagehash (igual que services/ml, imaging.phash_hex) y DINOv2 ViT-S/14 con el
mismo preprocesamiento del contenedor (relleno a cuadrado gris, 224 px, CLS de pooler_output).
Backend de DINOv2: el contenedor (/image/crops, vector `full`) si responde; si no, local.

Uso:
  uv run python -I -m blindaje_eval.images --backend auto|ml|local
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import random
from pathlib import Path

import httpx
import imagehash
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from .paths import CACHE_DIR, DEMO_DIR, ML_TOKEN, ML_URL, MODELS_DIR, RESULTS_DIR, ensure_dirs

NOTAS = [
    "LOS X. 48 HORAS",
    "PAGA O CIERRAS",
    "ÚLTIMO AVISO",
    "GENTE SERIA. ÚLTIMO PLAZO",
    "COLABORA. LOS X",
    "EL QUE NO PAGA NO TRABAJA",
    "TE ESTAMOS MIRANDO",
    "YA SABEMOS DÓNDE TRABAJAS",
    "NO TE HAGAS EL LOCO",
    "TÚ DECIDES CÓMO ACABA ESTO",
    "NADIE SE SALVA",
    "SE TE ACABÓ EL PLAZO",
]
FUENTES = ["Inkfree.ttf", "segoepr.ttf", "segoesc.ttf", "comic.ttf", "LHANDW.TTF"]
TRANSFORMACIONES = ["original", "whatsapp", "captura", "doble_reenvio"]
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def _fuente(i: int, size: int) -> ImageFont.ImageFont:
    for k in range(len(FUENTES)):
        name = FUENTES[(i + k) % len(FUENTES)]
        for base in (Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype"), Path("/Library/Fonts")):
            p = base / name
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size=size)


def nota(i: int) -> Image.Image:
    """Nota manuscrita ficticia sobre hoja cuadriculada, con leve rotación y ruido."""
    rng = random.Random(100 + i)
    w, h = 1200, 900
    tinte = rng.randint(236, 252)
    img = Image.new("RGB", (w, h), (tinte, tinte, max(tinte - rng.randint(0, 14), 200)))
    d = ImageDraw.Draw(img)
    paso = rng.choice([36, 40, 44])
    for x in range(0, w, paso):
        d.line([(x, 0), (x, h)], fill=(190, 205, 225), width=1)
    for y in range(0, h, paso):
        d.line([(0, y), (w, y)], fill=(190, 205, 225), width=1)
    texto = NOTAS[i % len(NOTAS)]
    palabras = texto.split()
    lineas, actual = [], ""
    for p in palabras:
        if len(actual) + len(p) > 12 and actual:
            lineas.append(actual)
            actual = p
        else:
            actual = f"{actual} {p}".strip()
    lineas.append(actual)
    f = _fuente(i, rng.randint(110, 140))
    y = rng.randint(120, 220)
    for ln in lineas:
        d.text((rng.randint(80, 200), y), ln, font=f, fill=(rng.randint(10, 40),) * 3)
        y += int(f.size * 1.25) if hasattr(f, "size") else 140
    img = img.rotate(rng.uniform(-4, 4), resample=Image.Resampling.BICUBIC, fillcolor=(90, 80, 70))
    arr = np.asarray(img).astype(np.int16)
    arr = np.clip(arr + np.random.default_rng(i).normal(0, 5, arr.shape), 0, 255).astype(np.uint8)
    return Image.fromarray(arr).filter(ImageFilter.GaussianBlur(0.6))


def _jpeg(img: Image.Image, q: int) -> Image.Image:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q)
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")


def transformar(img: Image.Image, t: str) -> Image.Image:
    if t == "original":
        return img
    if t == "whatsapp":
        im = img.copy()
        im.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        return _jpeg(im, 60)
    if t == "captura":
        w, h = img.size
        im = img.crop((int(0.05 * w), int(0.05 * h), int(0.95 * w), int(0.95 * h)))
        im = ImageOps.expand(im, border=(0, 60, 0, 90), fill=(0, 0, 0))
        im.thumbnail((1080, 1920), Image.Resampling.LANCZOS)
        return _jpeg(im, 75)
    if t == "doble_reenvio":
        return transformar(transformar(img, "whatsapp").resize((960, int(960 * img.size[1] / img.size[0]))), "whatsapp")
    raise ValueError(t)


class Dino:
    def __init__(self, backend: str) -> None:
        self.backend = backend
        self._model = None
        self.client = None
        if backend in ("ml", "auto"):
            c = httpx.Client(base_url=ML_URL, headers={"x-ml-token": ML_TOKEN} if ML_TOKEN else {}, timeout=120)
            try:
                if c.get("/health", timeout=5).status_code == 200:
                    self.client = c
                    self.backend = "ml"
            except Exception:  # noqa: BLE001
                pass
            if self.client is None and backend == "ml":
                raise RuntimeError(f"El contenedor ML no responde en {ML_URL}")
        if self.client is None:
            self.backend = "local"

    def _local(self, img: Image.Image) -> np.ndarray:
        import torch
        from transformers import AutoModel

        if self._model is None:
            self._model = AutoModel.from_pretrained("facebook/dinov2-small", cache_dir=str(MODELS_DIR / "hf")).eval()
        w, h = img.size
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), (124, 116, 104))
        canvas.paste(img, ((side - w) // 2, (side - h) // 2))
        canvas = canvas.resize((224, 224), Image.Resampling.BICUBIC)
        arr = (np.asarray(canvas, dtype=np.float32) / 255.0 - _MEAN) / _STD
        x = torch.from_numpy(arr.transpose(2, 0, 1)[None].copy())
        with torch.inference_mode():
            v = self._model(pixel_values=x).pooler_output[0].cpu().numpy()
        return v / np.linalg.norm(v)

    def __call__(self, img: Image.Image) -> tuple[np.ndarray, str | None]:
        if self.client is not None:
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=95)
            r = self.client.post("/image/crops", json={"image_b64": base64.b64encode(buf.getvalue()).decode(), "boxes": []})
            r.raise_for_status()
            full = r.json()["full"]
            return np.asarray(full["vector"], dtype=np.float32), full.get("phash")
        return self._local(img), None


def run(backend: str = "auto") -> dict:
    ensure_dirs()
    fuentes: dict[str, Image.Image] = {}
    for clave, archivo in (("P1", "foto-A.jpg"), ("P2", "foto-alternativa.jpg")):
        p = DEMO_DIR / archivo
        if p.exists():
            fuentes[clave] = Image.open(p).convert("RGB")
    for i in range(len(NOTAS)):
        fuentes[f"N{i + 1}"] = nota(i)
    muestras_dir = CACHE_DIR / "imagenes"
    muestras_dir.mkdir(parents=True, exist_ok=True)
    dino = Dino(backend)
    feats: dict[str, dict] = {}
    for k, img in fuentes.items():
        for t in TRANSFORMACIONES:
            im = transformar(img, t)
            if k in ("N1", "N2"):
                im.save(muestras_dir / f"{k}-{t}.jpg", quality=90)
            vec, ph_ml = dino(im)
            ph = str(imagehash.phash(im, hash_size=8))
            feats[f"{k}:{t}"] = {"phash": ph, "phash_ml": ph_ml, "dino": [round(float(x), 6) for x in vec]}
    # Distribuciones: misma fuente con distinta transformación vs fuentes distintas
    keys = sorted(feats)
    ham_same, ham_diff, dino_same, dino_diff, dino_pp = [], [], [], [], []

    def hd(a: str, b: str) -> int:
        return int(imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b))

    for i, a in enumerate(keys):
        for b in keys[i + 1 :]:
            fa, fb = a.split(":")[0], b.split(":")[0]
            h = hd(feats[a]["phash"], feats[b]["phash"])
            d = float(np.dot(feats[a]["dino"], feats[b]["dino"]))
            if fa == fb:
                ham_same.append(h)
                dino_same.append(d)
            else:
                ham_diff.append(h)
                dino_diff.append(d)
                if {fa, fb} == {"P1", "P2"}:
                    dino_pp.append(d)

    def resumen(x: list[float]) -> dict:
        a = np.asarray(x, dtype=np.float64)
        return {"n": int(a.size), "min": float(a.min()), "media": float(a.mean()), "max": float(a.max()),
                "p05": float(np.quantile(a, 0.05)), "p95": float(np.quantile(a, 0.95))}

    hm = 10
    res = {
        "backend_dino": dino.backend,
        "fuentes": sorted(fuentes),
        "transformaciones": TRANSFORMACIONES,
        "imagenes": {k: {"phash": v["phash"], "dino": v["dino"]} for k, v in feats.items()},
        "phash_coincide_con_ml": all(v["phash_ml"] in (None, v["phash"]) for v in feats.values()),
        "distribuciones": {
            "hamming_misma_imagen": resumen(ham_same),
            "hamming_distintas": resumen(ham_diff),
            "dino_misma_imagen": resumen(dino_same),
            "dino_distintas": resumen(dino_diff),
            "dino_foto_A_vs_alternativa": resumen(dino_pp) if dino_pp else None,
        },
        "con_hamming_max_10": {
            "reutilizadas_detectadas": float(np.mean(np.asarray(ham_same) <= hm)),
            "distintas_marcadas": float(np.mean(np.asarray(ham_diff) <= hm)),
        },
    }
    (RESULTS_DIR / "imagenes.json").write_text(json.dumps(res), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k not in ("imagenes",)}, indent=1, ensure_ascii=False))
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["auto", "ml", "local"], default="auto")
    a = ap.parse_args()
    run(a.backend)


if __name__ == "__main__":
    main()
