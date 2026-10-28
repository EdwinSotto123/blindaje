from __future__ import annotations

import re
import zlib

import pytest

from blindaje_ml import pdf

SHA = "a" * 64


def _pdf_chunks(blob: bytes) -> list[bytes]:
    """El PDF y sus streams descomprimidos (WeasyPrint usa object streams comprimidos)."""
    chunks = [blob]
    for m in re.finditer(rb"stream\r?\n", blob):
        end = blob.find(b"endstream", m.end())
        try:
            chunks.append(zlib.decompress(blob[m.end() : end]))
        except zlib.error:
            continue
    return chunks


def _pdf_font_names(blob: bytes) -> set[str]:
    return {n.decode() for c in _pdf_chunks(blob) for n in re.findall(rb"/BaseFont\s*/([A-Za-z0-9+_-]+)", c)}


def _pdf_pages(blob: bytes) -> int:
    return sum(len(re.findall(rb"/Type\s*/Page\b", c)) for c in _pdf_chunks(blob))


def _weasy_ok() -> bool:
    try:
        import weasyprint  # noqa: F401
    except OSError:
        return False
    return True


needs_weasy = pytest.mark.skipif(not _weasy_ok(), reason="WeasyPrint sin pango (en CI: apt install libpango)")

DENUNCIA = {
    "demo": True,
    "caso": "A",
    "resumen": "Recibí audios exigiendo 2000 soles por Yape con plazo de 48 horas.",
    "ficha": {
        "sector": "bodega",
        "zona": "Lima Este - E12",
        "primer_contacto": "2026-10-03T19:40:00-05:00",
        "amenaza": "daño al local",
        "monto_soles": 2000,
        "plazo": "48 horas",
        "canal_pago": "yape",
        "grupo_que_dice_ser": "Los X",
        "frases_firma": ["habla con el jefe", "no llames a la policía"],
        "identificadores": [{"tipo": "telefono", "valor": "+51 900 000 488", "rol": "contacto",
                             "evidencia": ["EV-A1"]}],
        "escalamiento": [{"fecha": "2026-10-06", "tipo": "foto del local con bala", "evidencia": ["EV-A3"]}],
    },
    "cronologia": [{"fecha": "2026-10-03T19:40:00-05:00", "texto": "Primer audio", "evidencia": ["EV-A1"]}],
    "evidencia": [{"label": "EV-A1", "tipo": "audio", "size_bytes": 48213, "sha256": SHA,
                   "received_utc": "2026-10-04T00:41:00Z"}],
    "transcripciones": [{"evidencia": "EV-A1", "turnos": [
        {"speaker": "B", "start_ms": 1500, "end_ms": 4000, "texto": "Habla con el jefe <b>ya</b>."}]}],
}

EXPEDIENTE = {
    "demo": True,
    "aprobado": False,
    "red": "R-014",
    "resumen": "Siete casos conectados por una misma huella de voz.",
    "perfil": {"casos": 7, "periodo": "2026-09-02 a 2026-10-20", "sectores": [{"sector": "bodega", "casos": 4}],
               "territorio": [{"zona": "Lima Este - E12", "casos": 5}], "modus_operandi": "Audio y Yape"},
    "cronologia": [{"fecha": "2026-09-02", "texto": "Caso A", "evidencia": ["EV-A1"]}],
    "vinculos": [{"vinculo": "VIN-21", "texto": "Misma voz en A y B", "evidencia": ["V-3", "EV-A1"],
                  "puntaje": 0.91, "casos": ["A", "B"]}],
    "hechos": [{"texto": "La huella V-3 aparece en 6 de 7 casos", "evidencia": ["V-3", "VIN-21"]}],
    "hipotesis": [{"texto": "V-3 corresponde a quien hace las llamadas", "confianza": "alta",
                   "evidencia": ["V-3"]}],
    "brechas": ["Faltan los audios originales del caso R-014-5"],
    "evidencia": [{"label": "EV-A1", "caso": "A", "tipo": "audio", "sha256": SHA,
                   "received_utc": "2026-10-04T00:41:00Z"}],
    "custodia": [{"seq": 1, "ts": "2026-10-04T00:41:00Z", "actor_type": "victim", "action": "evidence.upload",
                  "target_id": "EV-A1", "prev_hash": "0" * 64, "hash": "b" * 64}],
}


def test_denuncia_html_has_required_content():
    html = pdf.render_html("denuncia", DENUNCIA)
    for needle in ("Línea 1818", "Si estás en peligro ahora, llama al 105", SHA, "Datos ficticios",
                   "Cronología", "Transcripciones", "S/ 2,000", "03/10/2026 19:40", "EV-A1", "Teléfono",
                   "Yape"):
        assert needle in html, needle
    # Autoescape: el texto de la transcripción no inyecta HTML.
    assert "<b>ya</b>" not in html and "&lt;b&gt;ya&lt;/b&gt;" in html


def test_expediente_html_draft_and_sections():
    html = pdf.render_html("expediente", EXPEDIENTE)
    for needle in ("Borrador para revisión", "Hechos", "Hipótesis", "Cadena de custodia", "VIN-21", "Alta",
                   "b" * 64, "0" * 64, SHA, "Datos ficticios", "0.91"):
        assert needle in html, needle


def test_expediente_approved_has_no_draft_banner():
    html = pdf.render_html("expediente", {**EXPEDIENTE, "aprobado": True, "demo": False,
                                          "aprobado_por": "Analista 1"})
    assert "Borrador para revisión" not in html
    assert "Datos ficticios" not in html
    assert "Analista 1" in html


def test_missing_fields_do_not_break():
    assert "Denuncia por extorsión" in pdf.render_html("denuncia", {})
    assert "Expediente de red" in pdf.render_html("expediente", {})


def test_margin_box_text_is_sanitized():
    html = pdf.render_html("expediente", {"red": 'R-1"; } body { color: red'})
    assert 'R-1"; }' not in html.split("<body>")[0]


@needs_weasy
@pytest.mark.parametrize("template,data", [("denuncia", DENUNCIA), ("expediente", EXPEDIENTE)])
def test_pdf_render_route(client, template, data):
    r = client.post("/pdf/render", json={"template": template, "data": data})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF-")
    assert _pdf_pages(r.content) >= 1
    assert any("Atkinson" in f for f in _pdf_font_names(r.content)) or not pdf.font_faces()


@needs_weasy
def test_pdf_embeds_atkinson_when_fonts_present():
    from blindaje_ml.config import get_settings, reset_settings

    reset_settings()
    if not (get_settings().fonts_dir / "AtkinsonHyperlegible-Regular.ttf").exists():
        pytest.skip("fuentes no descargadas (scripts/download_models.py --fonts-only)")
    blob = pdf.render_pdf("denuncia", DENUNCIA)
    fonts = _pdf_font_names(blob)
    # Subconjuntos embebidos (prefijo de 6 letras + nombre); sin fuentes de respaldo.
    assert any(f.endswith("+Atkinson-Hyperlegible") for f in fonts), fonts
    assert all("Atkinson" in f for f in fonts), fonts


def test_unknown_template_is_422(client):
    r = client.post("/pdf/render", json={"template": "otro", "data": {}})
    assert r.status_code == 422


# Forma que arma services/api (routes/victim.ts): VictimReport + seudonimo, generado_utc,
# lineas y datos_ficticios.
VICTIM_REPORT = {
    "case_id": "c_123",
    "code": "K7Q2",
    "status": "listo",
    "consent_mode": "solo_denuncia",
    "hallazgos": ["Encontramos 2 números de contacto", "Un audio pide pago por Yape"],
    "ficha": {"sector": "bodega", "zona": "Lima Este", "primer_contacto": None, "amenaza": "Dañar el local",
              "monto_soles": 500, "plazo": "24 horas", "canal_pago": "yape", "grupo_que_dice_ser": None,
              "frases_firma": [], "identificadores": [{"tipo": "telefono", "valor": "+51 911 111 222"}],
              "resumen": "Exigen 500 soles por Yape en 24 horas."},
    "cronologia": [],
    "evidencia": [{"id": "e1", "label": "EV-K7Q2-1", "tipo": "audio", "mime": "audio/ogg", "size_bytes": 1000,
                   "sha256": SHA, "received_utc": "2026-10-28T12:00:00Z", "captured_at": None, "duration_ms": 9000,
                   "status": "procesado", "nota": "Voz de la víctima excluida de la huella",
                   "transcripcion": [
                       {"speaker": "A", "start_ms": 0, "end_ms": 3000, "text": "Aló, ¿quién habla?",
                        "es_victima": True},
                       {"speaker": "B", "start_ms": 3000, "end_ms": 9000, "text": "Paga hoy o ya sabes.",
                        "es_victima": False}]}],
    "updated_at": "2026-10-28T12:00:00Z",
    "seudonimo": "Bodega 14",
    "generado_utc": "2026-10-28T12:05:00Z",
    "lineas": {"denuncias": "1818", "emergencias": "105"},
    "datos_ficticios": True,
}


def test_denuncia_accepts_victim_report_shape():
    html = pdf.render_html("denuncia", VICTIM_REPORT)
    for needle in ("Caso K7Q2", "Exigen 500 soles por Yape en 24 horas.", "Encontramos 2 números de contacto",
                   "Denunciante:", "Voz B:", "Paga hoy o ya sabes.", "Datos ficticios", "Línea 1818",
                   "Si estás en peligro ahora, llama al 105", "Voz de la víctima excluida", "28/10/2026 07:05"):
        assert needle in html, needle
