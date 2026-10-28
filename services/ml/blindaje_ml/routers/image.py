from __future__ import annotations

from fastapi import APIRouter, Request, Response

from .. import imaging
from ..schemas import ImageCropsRequest, RedactRequest, b64decode, b64encode
from .deps import ml

router = APIRouter()


def _vec(v) -> list[float]:
    return [round(float(x), 7) for x in v]


@router.post("/image/crops")
def image_crops(body: ImageCropsRequest, request: Request) -> dict:
    img = imaging.decode(b64decode(body.image_b64, "image_b64"))
    w, h = img.size
    crops = []
    for b in body.boxes:
        box = imaging.resolve_box(b.model_dump(), w, h)
        if box is None:
            continue
        crops.append((b.concept, box, img.crop((box.x1, box.y1, box.x2, box.y2))))
    embedder = ml(request).registry.get("image")
    vecs = embedder.embed([img] + [c[2] for c in crops])
    return {
        "model": embedder.name,
        "dim": embedder.dim,
        "width": w,
        "height": h,
        "full": {"phash": imaging.phash_hex(img), "vector": _vec(vecs[0])},
        "crops": [
            {
                "concept": concept,
                "box": box.as_dict(),
                "phash": imaging.phash_hex(crop),
                "vector": _vec(vec),
                "crop_jpeg_b64": b64encode(imaging.to_jpeg(crop)),
            }
            for (concept, box, crop), vec in zip(crops, vecs[1:], strict=True)
        ],
    }


@router.post("/image/redact")
def image_redact(body: RedactRequest) -> Response:
    img = imaging.decode(b64decode(body.image_b64, "image_b64"))
    w, h = img.size
    boxes = [b for r in body.regions if (b := imaging.resolve_box(r.model_dump(), w, h)) is not None]
    out = imaging.pixelate(img, boxes)
    return Response(imaging.to_jpeg(out, quality=90), media_type="image/jpeg",
                    headers={"x-regions": str(len(boxes))})
