"""Modelos de entrada (pydantic). Las salidas son dicts simples para no copiar vectores dos veces."""

from __future__ import annotations

import base64
import binascii
from typing import Any, Literal

import numpy as np
from pydantic import AliasChoices, BaseModel, Field, field_validator

MAX_TEXTS = 256
MAX_BOXES = 64
MAX_IDS = 200_000


def b64decode(value: str, what: str = "base64") -> bytes:
    """Base64 estándar o URL-safe; acepta data URLs (`data:...;base64,`)."""
    s = value.strip()
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    s = "".join(s.split())
    s += "=" * (-len(s) % 4)
    try:
        if "-" in s or "_" in s:
            return base64.urlsafe_b64decode(s)
        return base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ValueError(f"invalid_{what}") from e


def b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def vectors_from_b64(items: list[str]) -> list[np.ndarray]:
    """Vectores Float32 little-endian en base64 (el formato de la tabla `embeddings` de D1)."""
    return [np.frombuffer(b64decode(v, "vector_b64"), dtype="<f4") for v in items]


class TurnIn(BaseModel):
    speaker: str = Field(max_length=64)
    start_ms: int = Field(ge=0, validation_alias=AliasChoices("start_ms", "startMs"))
    end_ms: int = Field(ge=0, validation_alias=AliasChoices("end_ms", "endMs"))

    @field_validator("speaker", mode="before")
    @classmethod
    def _speaker_str(cls, v: Any) -> str:
        return str(v)


class VoiceEmbedRequest(BaseModel):
    wav_b64: str
    turns: list[TurnIn] | None = None
    exclude_vectors: list[list[float]] = Field(default_factory=list, max_length=32)
    exclude_threshold: float = Field(default=0.6, ge=-1.0, le=1.0)


class CompareRequest(BaseModel):
    a: list[float] = Field(min_length=1, max_length=4096)
    b: list[float] = Field(min_length=1, max_length=4096)


class TextEmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=MAX_TEXTS)
    kind: Literal["query", "passage"] = "passage"


class BoxIn(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    concept: str | None = Field(default=None, max_length=200)


class RegionIn(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class ImageCropsRequest(BaseModel):
    image_b64: str
    boxes: list[BoxIn] = Field(default_factory=list, max_length=MAX_BOXES)


class RedactRequest(BaseModel):
    image_b64: str
    regions: list[RegionIn] = Field(default_factory=list, max_length=MAX_BOXES)


IndexName = Literal["voz", "voz_segmento", "texto", "imagen"]


class IndexWriteRequest(BaseModel):
    index: IndexName
    ids: list[int] = Field(max_length=MAX_IDS)
    vectors: list[list[float]] | None = None
    vectors_b64: list[str] | None = Field(default=None, description="Alternativa: Float32 LE en base64")
    version: str | None = Field(default=None, max_length=128)

    def matrix(self) -> Any:
        if self.vectors_b64 is not None:
            return vectors_from_b64(self.vectors_b64) if self.vectors_b64 else []
        return self.vectors or []


class IndexRemoveRequest(BaseModel):
    index: IndexName
    ids: list[int] = Field(max_length=MAX_IDS)
    version: str | None = Field(default=None, max_length=128)


class IndexSearchRequest(BaseModel):
    index: IndexName
    vector: list[float] = Field(min_length=1, max_length=4096)
    k: int = Field(default=10, ge=1, le=1000)
    exclude_ids: list[int] | None = Field(default=None, max_length=10_000)


class NodeIn(BaseModel):
    id: str | int
    type: str | None = None


class EdgeIn(BaseModel):
    source: str | int
    target: str | int
    weight: float | None = Field(default=None, ge=0)


class GraphRequest(BaseModel):
    nodes: list[NodeIn] = Field(default_factory=list, max_length=50_000)
    edges: list[EdgeIn] = Field(default_factory=list, max_length=200_000)


class PdfRequest(BaseModel):
    template: Literal["denuncia", "expediente"]
    data: dict[str, Any] = Field(default_factory=dict)
