from __future__ import annotations

from fastapi import Request

from ..app import MlState


def ml(request: Request) -> MlState:
    return request.app.state.ml
