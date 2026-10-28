from __future__ import annotations

import re

import pytest

from blindaje_ml import pdf

SHA = "a" * 64


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
                   "Cronología", "Transcripciones", "S/ 2,000", "03/10/2026 19:40", "EV-A1"):
        assert needle in html, needle
    # Autoescape: el texto de la transcripción no inyecta HTML.
    assert "<b>ya</b>" not in html and "&lt;b&gt;ya&lt;/b&gt;" in html


def test_expediente_html_draft_and_sections():
    html = pdf.render_html("expediente", EXPEDIENTE)
    for needle in ("Borrador para revisión", "Hechos", "Hipótesis", "Cadena de custodia", "VIN-21", "alta",
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
    assert len(re.findall(rb"/Type\s*/Page\b", r.content)) >= 1


@needs_weasy
def test_pdf_embeds_atkinson_when_fonts_present():
    from blindaje_ml.config import get_settings, reset_settings

    reset_settings()
    if not (get_settings().fonts_dir / "AtkinsonHyperlegible-Regular.ttf").exists():
        pytest.skip("fuentes no descargadas (scripts/download_models.py --fonts-only)")
    blob = pdf.render_pdf("denuncia", DENUNCIA)
    assert b"AtkinsonHyperlegible" in blob


def test_unknown_template_is_422(client):
    r = client.post("/pdf/render", json={"template": "otro", "data": {}})
    assert r.status_code == 422
