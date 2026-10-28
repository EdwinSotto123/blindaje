"""Descarga los pesos de los modelos y las fuentes a un directorio (por defecto `services/ml/models`).

Se usa en el build de Docker (`/models`) y en desarrollo local. Revisiones fijadas para que la
imagen sea reproducible. Licencias verificadas en Hugging Face el 2026-10-28:
  speechbrain/spkrec-ecapa-voxceleb  Apache-2.0
  intfloat/multilingual-e5-small     MIT
  facebook/dinov2-small              Apache-2.0
  Atkinson Hyperlegible (Google Fonts, Braille Institute)  SIL OFL 1.1

Uso:
  python scripts/download_models.py [destino] [--fonts-only] [--verify]
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

    reset_settings()
    rng = np.random.default_rng(0)
    v = EcapaEmbedder().embed([rng.standard_normal(48_000).astype(np.float32) * 0.1])
    t = E5Embedder().embed(["prueba"], "query")
    i = DinoEmbedder().embed([Image.new("RGB", (64, 32), (200, 10, 10))])
    print(f"verificado: voz {v.shape}, texto {t.shape}, imagen {i.shape}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dest", nargs="?", default=str(Path(__file__).resolve().parent.parent / "models"))
    ap.add_argument("--fonts-only", action="store_true")
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    fetch_fonts(dest)
    if not args.fonts_only:
        fetch_models(dest)
    if args.verify:
        verify(dest)


if __name__ == "__main__":
    main()
