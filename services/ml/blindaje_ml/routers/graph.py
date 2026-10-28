from __future__ import annotations

from fastapi import APIRouter

from .. import graph
from ..schemas import GraphRequest

router = APIRouter()


@router.post("/graph/analyze")
def graph_analyze(body: GraphRequest) -> dict:
    return graph.analyze(
        [n.model_dump() for n in body.nodes],
        [e.model_dump() for e in body.edges],
    )
