"""Punto de entrada de uvicorn: `uvicorn blindaje_ml.main:app --host 0.0.0.0 --port 8080`."""

from .app import create_app

app = create_app()
