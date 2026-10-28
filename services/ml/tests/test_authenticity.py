"""Autenticidad sin modelos: metadatos (EXIF, XMP, IPTC, PNG, contenedor), C2PA y forma del contrato."""

from __future__ import annotations

import datetime
import io
import json
import struct
import subprocess

import numpy as np
import pytest
from PIL import Image

from blindaje_ml import provenance
from blindaje_ml.watermark import audio_windows, bit_confidence

from .conftest import assert_senales, needs_ffmpeg, needs_ffprobe, to_wav, tone

DST = "http://cv.iptc.org/newscodes/digitalsourcetype/"


def _jpeg(exif: Image.Exif | None = None, comment: bytes | None = None, size=(96, 64)) -> bytes:
    img = Image.new("RGB", size, (180, 120, 60))
    buf = io.BytesIO()
    kwargs = {}
    if exif is not None:
        kwargs["exif"] = exif
    if comment is not None:
        kwargs["comment"] = comment
    img.save(buf, "JPEG", quality=90, **kwargs)
    return buf.getvalue()


def _with_xmp(jpeg: bytes, xmp: str) -> bytes:
    """Inserta un segmento APP1 de XMP justo después de SOI."""
    payload = b"http://ns.adobe.com/xap/1.0/\x00" + xmp.encode()
    seg = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
    return jpeg[:2] + seg + jpeg[2:]


def _xmp(dst: str, tool: str = "Generador de prueba 2.0") -> str:
    return (
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" '
        f'xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="{tool}">'
        f'<Iptc4xmpExt:DigitalSourceType>{DST}{dst}</Iptc4xmpExt:DigitalSourceType>'
        "</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>"
    )


# --- formato ---------------------------------------------------------------------------------


def test_sniff_formats():
    png = io.BytesIO()
    Image.new("RGB", (4, 4)).save(png, "PNG")
    assert provenance.sniff(_jpeg()) == ("jpeg", "image/jpeg")
    assert provenance.sniff(png.getvalue()) == ("png", "image/png")
    assert provenance.sniff(to_wav(tone(440, 0.1))) == ("wav", "audio/wav")
    assert provenance.sniff(b"OggS\x00\x02" + b"\x00" * 20)[1] is None
    assert provenance.sniff(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 8) == ("mp4", "video/mp4")
    assert provenance.sniff(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 8) == ("heic", "image/heic")
    assert provenance.sniff(b"ID3\x04" + b"\x00" * 20) == ("mp3", "audio/mpeg")
    assert provenance.sniff(b"hola") == ("desconocido", None)


# --- metadatos de imagen ------------------------------------------------------------------------


def test_xmp_digital_source_type_trained():
    data = _with_xmp(_jpeg(), _xmp("trainedAlgorithmicMedia"))
    md = provenance.image_metadata(data, "jpeg")
    assert md["present"] is True
    assert md["digital_source_type"] == "trainedAlgorithmicMedia"
    assert md["software"] == "Generador de prueba 2.0"
    assert md["suspicious"][0].startswith("IPTC DigitalSourceType = trainedAlgorithmicMedia")


def test_xmp_digital_source_type_composite_attribute_form():
    xmp = (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description '
        f'Iptc4xmpExt:DigitalSourceType="{DST}compositeWithTrainedAlgorithmicMedia" '
        'xmp:CreatorTool="Adobe Photoshop 26.0"/></rdf:RDF></x:xmpmeta>'
    )
    md = provenance.image_metadata(_with_xmp(_jpeg(), xmp), "jpeg")
    assert md["digital_source_type"] == "compositeWithTrainedAlgorithmicMedia"
    assert "partes generadas con IA" in md["suspicious"][0]
    assert any("Photoshop" in s for s in md["suspicious"])


def test_xmp_digital_capture_is_not_suspicious():
    md = provenance.image_metadata(_with_xmp(_jpeg(), _xmp("digitalCapture", tool="Cámara")), "jpeg")
    assert md["digital_source_type"] == "digitalCapture"
    assert md["suspicious"] == []


def test_exif_software_dates_and_gps_privacy():
    exif = Image.Exif()
    exif[271] = "Marca Ficticia"
    exif[272] = "Telefono X1"
    exif[305] = "Snapseed 2.0"
    exif[306] = "2026:10:20 10:00:00"
    exif[315] = "Persona Ficticia"
    exif.get_ifd(0x8769)[36867] = "2026:10:19 08:30:00"
    exif.get_ifd(0x8825).update({1: "S", 2: (12.0, 3.0, 4.5), 3: "W", 4: (77.0, 1.0, 2.0)})
    md = provenance.image_metadata(_jpeg(exif=exif), "jpeg")
    f = md["fields"]
    assert f["exif.Make"] == "Marca Ficticia" and f["exif.Model"] == "Telefono X1"
    assert md["software"] == "Snapseed 2.0"
    assert f["exif.GPS"] == "presente" and f["exif.Artist"] == "presente"
    text = json.dumps(md, ensure_ascii=False)
    assert "Persona Ficticia" not in text and "77" not in text
    assert any("Snapseed" in s for s in md["suspicious"])
    assert any("fecha de modificación" in s for s in md["suspicious"])


def test_jpeg_comment_from_ffmpeg():
    md = provenance.image_metadata(_jpeg(comment=b"Lavc61.19.101"), "jpeg")
    assert md["software"] == "Lavc61.19.101"
    assert any("ffmpeg" in s for s in md["suspicious"])


def test_png_generation_parameters():
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    info.add_text("parameters", "una bodega, Steps: 30, Sampler: Euler a, CFG scale: 7, Model: sdxl")
    buf = io.BytesIO()
    Image.new("RGB", (32, 32)).save(buf, "PNG", pnginfo=info)
    md = provenance.image_metadata(buf.getvalue(), "png")
    joined = " | ".join(md["suspicious"])
    assert "«parameters»" in joined
    assert "parámetros de generación" in joined
    assert "sdxl" in joined.lower()


def test_plain_image_without_metadata():
    md = provenance.image_metadata(_jpeg(), "jpeg")
    assert md["present"] is False and md["suspicious"] == [] and md["software"] is None
    assert md["fields"] == {"formato": "jpeg", "dimensiones": "96x64"}


def test_ai_tool_regex_avoids_spanish_words():
    m = provenance._Meta()
    for t in ("Imagen de la bodega", "Veo la nota", "Audio de WhatsApp", "Editor de fotos"):
        m.add("x." + t, t)
    assert m.finish()["suspicious"] == []
    m = provenance._Meta()
    m.add("x.comment", "Made with Google Imagen 3")
    m.add("x.encoded_by", "ElevenLabs")
    assert len(m.finish()["suspicious"]) == 2


# --- C2PA ---------------------------------------------------------------------------------------


def _signing_chain() -> tuple[bytes, bytes]:
    """CA y certificado de firma ES256 de prueba, creados en el momento (nada se guarda en el repo)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    now = datetime.datetime.now(datetime.UTC)
    ca_key, key = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "CA de prueba"),
                         x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Blindaje Test")])
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Generador de prueba"),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Blindaje Test")])

    def usage(sign: bool) -> x509.KeyUsage:
        return x509.KeyUsage(digital_signature=sign, content_commitment=False, key_encipherment=False,
                             data_encipherment=False, key_agreement=False, key_cert_sign=not sign,
                             crl_sign=not sign, encipher_only=False, decipher_only=False)

    def base(subject, pub):
        return (x509.CertificateBuilder().subject_name(subject).issuer_name(ca_name).public_key(pub)
                .serial_number(x509.random_serial_number())
                .not_valid_before(now - datetime.timedelta(days=1))
                .not_valid_after(now + datetime.timedelta(days=7)))

    ca = (base(ca_name, ca_key.public_key())
          .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
          .add_extension(usage(False), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))
    leaf = (base(name, key.public_key())
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(usage(True), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    pem = leaf.public_bytes(serialization.Encoding.PEM) + ca.public_bytes(serialization.Encoding.PEM)
    pkey = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())
    return pem, pkey


def _signed_jpeg(dst: str = "trainedAlgorithmicMedia") -> bytes:
    c2pa = pytest.importorskip("c2pa")
    certs, pkey = _signing_chain()
    manifest = {
        "claim_generator_info": [{"name": "Generador de prueba", "version": "1.0"}],
        "title": "prueba.jpg",
        "assertions": [{"label": "c2pa.actions", "data": {"actions": [
            {"action": "c2pa.created", "digitalSourceType": DST + dst}]}}],
    }
    signer = c2pa.Signer.from_info(c2pa.C2paSignerInfo(c2pa.C2paSigningAlg.ES256, certs, pkey, None))
    out = io.BytesIO()
    c2pa.Builder(json.dumps(manifest)).sign(signer, "image/jpeg", io.BytesIO(_jpeg()), out)
    return out.getvalue()


def test_c2pa_ai_generated_manifest():
    c = provenance.read_c2pa(_signed_jpeg(), "image/jpeg")
    assert c["present"] is True
    assert c["ai_generated"] is True
    assert c["generator"] == "Generador de prueba 1.0"
    assert "c2pa.created (trainedAlgorithmicMedia)" in c["claims"]
    assert any(x.startswith("firmado por Blindaje Test") for x in c["claims"])
    assert any(x.startswith("validación:") for x in c["claims"])


def test_c2pa_digital_capture_is_not_ai():
    c = provenance.read_c2pa(_signed_jpeg("digitalCapture"), "image/jpeg")
    assert c["present"] is True and c["ai_generated"] is False


def test_c2pa_absent_and_unsupported():
    pytest.importorskip("c2pa")
    assert provenance.read_c2pa(_jpeg(), "image/jpeg") == {
        "present": False, "ai_generated": None, "generator": None, "claims": []}
    ogg = provenance.read_c2pa(b"OggS" + b"\x00" * 40, None)
    assert ogg["present"] is False and ogg["claims"]


def test_c2pa_damaged_manifest_is_reported():
    pytest.importorskip("c2pa")
    data = bytearray(_signed_jpeg())
    i = data.find(b"c2pa.actions")
    data[i : i + 12] = b"x" * 12  # rompe una afirmación dentro del manifiesto
    c = provenance.read_c2pa(bytes(data), "image/jpeg")
    assert c["present"] is True
    assert c["ai_generated"] in (True, None)  # nunca "no es IA" con un manifiesto roto
    assert c["claims"]


def test_summarize_c2pa_ingredient_and_agents():
    store = {
        "active_manifest": "a",
        "manifests": {
            "a": {"claim_generator": "Editor 1.0", "assertions": [
                {"label": "c2pa.actions.v2", "data": {"actions": [{"action": "c2pa.opened"}]}}]},
            "b": {"assertions": [{"label": "c2pa.actions", "data": {"actions": [
                {"action": "c2pa.created", "digitalSourceType": DST + "trainedAlgorithmicMedia",
                 "softwareAgent": {"name": "Generador", "version": "3"}}]}}]},
        },
        "validation_status": [{"code": "signingCredential.untrusted"}],
    }
    c = provenance.summarize_c2pa(store, "Valid")
    assert c["ai_generated"] is True and c["generator"] == "Editor 1.0"
    assert "c2pa.created (trainedAlgorithmicMedia) con Generador 3" in c["claims"]
    assert "avisos de validación: signingCredential.untrusted" in c["claims"]
    assert provenance.summarize_c2pa({"manifests": {"a": {}}}, None)["ai_generated"] is None


# --- utilidades de las marcas de agua -------------------------------------------------------------


def test_bit_confidence_range():
    assert bit_confidence(np.zeros(256)) == 0.0
    assert bit_confidence(np.full(256, 20.0)) > 0.999
    assert 0.2 < bit_confidence(np.random.default_rng(0).normal(0, 0.8, 256)) < 0.5


def test_audio_windows_spread_over_long_audio():
    sr = 16_000
    assert audio_windows(sr * 25, 120) == [(0, sr * 10), (sr * 10, sr * 20), (sr * 20, sr * 25)]
    w = audio_windows(sr * 600, 60)
    assert len(w) == 6 and w[0][0] == 0 and w[-1][1] == sr * 600  # incluye el final del audio
    assert audio_windows(100, 120) == []


# --- endpoints con detectores falsos ------------------------------------------------------------


def test_image_endpoint_shape(client, fakes):
    data = _with_xmp(_jpeg(), _xmp("trainedAlgorithmicMedia"))
    r = client.post("/authenticity/image", content=data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert_senales(body)
    assert body["watermark"] == {"detector": "videoseal-1.0", "detected": False, "score": 0.1}
    assert body["metadata"]["digital_source_type"] == "trainedAlgorithmicMedia"
    assert body["synthetic_speech"] is None
    assert fakes["videoseal"].frames == 1


def test_image_endpoint_with_c2pa(client):
    body = client.post("/authenticity/image", content=_signed_jpeg()).json()
    assert_senales(body)
    assert body["c2pa"]["present"] is True and body["c2pa"]["ai_generated"] is True


def test_image_endpoint_errors(client):
    assert client.post("/authenticity/image", content=b"").status_code == 422
    r = client.post("/authenticity/image", content=b"esto no es una imagen")
    assert r.status_code == 422 and r.json()["error"] == "invalid_image"


@needs_ffprobe
def test_audio_endpoint_tags(client, tmp_path):
    src = tmp_path / "in.wav"
    out = tmp_path / "out.m4a"
    src.write_bytes(to_wav(tone(220, 2.0)))
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-c:a", "aac",
                    "-metadata", "comment=Generated with ElevenLabs", "-metadata", "artist=Persona Ficticia",
                    str(out)], check=True)
    r = client.post("/authenticity/audio", content=out.read_bytes())
    assert r.status_code == 200, r.text
    body = r.json()
    assert_senales(body)
    assert body["watermark"]["detector"] == "audioseal-16bits" and body["watermark"]["detected"] is False
    assert body["synthetic_speech"] == {"detector": "ninguno", "score": 0.0, "available": False}
    md = body["metadata"]
    assert md["fields"]["tag.artist"] == "presente" and "Persona Ficticia" not in r.text
    assert md["fields"]["audio0.codec"].startswith("aac")
    assert any("ElevenLabs" in s for s in md["suspicious"])
    assert body["c2pa"]["present"] is False  # m4a admite C2PA, pero este no lo trae


@needs_ffmpeg
def test_audio_endpoint_errors(client):
    assert client.post("/authenticity/audio", content=b"").status_code == 422
    assert client.post("/authenticity/audio", content=b"no es audio").status_code == 422


@needs_ffprobe
def test_video_endpoint(client, fakes, tmp_path):
    out = tmp_path / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
         "testsrc=size=320x240:rate=10:duration=3", "-f", "lavfi", "-i", "sine=frequency=500:duration=3",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)],
        check=True,
    )
    r = client.post("/authenticity/video?frames=6", content=out.read_bytes())
    assert r.status_code == 200, r.text
    body = r.json()
    assert_senales(body)
    wm = body["watermark"]
    assert wm["detector"] == "videoseal-1.0+audioseal-16bits"
    assert wm["frames_checked"] == 6 and fakes["videoseal"].frames == 6
    assert body["metadata"]["fields"]["video0.codec"].startswith("h264")
    assert body["synthetic_speech"]["available"] is False


@needs_ffprobe
def test_video_endpoint_rejects_audio_only(client, tmp_path):
    src = tmp_path / "in.wav"
    src.write_bytes(to_wav(tone(220, 1.0)))
    r = client.post("/authenticity/video", content=src.read_bytes())
    assert r.status_code == 422 and r.json()["error"] == "no_video"
