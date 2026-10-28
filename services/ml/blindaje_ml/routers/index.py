from __future__ import annotations

import io

import numpy as np
from fastapi import APIRouter, Request, Response
from starlette.concurrency import run_in_threadpool

from ..app import read_body
from ..schemas import IndexRemoveRequest, IndexSearchRequest, IndexWriteRequest
from .deps import ml

router = APIRouter()

COHORT_FILE = "cohort.npy"


@router.post("/index/add")
def index_add(body: IndexWriteRequest, request: Request) -> dict:
    size = ml(request).store.add(body.index, body.ids, body.matrix(), body.version)
    return {"ok": True, "size": size}


@router.post("/index/search")
def index_search(body: IndexSearchRequest, request: Request) -> dict:
    hits = ml(request).store.search(body.index, body.vector, body.k, body.exclude_ids)
    return {"results": [{"id": i, "score": round(s, 6)} for i, s in hits]}


@router.post("/index/remove")
def index_remove(body: IndexRemoveRequest, request: Request) -> dict:
    size = ml(request).store.remove(body.index, body.ids, body.version)
    return {"ok": True, "size": size}


@router.post("/index/rebuild")
def index_rebuild(body: IndexWriteRequest, request: Request) -> dict:
    size = ml(request).store.rebuild(body.index, body.ids, body.matrix(), body.version)
    return {"ok": True, "size": size}


@router.get("/index/snapshot")
def index_snapshot(request: Request) -> Response:
    state = ml(request)
    extra: dict[str, bytes] = {}
    cohort = state.cohort.matrix()
    if cohort is not None:
        buf = io.BytesIO()
        np.save(buf, cohort, allow_pickle=False)
        extra[COHORT_FILE] = buf.getvalue()
    blob = state.store.snapshot(extra)
    return Response(
        blob,
        media_type="application/octet-stream",
        headers={
            "content-disposition": 'attachment; filename="blindaje-indices.zip"',
            "x-index-version": state.store.version or "",
        },
    )


@router.post("/index/load")
async def index_load(request: Request) -> dict:
    data = await read_body(request)
    state = ml(request)
    sizes, extras = await run_in_threadpool(state.store.load, data)
    if COHORT_FILE in extras:
        arr = np.load(io.BytesIO(extras[COHORT_FILE]), allow_pickle=False)
        await run_in_threadpool(state.cohort.set, arr, False)
    return {"ok": True, "sizes": sizes, "index_version": state.store.version}
