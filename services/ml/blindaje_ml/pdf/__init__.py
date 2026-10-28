"""PDF de la denuncia y del expediente (WeasyPrint + Jinja2, sistema visual Cuaderno)."""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

from jinja2 import ChainableUndefined, Environment, FileSystemLoader, Undefined, select_autoescape

from ..config import get_settings

TEMPLATES = ("denuncia", "expediente")
_TEMPLATES_DIR = Path(__file__).parent / "templates"
_LIMA = dt.timezone(dt.timedelta(hours=-5), "Lima")  # Perú no usa horario de verano
FONT_FILES = {
    ("normal", 400): "AtkinsonHyperlegible-Regular.ttf",
    ("normal", 700): "AtkinsonHyperlegible-Bold.ttf",
    ("italic", 400): "AtkinsonHyperlegible-Italic.ttf",
    ("italic", 700): "AtkinsonHyperlegible-BoldItalic.ttf",
}


class PdfUnavailable(RuntimeError):
    """WeasyPrint no pudo cargar sus librerías nativas (pango)."""


def _fecha(value: Any, with_time: bool = True) -> str:
    """ISO 8601 a dd/mm/aaaa HH:MM en hora de Lima. Si no se puede leer, se muestra tal cual."""
    if value in (None, ""):
        return ""
    s = str(value)
    try:
        if len(s) == 10:
            return dt.date.fromisoformat(s).strftime("%d/%m/%Y")
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return s
    if d.tzinfo is not None:
        d = d.astimezone(_LIMA)
    return d.strftime("%d/%m/%Y %H:%M") if with_time else d.strftime("%d/%m/%Y")


def _mmss(ms: Any) -> str:
    try:
        total = int(ms) // 1000
    except (TypeError, ValueError):
        return ""
    return f"{total // 60}:{total % 60:02d}"


def _tamano(n: Any) -> str:
    try:
        size = float(n)
    except (TypeError, ValueError):
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return ""


def _soles(n: Any) -> str:
    try:
        return "S/ " + f"{float(n):,.2f}".removesuffix(".00")
    except (TypeError, ValueError):
        return str(n or "")


def _lista(value: Any) -> list:
    if value is None or isinstance(value, Undefined):
        return []
    return value if isinstance(value, list) else [value]


def _css(value: Any) -> str:
    """Texto seguro dentro de un string CSS (`content: "..."`) de las cajas de margen."""
    if value is None or isinstance(value, Undefined):
        return ""
    return "".join(ch for ch in str(value) if ch.isalnum() or ch in " -_.·:/")[:60]


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(_TEMPLATES_DIR),
        autoescape=select_autoescape(["html"]),
        undefined=ChainableUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters.update(fecha=_fecha, mmss=_mmss, tamano=_tamano, soles=_soles, lista=_lista, css=_css)
    return env


def font_faces() -> list[dict[str, Any]]:
    fonts_dir = get_settings().fonts_dir
    faces = []
    for (style, weight), fname in FONT_FILES.items():
        path = fonts_dir / fname
        if path.exists():
            faces.append({"style": style, "weight": weight, "url": path.resolve().as_uri()})
    return faces


def render_html(template: str, data: dict[str, Any]) -> str:
    if template not in TEMPLATES:
        raise ValueError("unknown_template")
    now = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    return _env().get_template(f"{template}.html").render(
        d=data, demo=bool(data.get("demo")), fonts=font_faces(), generado=data.get("generado_utc") or now
    )


def render_pdf(template: str, data: dict[str, Any]) -> bytes:
    html = render_html(template, data)
    try:
        from weasyprint import HTML
    except OSError as e:  # faltan pango/gobject
        raise PdfUnavailable("weasyprint_native_libs_missing") from e
    return HTML(string=html, base_url=str(_TEMPLATES_DIR)).write_pdf()


def weasyprint_version() -> str | None:
    try:
        from importlib.metadata import version

        return version("weasyprint")
    except Exception:
        return None
