"""Logs estructurados en JSON, una línea por evento.

Regla: nunca se registran cuerpos, vectores, textos, transcripciones, imágenes ni tokens.
Solo metadatos operativos (ruta, estado, duración, tamaños, conteos).
"""

from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any

_logger = logging.getLogger("blindaje_ml")


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "event": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if fields:
            payload.update(fields)
        if record.exc_info:
            exc_type = record.exc_info[0]
            payload["exc_type"] = exc_type.__name__ if exc_type else None
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: int = logging.INFO) -> None:
    if any(isinstance(h.formatter, _JsonFormatter) for h in _logger.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    _logger.addHandler(handler)
    _logger.setLevel(level)
    _logger.propagate = False


def log(event: str, level: int = logging.INFO, **fields: Any) -> None:
    _logger.log(level, event, extra={"fields": fields})


def log_exception(event: str, **fields: Any) -> None:
    _logger.error(event, exc_info=True, extra={"fields": fields})
