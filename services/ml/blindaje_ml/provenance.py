"""Procedencia del archivo sin modelos: credenciales C2PA, metadatos EXIF, XMP e IPTC, y etiquetas
del contenedor de audio y video (ffprobe).

Todo es INDICIO. Una credencial C2PA o un `DigitalSourceType` de IA declaran cómo se hizo el
archivo; su ausencia no prueba nada (WhatsApp y la mayoría de las apps borran los metadatos).

Privacidad: nunca se devuelven coordenadas GPS, ubicación, autor, copyright ni números de serie;
solo se dice que existen. Nada de esto se registra en los logs.
"""

from __future__ import annotations

import contextlib
import io
import json
import re
from typing import Any

from .logs import log

MAX_FIELDS = 40
MAX_VALUE = 160

AI_SOURCE_TYPES = {"trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia"}
SYNTHETIC_SOURCE_TYPES = {"algorithmicMedia", "compositeSynthetic", "digitalCreation", "digitalArt",
                          "virtualRecording", "dataDrivenMedia"}
_DST_RE = re.compile(r"digitalsourcetype/([A-Za-z]+)")

# Generadores de IA conocidos (imagen, video, voz y música). Se buscan en software, codificador,
# comentarios y descripciones. Palabras ambiguas en español ("imagen", "veo") van acotadas.
_AI_TOOLS = re.compile(
    r"\b(midjourney|dall[\s·.\-]?e|stable[\s\-]?diffusion|sdxl|comfyui|automatic1111|invokeai|fooocus|"
    r"novelai|adobe firefly|firefly|google imagen|imagen\s?[234]|gemini|nano[\s\-]?banana|chatgpt|openai|"
    r"sora|runway(?:ml)?|pika(?:\s?labs)?|kling|hailuo|minimax|luma(?:\s?ai)?|dream machine|flux(?:\.\d)?|"
    r"black forest labs|leonardo(?:\.ai)?|ideogram|grok|meta ai|imagine with meta|muse image|muse spark|"
    r"movie gen|emu video|google veo|veo\s?[23]|elevenlabs|eleven\s?labs|suno|udio|bark|tortoise[\s\-]?tts|"
    r"coqui|xtts|so[\s\-]?vits|rvc|play\.?ht|murf(?:\.ai)?|resemble(?:\.ai)?|speechify|heygen|synthesia|"
    r"d-id|deepfacelab|faceswap|facefusion|roop|reface|deepswap|vall[\s\-]?e|voicebox|audiocraft|musicgen|"
    r"mms[\s\-]?tts|text[\s\-]?to[\s\-]?speech|tts)\b",
    re.IGNORECASE,
)
_EDITORS = re.compile(
    r"\b(adobe photoshop|photoshop|lightroom|gimp|snapseed|picsart|facetune|faceapp|remini|canva|capcut|"
    r"inshot|kinemaster|premiere|after effects|davinci resolve|final cut|imovie|audacity|adobe audition|"
    r"pixelmator|affinity photo|photopea|vn video editor)\b",
    re.IGNORECASE,
)
_FFMPEG = re.compile(r"\b(Lav[cf]\d+(?:\.\d+)*)\b")
_GEN_PARAMS = re.compile(r"(Steps:\s*\d+.*Sampler:|\"sampler_name\"|\"cfg_scale\"|negative[_ ]prompt)", re.I | re.S)
_AIGC = re.compile(r"\bAIGC\b")

# Campos que nunca se devuelven con su valor (solo "presente").
_PRIVATE = re.compile(
    r"(gps|location|ubicaci|iso6709|artist|author|creator(?!tool)|copyright|by-?line|owner|serial|"
    r"uniqueid|unique_id|e-?mail|phone|contact)",
    re.IGNORECASE,
)


def _clip(v: Any) -> str:
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", str(v)).strip()
    return s if len(s) <= MAX_VALUE else s[: MAX_VALUE - 1] + "…"


# --- formato ----------------------------------------------------------------------------------


def sniff(data: bytes) -> tuple[str, str | None]:
    """(tipo, mime para C2PA) a partir de los primeros bytes. mime None: C2PA no se puede incrustar."""
    h = data[:16]
    if h[:3] == b"\xff\xd8\xff":
        return "jpeg", "image/jpeg"
    if h[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", "image/png"
    if h[:4] == b"RIFF" and h[8:12] == b"WEBP":
        return "webp", "image/webp"
    if h[:4] == b"RIFF" and h[8:12] == b"WAVE":
        return "wav", "audio/wav"
    if h[:4] == b"RIFF" and h[8:12] == b"AVI ":
        return "avi", "video/avi"
    if h[:6] in (b"GIF87a", b"GIF89a"):
        return "gif", "image/gif"
    if h[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff", "image/tiff"
    if h[4:8] == b"ftyp":
        brand = h[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"):
            return "heic", "image/heic"
        if brand in (b"avif", b"avis"):
            return "avif", "image/avif"
        if brand in (b"M4A ", b"M4B "):
            return "m4a", "audio/mp4"
        if brand == b"qt  ":
            return "mov", "video/quicktime"
        return "mp4", "video/mp4"
    if h[:4] == b"OggS":
        return "ogg", None
    if h[:4] == b"fLaC":
        return "flac", "audio/flac"
    if h[:3] == b"ID3" or (len(h) > 1 and h[0] == 0xFF and (h[1] & 0xE0) == 0xE0 and (h[1] >> 1) & 0x3 == 1):
        return "mp3", "audio/mpeg"
    if h[:4] == b"\x1aE\xdf\xa3":
        return "webm", None
    if h[:5] == b"#!AMR":
        return "amr", None
    return "desconocido", None


# --- C2PA -------------------------------------------------------------------------------------

_C2PA_CONTEXT: Any = None


def _c2pa_context(c2pa: Any) -> Any:
    """Sin red: no se buscan manifiestos remotos ni OCSP (la URL vendría del archivo, que no es de fiar)."""
    global _C2PA_CONTEXT
    if _C2PA_CONTEXT is None:
        try:
            settings = c2pa.Settings.from_dict({"verify": {"remote_manifest_fetch": False, "ocsp_fetch": False}})
            _C2PA_CONTEXT = c2pa.Context(settings)
        except Exception:  # versión sin estas opciones: se lee con la configuración por defecto
            _C2PA_CONTEXT = False
    return _C2PA_CONTEXT or None


def _short_dst(uri: str | None) -> str | None:
    if not uri:
        return None
    m = _DST_RE.search(uri)
    return m.group(1) if m else _clip(uri.rsplit("/", 1)[-1])


def _agent_name(agent: Any) -> str | None:
    if isinstance(agent, str):
        return agent
    if isinstance(agent, dict):
        name = agent.get("name")
        return f"{name} {agent.get('version', '')}".strip() if name else None
    return None


def _generator(m: dict) -> str | None:
    for info in m.get("claim_generator_info") or []:
        if isinstance(info, dict) and info.get("name"):
            return _clip(f"{info['name']} {info.get('version', '')}".strip())
    return _clip(m["claim_generator"]) if m.get("claim_generator") else None


def summarize_c2pa(store: dict, state: str | None = None) -> dict[str, Any]:
    """Resume el almacén de manifiestos (JSON de c2pa) en la forma de `SenalesTecnicas.c2pa`."""
    manifests = store.get("manifests") or {}
    active_id = store.get("active_manifest")
    active = manifests.get(active_id) or (next(iter(manifests.values())) if manifests else {})
    claims: list[str] = []
    sources: list[str] = []
    agents: list[str] = []
    # Todas las acciones de todos los manifiestos (el activo y sus ingredientes): una foto editada
    # puede venir de un ingrediente generado con IA.
    ordered = [active] + [m for k, m in manifests.items() if k != active_id]
    for m in ordered:
        for a in m.get("assertions") or []:
            if not str(a.get("label", "")).startswith("c2pa.actions"):
                continue
            for act in (a.get("data") or {}).get("actions") or []:
                dst = _short_dst(act.get("digitalSourceType"))
                agent = _agent_name(act.get("softwareAgent"))
                if dst:
                    sources.append(dst)
                if agent:
                    agents.append(_clip(agent))
                label = str(act.get("action", "accion"))
                claims.append(f"{label}" + (f" ({dst})" if dst else "") + (f" con {agent}" if agent else ""))
    generator = _generator(active) if active else None
    if not generator and agents:
        generator = agents[0]
    sig = (active or {}).get("signature_info") or {}
    if sig.get("issuer") or sig.get("common_name"):
        claims.append("firmado por " + _clip(" / ".join(x for x in (sig.get("issuer"), sig.get("common_name")) if x)))
    if generator:
        claims.append(f"generador: {generator}")
    if state:
        claims.append(f"validación: {state}")
    failures = [s.get("code") for s in store.get("validation_status") or [] if s.get("code")]
    if failures:
        claims.append("avisos de validación: " + ", ".join(sorted(set(failures))[:4]))
    if any(s in AI_SOURCE_TYPES for s in sources):
        ai: bool | None = True
    elif sources:
        ai = False
    elif agents and any(_AI_TOOLS.search(a) for a in agents):
        ai = True
    else:
        ai = None
    seen: set[str] = set()
    uniq = [c for c in claims if not (c in seen or seen.add(c))]
    return {"present": True, "ai_generated": ai, "generator": generator, "claims": uniq[:12]}


def read_c2pa(data: bytes, mime: str | None) -> dict[str, Any] | None:
    """`SenalesTecnicas.c2pa`. None si la librería no está instalada."""
    try:
        import c2pa
    except ImportError:
        return None
    if mime is None:
        return {"present": False, "ai_generated": None, "generator": None,
                "claims": ["formato sin soporte para credenciales C2PA incrustadas"]}
    try:
        ctx = _c2pa_context(c2pa)
        kwargs = {"context": ctx} if ctx is not None else {}
        reader = c2pa.Reader.try_create(mime, io.BytesIO(data), **kwargs)
        if reader is None:
            return {"present": False, "ai_generated": None, "generator": None, "claims": []}
        try:
            store = json.loads(reader.json())
            try:
                state = reader.get_validation_state()
            except Exception:
                state = None
        finally:
            with contextlib.suppress(Exception):
                reader.close()
        return summarize_c2pa(store, state)
    except Exception as e:  # manifiesto dañado o formato que la librería no entiende
        log("c2pa_read_failed", error=type(e).__name__)
        has_jumbf = b"c2pa" in data or b"jumb" in data
        return {"present": has_jumbf, "ai_generated": None, "generator": None,
                "claims": ["manifiesto C2PA presente pero ilegible o dañado"] if has_jumbf else []}


# --- metadatos ----------------------------------------------------------------------------------


class _Meta:
    """Acumula campos, software y señales sospechosas sin exponer datos personales."""

    def __init__(self) -> None:
        self.fields: dict[str, str] = {}
        self.software: str | None = None
        self.dst: str | None = None
        self.suspicious: list[str] = []
        self.texts: list[str] = []  # valores donde buscar nombres de generadores
        self.present = False

    def add(self, key: str, value: Any, *, scan: bool = True) -> None:
        if value is None or value == "" or value == b"":
            return
        self.present = True
        if _PRIVATE.search(key):
            if len(self.fields) < MAX_FIELDS:
                self.fields.setdefault(key, "presente")
            return
        v = _clip(value)
        if not v:
            return
        if scan:
            self.texts.append(v)
        if len(self.fields) < MAX_FIELDS and key not in self.fields:
            self.fields[key] = v

    def flag(self, text: str) -> None:
        if text not in self.suspicious:
            self.suspicious.append(text)

    def set_software(self, value: Any) -> None:
        if value and not self.software:
            self.software = _clip(value)

    def finish(self) -> dict[str, Any]:
        for t in self.texts:
            if m := _AI_TOOLS.search(t):
                self.flag(f"los metadatos nombran una herramienta de IA: {m.group(0)}")
            if m := _EDITORS.search(t):
                self.flag(f"editado o exportado con {m.group(0)}")
            if m := _FFMPEG.search(t):
                self.flag(f"codificado con ffmpeg ({m.group(1)}): el archivo pasó por un programa de conversión")
            if _GEN_PARAMS.search(t):
                self.flag("los metadatos traen parámetros de generación de imagen (prompt, sampler o pasos)")
            if _AIGC.search(t):
                self.flag("etiqueta AIGC de contenido generado por IA en los metadatos")
        if self.dst in AI_SOURCE_TYPES:
            what = "generado con IA" if self.dst == "trainedAlgorithmicMedia" else "con partes generadas con IA"
            self.suspicious.insert(0, f"IPTC DigitalSourceType = {self.dst}: el archivo declara ser {what}")
        elif self.dst in SYNTHETIC_SOURCE_TYPES:
            self.suspicious.insert(
                0, f"IPTC DigitalSourceType = {self.dst}: declara contenido sintético o creado digitalmente"
            )
        return {
            "present": self.present,
            "software": self.software,
            "digital_source_type": self.dst,
            "suspicious": self.suspicious[:10],
            "fields": self.fields,
        }


_XMP_PACKET = re.compile(rb"<x:xmpmeta[\s\S]{0,524288}?</x:xmpmeta>")
_XMP_PROPS = ("CreatorTool", "Software", "Credit", "Source", "Make", "Model", "DateTimeOriginal", "CreateDate",
              "ModifyDate", "History", "Description", "description", "Label", "ContentProducer")


def _xmp_value(xmp: str, prop: str) -> str | None:
    m = re.search(rf"\b\w+:{prop}\s*=\s*\"([^\"]*)\"", xmp)
    if m:
        return m.group(1)
    m = re.search(rf"<\w+:{prop}\b[^>]*>([\s\S]*?)</\w+:{prop}>", xmp)
    if not m:
        return None
    inner = m.group(1)
    items = re.findall(r"<rdf:li\b[^>]*>([\s\S]*?)</rdf:li>", inner)
    text = " | ".join(i.strip() for i in items) if items else inner
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip() or None


def _scan_xmp(data: bytes, meta: _Meta) -> None:
    packets = _XMP_PACKET.findall(data)[:3]
    for raw in packets:
        xmp = raw.decode("utf-8", "replace")
        meta.present = True
        if (m := _DST_RE.search(xmp)) and not meta.dst:
            meta.dst = m.group(1)
            meta.add("xmp.DigitalSourceType", m.group(1), scan=False)
        for prop in _XMP_PROPS:
            v = _xmp_value(xmp, prop)
            if v:
                meta.add(f"xmp.{prop}", v)
                if prop in ("CreatorTool", "Software"):
                    meta.set_software(v)
        if _AIGC.search(xmp):
            meta.texts.append("AIGC")
        if re.search(r"\bexif:GPS|\bGPSLatitude", xmp):
            meta.add("xmp.gps", "presente", scan=False)


_EXIF_BASE = {271: "Make", 272: "Model", 305: "Software", 306: "DateTime", 270: "ImageDescription",
              315: "Artist", 33432: "Copyright", 42016: "ImageUniqueID", 11: "ProcessingSoftware"}
_EXIF_IFD = {36867: "DateTimeOriginal", 36868: "DateTimeDigitized", 37510: "UserComment", 42035: "LensMake",
             42036: "LensModel", 42033: "BodySerialNumber", 36880: "OffsetTime", 37500: "MakerNote"}
_IPTC = {(2, 65): "OriginatingProgram", (2, 70): "ProgramVersion", (2, 110): "Credit", (2, 115): "Source",
         (2, 120): "Caption", (2, 80): "By-line", (2, 116): "CopyrightNotice"}
_PNG_GEN_KEYS = {"parameters", "prompt", "workflow", "invokeai_metadata", "sd-metadata", "dream",
                 "generation_data", "aigc"}


def image_metadata(data: bytes, kind: str) -> dict[str, Any]:
    """`SenalesTecnicas.metadata` de una imagen."""
    from PIL import Image, IptcImagePlugin, UnidentifiedImageError

    meta = _Meta()
    meta.fields["formato"] = kind
    try:
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        img = None
    if img is not None:
        meta.fields["dimensiones"] = f"{img.width}x{img.height}"
        try:
            exif = img.getexif()
        except Exception:
            exif = None
        if exif:
            for tag, name in _EXIF_BASE.items():
                if tag in exif:
                    meta.add(f"exif.{name}", exif.get(tag))
            if 0x8825 in exif:
                meta.add("exif.GPS", "presente", scan=False)
            try:
                sub = exif.get_ifd(0x8769)
            except Exception:
                sub = {}
            for tag, name in _EXIF_IFD.items():
                if tag in sub and name != "MakerNote":
                    meta.add(f"exif.{name}", sub.get(tag))
            meta.set_software(exif.get(305))
            dt, dto = exif.get(306), sub.get(36867) if sub else None
            if dt and dto and str(dt).strip() != str(dto).strip():
                meta.flag("EXIF: la fecha de modificación difiere de la fecha de captura")
        comment = img.info.get("comment")
        if comment:
            meta.add("jpeg.comentario", comment)
            c = _clip(comment)
            if _FFMPEG.search(c) or _AI_TOOLS.search(c) or _EDITORS.search(c):
                meta.set_software(c)
        if kind == "png":
            for k, v in (getattr(img, "text", None) or {}).items():
                key = str(k)
                meta.add(f"png.{key}", v)
                if key.lower() in _PNG_GEN_KEYS:
                    meta.flag(f"el PNG trae el campo «{key}», típico de generadores de imagen")
                if key.lower() == "software":
                    meta.set_software(v)
        try:
            iptc = IptcImagePlugin.getiptcinfo(img) or {}
        except Exception:
            iptc = {}
        for code, name in _IPTC.items():
            if code in iptc:
                v = iptc[code]
                meta.add(f"iptc.{name}", v[0] if isinstance(v, list) and v else v)
        if iptc.get((2, 65)):
            v = iptc[(2, 65)]
            meta.set_software(v[0] if isinstance(v, list) and v else v)
    _scan_xmp(data, meta)
    out = meta.finish()
    # Solo formato y dimensiones no cuentan como metadatos del archivo.
    out["present"] = meta.present
    return out


_TAG_ORDER = ("software", "com.apple.quicktime.software", "encoder", "encoded_by", "encoded-by", "tool",
              "creation_tool", "writing_application")


def container_metadata(info: dict | None, data: bytes, kind: str) -> dict[str, Any] | None:
    """`SenalesTecnicas.metadata` de audio o video, a partir de ffprobe y del XMP incrustado."""
    meta = _Meta()
    meta.fields["formato"] = kind
    if info is None:
        _scan_xmp(data, meta)
        if not meta.present:
            return None
        return meta.finish()
    fmt = info.get("format") or {}
    if fmt.get("format_name"):
        meta.fields["contenedor"] = _clip(fmt["format_name"])
    if fmt.get("duration"):
        with contextlib.suppress(ValueError):
            meta.fields["duracion_s"] = f"{float(fmt['duration']):.2f}"
    tags = {str(k).lower(): v for k, v in (fmt.get("tags") or {}).items()}
    for k, v in tags.items():
        meta.add(f"tag.{k}", v)
    for key in _TAG_ORDER:
        if tags.get(key):
            meta.set_software(tags[key])
            break
    for st in info.get("streams") or []:
        kind_s = st.get("codec_type")
        if kind_s not in ("audio", "video"):
            continue
        prefix = f"{kind_s}{st.get('index', '')}"
        desc = [st.get("codec_name"), st.get("profile")]
        if kind_s == "audio":
            desc += [f"{st.get('sample_rate')} Hz" if st.get("sample_rate") else None,
                     f"{st.get('channels')} canales" if st.get("channels") else None]
        else:
            if st.get("width") and st.get("height"):
                desc.append(f"{st['width']}x{st['height']}")
            if st.get("avg_frame_rate") and st["avg_frame_rate"] != "0/0":
                desc.append(f"{st['avg_frame_rate']} fps")
        meta.fields[f"{prefix}.codec"] = _clip(", ".join(str(d) for d in desc if d))
        stags = {str(k).lower(): v for k, v in (st.get("tags") or {}).items()}
        for k, v in stags.items():
            if k in ("language", "vendor_id") or k.startswith("duration"):
                continue
            meta.add(f"{prefix}.{k}", v)
        for key in _TAG_ORDER:
            if stags.get(key):
                meta.set_software(stags[key])
                break
    _scan_xmp(data, meta)
    out = meta.finish()
    out["present"] = bool(meta.present)
    return out
