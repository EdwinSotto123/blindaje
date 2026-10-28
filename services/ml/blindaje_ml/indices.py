"""Índices FAISS en memoria: `IndexIDMap2(IndexFlatIP)` por nombre.

Los vectores llegan normalizados L2 (se re-normalizan por las dudas), así que producto interno
= coseno. D1 es la fuente de verdad; aquí solo vive la copia de búsqueda.
"""

from __future__ import annotations

import hashlib
import io
import json
import threading
import time
import zipfile

import faiss
import numpy as np

INDEX_DIMS: dict[str, int] = {"voz": 192, "voz_segmento": 192, "texto": 384, "imagen": 384}
SNAPSHOT_FORMAT = "blindaje-faiss-snapshot/1"
MAX_SNAPSHOT_ENTRY = 2 * 1024**3


class IndexError_(ValueError):
    """Error de validación de índices (nombre, dimensión, ids)."""


def _new_index(dim: int) -> faiss.IndexIDMap2:
    return faiss.IndexIDMap2(faiss.IndexFlatIP(dim))


def _as_matrix(vectors: list[list[float]] | np.ndarray, dim: int) -> np.ndarray:
    arr = np.asarray(vectors, dtype=np.float32)
    if arr.size == 0:
        return np.zeros((0, dim), dtype=np.float32)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    if arr.ndim != 2 or arr.shape[1] != dim:
        raise IndexError_(f"dim_mismatch: se esperaba {dim}")
    if not np.all(np.isfinite(arr)):
        raise IndexError_("non_finite_vector")
    arr = np.ascontiguousarray(arr)
    faiss.normalize_L2(arr)
    return arr


def _as_ids(ids: list[int]) -> np.ndarray:
    arr = np.asarray(ids, dtype=np.int64).reshape(-1)
    if arr.size and arr.min() < 0:
        raise IndexError_("negative_id")
    if np.unique(arr).size != arr.size:
        raise IndexError_("duplicate_ids")
    return arr


class IndexStore:
    def __init__(self, dims: dict[str, int] | None = None):
        self.dims = dict(dims or INDEX_DIMS)
        self._lock = threading.RLock()
        self._indices = {name: _new_index(dim) for name, dim in self.dims.items()}
        self.version: str | None = None
        self.updated_at: str | None = None

    def _get(self, name: str) -> faiss.IndexIDMap2:
        try:
            return self._indices[name]
        except KeyError:
            raise IndexError_(f"unknown_index: {name}") from None

    def _touch(self, version: str | None) -> None:
        if version is not None:
            self.version = version
        self.updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def sizes(self) -> dict[str, int]:
        with self._lock:
            return {name: int(idx.ntotal) for name, idx in self._indices.items()}

    def add(self, name: str, ids: list[int], vectors, version: str | None = None) -> int:
        """Inserta o reemplaza (upsert): si un id ya existe, se borra antes."""
        with self._lock:
            idx = self._get(name)
            id_arr = _as_ids(ids)
            mat = _as_matrix(vectors, self.dims[name])
            if mat.shape[0] != id_arr.size:
                raise IndexError_("ids_vectors_length_mismatch")
            if id_arr.size:
                idx.remove_ids(faiss.IDSelectorBatch(id_arr))
                idx.add_with_ids(mat, id_arr)
            self._touch(version)
            return int(idx.ntotal)

    def remove(self, name: str, ids: list[int], version: str | None = None) -> int:
        with self._lock:
            idx = self._get(name)
            id_arr = np.asarray(ids, dtype=np.int64).reshape(-1)
            if id_arr.size:
                idx.remove_ids(faiss.IDSelectorBatch(id_arr))
            self._touch(version)
            return int(idx.ntotal)

    def rebuild(self, name: str, ids: list[int], vectors, version: str | None = None) -> int:
        with self._lock:
            self._get(name)
            fresh = _new_index(self.dims[name])
            id_arr = _as_ids(ids)
            mat = _as_matrix(vectors, self.dims[name])
            if mat.shape[0] != id_arr.size:
                raise IndexError_("ids_vectors_length_mismatch")
            if id_arr.size:
                fresh.add_with_ids(mat, id_arr)
            self._indices[name] = fresh
            self._touch(version)
            return int(fresh.ntotal)

    def search(
        self, name: str, vector, k: int, exclude_ids: list[int] | None = None
    ) -> list[tuple[int, float]]:
        with self._lock:
            idx = self._get(name)
            q = _as_matrix(vector, self.dims[name])
            if q.shape[0] != 1:
                raise IndexError_("single_vector_expected")
            excl = set(int(i) for i in (exclude_ids or []))
            n = int(idx.ntotal)
            if n == 0 or k <= 0:
                return []
            fetch = min(n, k + len(excl))
            scores, ids = idx.search(q, fetch)
        out = [
            (int(i), float(s)) for i, s in zip(ids[0], scores[0], strict=True) if i >= 0 and int(i) not in excl
        ]
        return out[:k]

    def vectors(self, name: str) -> tuple[np.ndarray, np.ndarray]:
        """(ids, matriz) de un índice. Útil para tests y diagnósticos."""
        with self._lock:
            idx = self._get(name)
            n = int(idx.ntotal)
            ids = faiss.vector_to_array(idx.id_map).astype(np.int64)
            mat = idx.index.reconstruct_n(0, n) if n else np.zeros((0, self.dims[name]), np.float32)
            return ids, mat

    # --- Snapshots -------------------------------------------------------------------------

    def snapshot(self, extra_files: dict[str, bytes] | None = None) -> bytes:
        with self._lock:
            blobs = {
                name: faiss.serialize_index(idx).tobytes() for name, idx in self._indices.items()
            }
            manifest = {
                "format": SNAPSHOT_FORMAT,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "index_version": self.version,
                "faiss_version": faiss.__version__,
                "indices": {
                    name: {
                        "file": f"{name}.faiss",
                        "dim": self.dims[name],
                        "size": int(self._indices[name].ntotal),
                        "type": "IndexIDMap2(IndexFlatIP)",
                        "sha256": hashlib.sha256(blob).hexdigest(),
                    }
                    for name, blob in blobs.items()
                },
                "extra": {},
            }
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            for name, blob in blobs.items():
                zf.writestr(f"{name}.faiss", blob)
            for fname, data in (extra_files or {}).items():
                zf.writestr(fname, data)
                manifest["extra"][fname] = {"sha256": hashlib.sha256(data).hexdigest()}
            zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        return buf.getvalue()

    def load(self, data: bytes) -> tuple[dict[str, int], dict[str, bytes]]:
        """Carga un snapshot completo (todo o nada). Devuelve (tamaños, archivos extra)."""
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as e:
            raise IndexError_("bad_zip") from e
        with zf:
            try:
                manifest = json.loads(zf.read("manifest.json"))
            except (KeyError, json.JSONDecodeError) as e:
                raise IndexError_("bad_manifest") from e
            if manifest.get("format") != SNAPSHOT_FORMAT:
                raise IndexError_("unknown_snapshot_format")
            loaded: dict[str, faiss.IndexIDMap2] = {}
            for name, meta in manifest.get("indices", {}).items():
                if name not in self.dims:
                    raise IndexError_(f"unknown_index: {name}")
                info = zf.getinfo(meta["file"])
                if info.file_size > MAX_SNAPSHOT_ENTRY:
                    raise IndexError_("snapshot_entry_too_large")
                blob = zf.read(meta["file"])
                if hashlib.sha256(blob).hexdigest() != meta.get("sha256"):
                    raise IndexError_(f"checksum_mismatch: {name}")
                idx = faiss.deserialize_index(np.frombuffer(blob, dtype=np.uint8))
                if not isinstance(idx, faiss.IndexIDMap2) or idx.d != self.dims[name]:
                    raise IndexError_(f"bad_index_type: {name}")
                loaded[name] = idx
            extras: dict[str, bytes] = {}
            for fname, meta in (manifest.get("extra") or {}).items():
                blob = zf.read(fname)
                if hashlib.sha256(blob).hexdigest() != meta.get("sha256"):
                    raise IndexError_(f"checksum_mismatch: {fname}")
                extras[fname] = blob
        with self._lock:
            for name in self.dims:
                self._indices[name] = loaded.get(name, _new_index(self.dims[name]))
            self.version = manifest.get("index_version")
            self._touch(None)
        return self.sizes(), extras
