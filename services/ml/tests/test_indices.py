from __future__ import annotations

import base64
import io
import json
import zipfile

import numpy as np
import pytest

from blindaje_ml.indices import IndexError_, IndexStore


def _unit(rng, n, d):
    x = rng.standard_normal((n, d)).astype(np.float32)
    return x / np.linalg.norm(x, axis=1, keepdims=True)


def test_store_add_search_upsert_remove():
    rng = np.random.default_rng(0)
    s = IndexStore()
    vecs = _unit(rng, 5, 192)
    assert s.add("voz", [10, 11, 12, 13, 14], vecs) == 5
    hits = s.search("voz", vecs[2], k=3)
    assert hits[0][0] == 12 and hits[0][1] == pytest.approx(1.0, abs=1e-5)
    # upsert: el id 12 ahora apunta a otro vector, sin duplicar.
    assert s.add("voz", [12], vecs[0:1]) == 5
    assert [i for i, _ in s.search("voz", vecs[0], k=2)] in ([10, 12], [12, 10])
    assert s.remove("voz", [10, 999]) == 4
    assert 10 not in [i for i, _ in s.search("voz", vecs[0], k=10)]


def test_search_exclude_ids_and_small_index():
    rng = np.random.default_rng(1)
    s = IndexStore()
    vecs = _unit(rng, 4, 384)
    s.add("texto", [1, 2, 3, 4], vecs)
    hits = s.search("texto", vecs[0], k=2, exclude_ids=[1])
    assert len(hits) == 2 and 1 not in [i for i, _ in hits]
    assert len(s.search("texto", vecs[0], k=50)) == 4
    assert s.search("imagen", _unit(rng, 1, 384)[0], k=5) == []


def test_vectors_are_renormalized():
    s = IndexStore()
    s.add("imagen", [1], [np.full(384, 3.0)])
    (hit,) = s.search("imagen", np.full(384, 0.5), k=1)
    assert hit[1] == pytest.approx(1.0, abs=1e-5)


def test_validation_errors():
    s = IndexStore()
    with pytest.raises(IndexError_):
        s.add("voz", [1], [[1.0, 2.0]])
    with pytest.raises(IndexError_):
        s.add("voz", [1, 1], np.ones((2, 192)))
    with pytest.raises(IndexError_):
        s.add("nada", [1], np.ones((1, 192)))
    with pytest.raises(IndexError_):
        s.add("voz", [1, 2], np.ones((1, 192)))


def test_rebuild_replaces_everything():
    rng = np.random.default_rng(2)
    s = IndexStore()
    s.add("voz_segmento", [1, 2, 3], _unit(rng, 3, 192))
    assert s.rebuild("voz_segmento", [7], _unit(rng, 1, 192), version="v9") == 1
    ids, _ = s.vectors("voz_segmento")
    assert ids.tolist() == [7]
    assert s.version == "v9"


def test_snapshot_roundtrip_and_checksum():
    rng = np.random.default_rng(3)
    s = IndexStore()
    v = _unit(rng, 3, 192)
    s.add("voz", [5, 6, 7], v, version="2026-10-28T06:00:00Z#3")
    s.add("texto", [1], _unit(rng, 1, 384))
    blob = s.snapshot({"cohort.npy": b"abc"})
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        assert set(zf.namelist()) >= {"manifest.json", "voz.faiss", "texto.faiss", "cohort.npy"}
    assert manifest["indices"]["voz"]["size"] == 3
    assert manifest["index_version"] == "2026-10-28T06:00:00Z#3"

    t = IndexStore()
    t.add("imagen", [1], _unit(rng, 1, 384))
    sizes, extras = t.load(blob)
    assert sizes == {"voz": 3, "voz_segmento": 0, "texto": 1, "imagen": 0}
    assert extras == {"cohort.npy": b"abc"}
    assert t.version == "2026-10-28T06:00:00Z#3"
    assert t.search("voz", v[1], k=1)[0][0] == 6

    # Un snapshot alterado se rechaza y no toca el estado.
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(blob)) as src, zipfile.ZipFile(buf, "w") as dst:
        for name in src.namelist():
            data = src.read(name)
            if name == "voz.faiss":
                mid = len(data) // 2
                data = data[:mid] + bytes([data[mid] ^ 0xFF]) + data[mid + 1 :]
            dst.writestr(name, data)
    with pytest.raises(IndexError_):
        t.load(buf.getvalue())
    assert t.sizes()["voz"] == 3


def test_index_routes(client):
    rng = np.random.default_rng(4)
    v = _unit(rng, 3, 384)
    r = client.post("/index/add", json={"index": "texto", "ids": [1, 2, 3], "vectors": v.tolist(),
                                        "version": "abc"})
    assert r.json() == {"ok": True, "size": 3}
    r = client.post("/index/search", json={"index": "texto", "vector": v[0].tolist(), "k": 2,
                                           "exclude_ids": [1]})
    assert r.status_code == 200
    assert [x["id"] for x in r.json()["results"]] in ([2, 3], [3, 2])
    assert client.post("/index/remove", json={"index": "texto", "ids": [3]}).json()["size"] == 2

    # vectors_b64: Float32 LE como en la tabla embeddings de D1.
    b64 = [base64.b64encode(x.astype("<f4").tobytes()).decode() for x in v]
    r = client.post("/index/rebuild", json={"index": "texto", "ids": [7, 8, 9], "vectors_b64": b64})
    assert r.json() == {"ok": True, "size": 3}

    health = client.get("/health").json()
    assert health["indices"]["texto"] == 3 and health["index_version"] == "abc"

    snap = client.get("/index/snapshot")
    assert snap.status_code == 200
    assert snap.headers["content-type"] == "application/octet-stream"
    client.post("/index/rebuild", json={"index": "texto", "ids": [], "vectors": []})
    assert client.get("/health").json()["indices"]["texto"] == 0
    r = client.post("/index/load", content=snap.content, headers={"content-type": "application/octet-stream"})
    assert r.status_code == 200
    assert r.json()["sizes"]["texto"] == 3


def test_index_route_errors(client):
    r = client.post("/index/add", json={"index": "texto", "ids": [1], "vectors": [[1.0, 2.0]]})
    assert r.status_code == 400
    assert r.json()["error"] == "index_error"
    r = client.post("/index/search", json={"index": "otro", "vector": [1.0], "k": 1})
    assert r.status_code == 422
    r = client.post("/index/load", content=b"no es zip")
    assert r.status_code == 400
