"""Descarga los pesos de los modelos y las fuentes a un directorio (por defecto `services/ml/models`).

Se usa en el build de Docker (`/models`) y en desarrollo local. Revisiones fijadas para que la
imagen sea reproducible. Licencias verificadas en Hugging Face el 2026-10-28:
  speechbrain/spkrec-ecapa-voxceleb  Apache-2.0
  intfloat/multilingual-e5-small     MIT
  facebook/dinov2-small              Apache-2.0
  Atkinson Hyperlegible (Google Fonts, Braille Institute)  SIL OFL 1.1
Marcas de agua de Meta (licencias verificadas en GitHub y Hugging Face el 2026-10-28):
  facebook/audioseal (detector y generador)  MIT, código y pesos
  facebookresearch/videoseal 1.0 (y_256b_img.jit)  MIT

Video Seal: se descarga el modelo completo en TorchScript (embebedor + extractor) y se guarda aparte
solo el extractor (`videoseal/detector.jit`, ~134 MB), que es lo único que usa el servicio. El
generador de AudioSeal y el modelo completo de Video Seal sirven solo para los tests pesados; con
`--test-dest DIR` se mueven a DIR (la imagen final no los lleva).

Uso:
  python scripts/download_models.py [destino] [--fonts-only] [--verify] [--test-dest DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "spkrec-ecapa-voxceleb": {
        "repo": "speechbrain/spkrec-ecapa-voxceleb",
        "revision": "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286",
        "allow": ["hyperparams.yaml", "embedding_model.ckpt", "mean_var_norm_emb.ckpt",
                  "classifier.ckpt", "label_encoder.txt", "README.md"],
    },
    "multilingual-e5-small": {
        "repo": "intfloat/multilingual-e5-small",
        "revision": "614241f622f53c4eeff9890bdc4f31cfecc418b3",
        "allow": ["config.json", "model.safetensors", "sentencepiece.bpe.model", "special_tokens_map.json",
                  "tokenizer.json", "tokenizer_config.json", "README.md"],
    },
    "dinov2-small": {
        "repo": "facebook/dinov2-small",
        "revision": "ed25f3a31f01632728cabb09d1542f84ab7b0056",
        "allow": ["config.json", "model.safetensors", "preprocessor_config.json", "README.md"],
    },
}

AUDIOSEAL_REVISION = "3c19eba53390776cf2cc9ed5f6c9ac67ce72ecba"
AUDIOSEAL_BASE = f"https://huggingface.co/facebook/audioseal/resolve/{AUDIOSEAL_REVISION}/"
# (carpeta, archivo, URL, SHA-256, solo para tests)
WATERMARK_FILES = [
    ("audioseal", "detector_base.pth", AUDIOSEAL_BASE + "detector_base.pth",
     "8a78e8a83584113523e161fc599fcab10fd0e94c04d2eb9d2fa1e9ec91ab69d9", False),
    ("audioseal", "generator_base.pth", AUDIOSEAL_BASE + "generator_base.pth",
     "7a845b5fbe9364a63a3909d8ab3fe064d13a76ae4c2e983573e08c69b7b51748", True),
    ("videoseal", "y_256b_img.jit", "https://dl.fbaipublicfiles.com/videoseal/y_256b_img.jit",
     "5c7a4581c36fc6090aafdcfb3999123bae5172a4847f22e2da4e7fd1a39d1e1b", True),
]

FONTS_COMMIT = "95f4904fc8bcf26d3420fe315560c96417c6dec7"
FONTS_BASE = f"https://raw.githubusercontent.com/google/fonts/{FONTS_COMMIT}/ofl/atkinsonhyperlegible/"
FONTS = {
    "AtkinsonHyperlegible-Regular.ttf": "7fb917c89019896d0b52ee84b7cbb3304c18cb90b19a62f5e32712bd23e97669",
    "AtkinsonHyperlegible-Bold.ttf": "5a3b0c8cc8ca545155150b4512a1fa248298df121c50d6557e651e61fbdab92f",
    "AtkinsonHyperlegible-Italic.ttf": "021beda4d3c6edfc78872e436d74009f9a1bcb294331908fe5747c61d3dcc514",
    "AtkinsonHyperlegible-BoldItalic.ttf": "7a46f1b0ef2f64b61065c1a6b5a11fcb9b019b44062d88ba121a083cc39e86bf",
    "OFL.txt": "f32d22b3908fcad2c86a74000614ec22e6a7f66ea7e867e616026a27aebdc143",
}


def fetch_fonts(dest: Path) -> None:
    out = dest / "fonts"
    out.mkdir(parents=True, exist_ok=True)
    for name, digest in FONTS.items():
        target = out / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == digest:
            continue
        with urllib.request.urlopen(FONTS_BASE + name, timeout=60) as r:  # URL fija con checksum
            data = r.read()
        got = hashlib.sha256(data).hexdigest()
        if got != digest:
            sys.exit(f"checksum distinto para {name}: {got}")
        target.write_bytes(data)
        print(f"fuente {name} ok")


def fetch_models(dest: Path) -> None:
    from huggingface_hub import snapshot_download

    for local, spec in MODELS.items():
        path = snapshot_download(
            repo_id=spec["repo"],
            revision=spec["revision"],
            allow_patterns=spec["allow"],
            local_dir=dest / local,
        )
        print(f"modelo {spec['repo']}@{spec['revision'][:8]} en {path}")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_watermark(dest: Path) -> None:
    for folder, name, url, digest, _ in WATERMARK_FILES:
        target = dest / folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and _sha256(target) == digest:
            continue
        tmp = target.with_suffix(target.suffix + ".part")
        with urllib.request.urlopen(url, timeout=300) as r, tmp.open("wb") as f:  # URL fija con checksum
            while chunk := r.read(1 << 20):
                f.write(chunk)
        got = _sha256(tmp)
        if got != digest:
            tmp.unlink()
            sys.exit(f"checksum distinto para {folder}/{name}: {got}")
        tmp.replace(target)
        print(f"marca de agua {folder}/{name} ok")
    # Solo el extractor de Video Seal: el servicio no inserta marcas.
    detector = dest / "videoseal" / "detector.jit"
    if not detector.exists():
        import torch

        full = torch.jit.load(str(dest / "videoseal" / "y_256b_img.jit"), map_location="cpu")
        torch.jit.save(full.detector, str(detector))
        print(f"extractor de Video Seal en {detector}")


def move_test_weights(dest: Path, test_dest: Path) -> None:
    for folder, name, _, _, test_only in WATERMARK_FILES:
        src = dest / folder / name
        if test_only and src.exists():
            (test_dest / folder).mkdir(parents=True, exist_ok=True)
            src.replace(test_dest / folder / name)


def verify(dest: Path) -> None:
    """Carga los tres modelos desde disco, sin red, y calcula un vector de cada uno."""
    import os

    os.environ["ML_MODELS_DIR"] = str(dest)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import numpy as np
    from PIL import Image

    from blindaje_ml.config import reset_settings
    from blindaje_ml.models import DinoEmbedder, E5Embedder, EcapaEmbedder
    from blindaje_ml.watermark import AudioSealDetector, VideoSealDetector

    reset_settings()
    rng = np.random.default_rng(0)
    v = EcapaEmbedder().embed([rng.standard_normal(48_000).astype(np.float32) * 0.1])
    t = E5Embedder().embed(["prueba"], "query")
    i = DinoEmbedder().embed([Image.new("RGB", (64, 32), (200, 10, 10))])
    a = AudioSealDetector().detect(rng.standard_normal(32_000).astype(np.float32) * 0.1)
    w = VideoSealDetector().detect([Image.new("RGB", (64, 32), (200, 10, 10))])
    print(f"verificado: voz {v.shape}, texto {t.shape}, imagen {i.shape}, audioseal {a}, videoseal {w}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dest", nargs="?", default=str(Path(__file__).resolve().parent.parent / "models"))
    ap.add_argument("--fonts-only", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--test-dest", help="mueve aquí los pesos que solo usan los tests")
    args = ap.parse_args()
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    fetch_fonts(dest)
    if not args.fonts_only:
        fetch_models(dest)
        fetch_watermark(dest)
    if args.verify:
        verify(dest)
    if args.test_dest and not args.fonts_only:
        move_test_weights(dest, Path(args.test_dest))


if __name__ == "__main__":
    main()
