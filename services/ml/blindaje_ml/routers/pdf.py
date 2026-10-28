from __future__ import annotations

from fastapi import APIRouter, Response

from .. import pdf
from ..schemas import PdfRequest

router = APIRouter()


@router.post("/pdf/render")
def pdf_render(body: PdfRequest) -> Response:
    blob = pdf.render_pdf(body.template, body.data)
    return Response(
        blob,
        media_type="application/pdf",
        headers={"content-disposition": f'inline; filename="{body.template}.pdf"'},
    )
