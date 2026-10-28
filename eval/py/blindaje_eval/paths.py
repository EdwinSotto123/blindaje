"""Rutas compartidas de la evaluación. Todo es relativo a la carpeta eval/ del repo."""

from __future__ import annotations

import os
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = EVAL_DIR / "data"
DOWNLOADS_DIR = DATA_DIR / "downloads"  # en .gitignore
CACHE_DIR = DATA_DIR / "cache"  # en .gitignore
RESULTS_DIR = CACHE_DIR / "results"  # resultados intermedios que lee src/run.ts
SLR73_DIR = DOWNLOADS_DIR / "slr73"
MODELS_DIR = DOWNLOADS_DIR / "models"
AUDIO_RAW_DIR = EVAL_DIR / "audio" / "raw"  # grabaciones de voluntarios (no se suben)
AUDIO_WHATSAPP_DIR = EVAL_DIR / "audio" / "whatsapp"  # audios simulados (no se suben)
DEMO_DIR = EVAL_DIR / "demo"

ML_URL = os.environ.get("ML_URL", "http://localhost:8080").rstrip("/")
ML_TOKEN = os.environ.get("ML_TOKEN")


def ensure_dirs() -> None:
    for d in (DOWNLOADS_DIR, CACHE_DIR, RESULTS_DIR, MODELS_DIR, AUDIO_WHATSAPP_DIR):
        d.mkdir(parents=True, exist_ok=True)
