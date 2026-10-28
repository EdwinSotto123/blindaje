"""Robustez de la trazabilidad de filtraciones (AudioSeal y Video Seal con mensaje).

Inserta mensajes al azar con los endpoints reales (`/watermark/*/embed`), simula lo que le pasa a una
copia filtrada (reenvío por WhatsApp, recorte, captura de pantalla) y la decodifica con
`/watermark/*/detect`. También mide los falsos positivos sobre los mismos archivos sin marca.

Solo medios ficticios: los audios del demo (`eval/demo/audio`, voces sintéticas de MMS-TTS), las dos
fotos del demo (`eval/demo/*.jpg`, generadas con Muse Image) y escenas, notas y señales parecidas a voz
generadas aquí. Semilla fija.

    cd services/ml
    uv run python scripts/eval_watermark.py            # escribe eval/results/watermark.json

Necesita el extra `models`, los pesos (`scripts/download_models.py`) y ffmpeg con libopus. Carga los
cuatro modelos de marcas de agua (~330 MB); conviene tener al menos 4 GB libres.
"""

from __future__ import annotations

import argparse
import datetime
import io
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("NO_TORCH_COMPILE", "1")

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ML = Path(__file__).resolve().parent.parent
REPO = ML.parent.parent
SEED = 20261028
SR = 16_000
# Destinatarios simulados: el mensaje verdadero y otros 49 emitidos a otras cuentas.
N_ISSUED = 50
# Regla de atribución recomendada a la API (ver docs/ML_API.md).
IMAGE_MAX_HAMMING = 64  # de 256 bits: al azar, P(d <= 64) ~ 1e-15 por mensaje emitido
AUDIO_MAX_HAMMING = 0  # de 16 bits: solo coincidencia exacta y con `detected`


# --- medios -------------------------------------------------------------------------------------


def speechlike(seconds: float, seed: int) -> np.ndarray:
    """Armónicos con vibrato, sílabas y ruido (sin licencias de por medio)."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(SR * seconds)) / SR
    base = rng.uniform(95, 230)
    f0 = base + 0.18 * base * np.sin(2 * np.pi * rng.uniform(0.3, 0.9) * t) + 8 * np.sin(2 * np.pi * 5.3 * t)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    x = sum((rng.uniform(0.3, 0.6) / k) * np.sin(k * phase) for k in range(1, 14))
    envelope = np.clip(np.sin(2 * np.pi * rng.uniform(2.5, 4.5) * t), 0, None) ** 0.6
    x = x * envelope + rng.uniform(0.003, 0.02) * rng.standard_normal(t.size)
    return (rng.uniform(0.15, 0.45) * x / np.abs(x).max()).astype(np.float32)


def scene(w: int, h: int, seed: int) -> Image.Image:
    """Escena con textura y objetos, como una foto de un local."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    s = max(w, h) / 640
    base = np.stack([120 + 60 * np.sin(xx / (37 * s)), 110 + 50 * np.cos(yy / (23 * s)),
                     90 + 40 * np.sin((xx + yy) / (51 * s))], axis=-1)
    base += rng.normal(0, 14, base.shape).astype(np.float32)
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2 * s))
    d = ImageDraw.Draw(img)
    for _ in range(30):
        x, y = int(rng.integers(0, w - 60 * s)), int(rng.integers(0, h - 60 * s))
        color = tuple(int(c) for c in rng.integers(0, 255, 3))
        d.rectangle((x, y, x + int(rng.integers(10, 90) * s), y + int(rng.integers(10, 90) * s)), fill=color)
    return img


def note(w: int, h: int, seed: int) -> Image.Image:
    """Nota escrita sobre papel (mucha zona lisa: la marca se atenúa más)."""
    rng = np.random.default_rng(seed)
    paper = np.full((h, w, 3), (236, 232, 222), np.float32) + rng.normal(0, 4, (h, w, 3)).astype(np.float32)
    img = Image.fromarray(np.clip(paper, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for i in range(10):
        y = int(h * (0.1 + 0.08 * i))
        x = int(w * 0.08)
        while x < w * 0.85:
            ww = int(rng.integers(20, 90) * w / 1000)
            d.rectangle((x, y, x + ww, y + max(3, h // 70)), fill=(40, 40, 60))
            x += ww + int(18 * w / 1000)
    return img.filter(ImageFilter.GaussianBlur(1.0))


def audio_media(rng: np.random.Generator) -> list[dict]:
    from blindaje_ml import media

    out = []
    for p in sorted((REPO / "eval" / "demo" / "audio").glob("*.ogg")):
        wav, _ = media.normalize_audio(p.read_bytes())
        out.append({"id": f"demo/{p.stem}", "tipo": "voz sintética del demo (MMS-TTS)",
                    "samples": media.wav_to_array(wav)})
    for i in range(12):
        out.append({"id": f"sintetico/voz-{i:02d}", "tipo": "señal parecida a voz",
                    "samples": speechlike(float(rng.uniform(8, 20)), SEED + i)})
    return out


def image_media() -> list[dict]:
    out = []
    for p in sorted((REPO / "eval" / "demo").glob("foto-*.jpg")):
        out.append({"id": f"demo/{p.stem}", "tipo": "foto del demo (Muse Image)", "img": Image.open(p).convert("RGB")})
    sizes = [(1280, 960), (2000, 1500), (1080, 1920), (4000, 3000), (1600, 1200), (960, 1280), (3000, 4000),
             (1920, 1080)]
    for i, (w, h) in enumerate(sizes):
        out.append({"id": f"sintetico/escena-{w}x{h}", "tipo": "escena sintética", "img": scene(w, h, SEED + i)})
    for i, (w, h) in enumerate([(1200, 1600), (1600, 1200), (2448, 3264), (900, 1200)]):
        out.append({"id": f"sintetico/nota-{w}x{h}", "tipo": "nota sobre papel", "img": note(w, h, SEED + 100 + i)})
    return out


# --- transformaciones ---------------------------------------------------------------------------


def _ffmpeg(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def opus(wav: bytes, bitrate: str) -> bytes:
    """Reenvío por WhatsApp: Opus mono (16 kbps es lo típico de una nota de voz)."""
    with tempfile.TemporaryDirectory(prefix="bml-eval-") as tmp:
        src, dst = Path(tmp) / "in.wav", Path(tmp) / "out.ogg"
        src.write_bytes(wav)
        _ffmpeg(["-i", str(src), "-ac", "1", "-c:a", "libopus", "-b:a", bitrate, str(dst)])
        return dst.read_bytes()


def fragment(samples: np.ndarray, seconds: float, rng: np.random.Generator) -> np.ndarray:
    n = int(seconds * SR)
    if samples.size <= n:
        return samples
    start = int(rng.integers(0, samples.size - n))
    return samples[start : start + n]


def jpeg(img: Image.Image, q: int) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=q)
    return buf.getvalue()


def png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def whatsapp(img: Image.Image) -> bytes:
    """Lado mayor a 1600 px como máximo y JPEG 70."""
    w, h = img.size
    if max(w, h) > 1600:
        k = 1600 / max(w, h)
        img = img.resize((round(w * k), round(h * k)), Image.Resampling.LANCZOS)
    return jpeg(img, 70)


def crop10(img: Image.Image) -> Image.Image:
    """Quita ~10 % del ancho y del alto, sin centrar (izq. 6 %, der. 4 %, arriba 3 %, abajo 7 %)."""
    w, h = img.size
    return img.crop((round(0.06 * w), round(0.03 * h), round(0.96 * w), round(0.93 * h)))


def screenshot(img: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Captura de un celular de 1080 x 2340 con la foto abierta en un chat: barras arriba y abajo y la
    foto escalada al ancho de la pantalla. Devuelve la captura y la caja de la foto."""
    sw, sh, top, bottom = 1080, 2340, 250, 160
    w, h = img.size
    k = min(sw / w, (sh - top - bottom) / h)
    pw, ph = round(w * k), round(h * k)
    shot = Image.new("RGB", (sw, sh), (11, 20, 26))
    d = ImageDraw.Draw(shot)
    d.rectangle((0, 0, sw, 90), fill=(0, 0, 0))
    d.rectangle((0, 90, sw, top), fill=(31, 44, 52))
    d.rectangle((0, sh - bottom, sw, sh), fill=(31, 44, 52))
    d.text((40, 30), "12:34", fill=(255, 255, 255))
    d.text((140, 150), "Contacto (ficticio)", fill=(230, 230, 230))
    x0, y0 = (sw - pw) // 2, top + (sh - top - bottom - ph) // 2
    shot.paste(img.resize((pw, ph), Image.Resampling.LANCZOS), (x0, y0))
    return shot, (x0, y0, x0 + pw, y0 + ph)


def image_variants(marked_jpeg: bytes) -> dict[str, bytes]:
    img = Image.open(io.BytesIO(marked_jpeg)).convert("RGB")
    shot, box = screenshot(img)
    return {
        "sin_cambios": marked_jpeg,
        "whatsapp": whatsapp(img),
        "recorte_10_whatsapp": whatsapp(crop10(img)),
        "captura_png": png(shot),
        "captura_png_recortada": png(shot.crop(box)),
        "captura_whatsapp": whatsapp(shot),
    }


# --- métricas -----------------------------------------------------------------------------------


def _bits_of_int(v: int, n: int) -> np.ndarray:
    return np.array([(v >> (n - 1 - i)) & 1 for i in range(n)], dtype=np.uint8)


def _attribute(decoded: np.ndarray, issued: np.ndarray, max_d: int, gate: bool) -> tuple[int | None, int, bool]:
    """Vecino más cercano por Hamming. Devuelve (índice o None si no pasa la regla, distancia mínima,
    mínimo único)."""
    d = (issued != decoded[None]).sum(axis=1)
    best = int(d.argmin())
    unique = int((d == d[best]).sum()) == 1
    ok = gate and unique and int(d[best]) <= max_d
    return (best if ok else None), int(d[best]), unique


def summarize(rows: list[dict]) -> dict:
    if not rows:
        return {"n": 0}
    acc = np.array([r["bit_acc"] for r in rows])
    out = {
        "n": len(rows),
        "deteccion": round(float(np.mean([r["detected"] for r in rows])), 4),
        "precision_bits_media": round(float(acc.mean()), 4),
        "precision_bits_min": round(float(acc.min()), 4),
        "mensaje_exacto": round(float(np.mean([r["exact"] for r in rows])), 4),
        "vecino_correcto": round(float(np.mean([r["nn_ok"] for r in rows])), 4),
        "atribucion_con_regla": round(float(np.mean([r["rule_ok"] for r in rows])), 4),
        "hamming_medio": round(float(np.mean([r["hamming"] for r in rows])), 2),
        "hamming_max": int(max(r["hamming"] for r in rows)),
        "puntaje_medio": round(float(np.mean([r["score"] for r in rows])), 4),
        "puntaje_min": round(float(min(r["score"] for r in rows)), 4),
    }
    return out


def summarize_clean(rows: list[dict]) -> dict:
    if not rows:
        return {"n": 0}
    return {
        "n": len(rows),
        "falsos_positivos": round(float(np.mean([r["detected"] for r in rows])), 4),
        "falsa_atribucion_con_regla": round(float(np.mean([r["rule_hit"] for r in rows])), 4),
        "puntaje_max": round(float(max(r["score"] for r in rows)), 4),
        "hamming_min_a_emitidos": int(min(r["min_d"] for r in rows)),
    }


# --- corrida ------------------------------------------------------------------------------------


def run_audio(client, rng: np.random.Generator, reps: int) -> dict:
    from blindaje_ml import media

    variants = ["sin_cambios", "whatsapp_opus_16k", "fragmento_6s_opus_16k", "opus_8k"]
    marked_rows: dict[str, list] = {v: [] for v in variants}
    clean_rows: dict[str, list] = {v: [] for v in variants}
    snr, embed_ms, seconds = [], [], 0.0
    items = audio_media(rng)
    for item in items:
        x = item["samples"]
        clean_wav = media.array_to_wav(x)
        for rep in range(reps if item["id"].startswith("demo/") else 1):
            msg = int(rng.integers(0, 65536))
            issued = np.stack([_bits_of_int(msg, 16)] + [_bits_of_int(int(v), 16)
                                                          for v in rng.integers(0, 65536, N_ISSUED - 1)])
            t0 = time.perf_counter()
            r = client.post(f"/watermark/audio/embed?message={msg}", content=clean_wav)
            embed_ms.append((time.perf_counter() - t0) * 1000)
            seconds += x.size / SR
            r.raise_for_status()
            marked = media.wav_to_array(r.content)
            wm = marked - x[: marked.size]
            snr.append(10 * np.log10(np.sum(x**2) / max(np.sum(wm**2), 1e-12)))
            frag_rng = np.random.default_rng(SEED + rep)
            bodies = {
                "sin_cambios": r.content,
                "whatsapp_opus_16k": opus(r.content, "16k"),
                "fragmento_6s_opus_16k": opus(media.array_to_wav(fragment(marked, 6.0, frag_rng)), "16k"),
                "opus_8k": opus(r.content, "8k"),
            }
            for v, body in bodies.items():
                d = client.post("/watermark/audio/detect", content=body).json()
                bits = (np.array(d["bits"]) > 0.5).astype(np.uint8)
                who, dist, unique = _attribute(bits, issued, AUDIO_MAX_HAMMING, d["detected"])
                marked_rows[v].append({"id": item["id"], "detected": d["detected"], "score": d["score"],
                                       "bit_acc": float(np.mean(bits == issued[0])),
                                       "exact": d["message"] == msg, "hamming": int((bits != issued[0]).sum()),
                                       "nn_ok": unique and int((issued != bits).sum(axis=1).argmin()) == 0,
                                       "rule_ok": who == 0})
            if rep == 0:  # sin marca: una vez por archivo
                frag_rng = np.random.default_rng(SEED + 99)
                clean_bodies = {
                    "sin_cambios": clean_wav,
                    "whatsapp_opus_16k": opus(clean_wav, "16k"),
                    "fragmento_6s_opus_16k": opus(media.array_to_wav(fragment(x, 6.0, frag_rng)), "16k"),
                    "opus_8k": opus(clean_wav, "8k"),
                }
                for v, body in clean_bodies.items():
                    d = client.post("/watermark/audio/detect", content=body).json()
                    bits = (np.array(d["bits"]) > 0.5).astype(np.uint8)
                    who, dist, _ = _attribute(bits, issued, AUDIO_MAX_HAMMING, d["detected"])
                    clean_rows[v].append({"detected": d["detected"], "score": d["score"], "rule_hit": who is not None,
                                          "min_d": dist})
        print(f"  audio {item['id']} listo", flush=True)
    return {
        "medios": [{"id": i["id"], "tipo": i["tipo"], "segundos": round(i["samples"].size / SR, 2)} for i in items],
        "con_marca": {v: summarize(rows) for v, rows in marked_rows.items()},
        "sin_marca": {v: summarize_clean(rows) for v, rows in clean_rows.items()},
        "calidad": {"snr_db_media": round(float(np.mean(snr)), 2), "snr_db_min": round(float(np.min(snr)), 2)},
        "costo": {"ms_por_segundo_de_audio": round(float(np.sum(embed_ms) / seconds), 1)},
    }


def run_images(client, rng: np.random.Generator, reps: int) -> dict:
    variants = ["sin_cambios", "whatsapp", "recorte_10_whatsapp", "captura_png", "captura_png_recortada",
                "captura_whatsapp"]
    marked_rows: dict[str, list] = {v: [] for v in variants}
    clean_rows: dict[str, list] = {v: [] for v in variants}
    psnr, embed_ms, mpix = [], [], 0.0
    items = image_media()
    for item in items:
        img = item["img"]
        src = jpeg(img, 95)
        original = np.asarray(Image.open(io.BytesIO(src)).convert("RGB"), dtype=np.float64)
        for rep in range(reps if item["id"].startswith("demo/") else 1):
            bits = rng.integers(0, 2, 256).astype(np.uint8)
            issued = np.vstack([bits[None], rng.integers(0, 2, (N_ISSUED - 1, 256)).astype(np.uint8)])
            hexmsg = f"{int(''.join(map(str, bits)), 2):064x}"
            t0 = time.perf_counter()
            r = client.post(f"/watermark/image/embed?message={hexmsg}", content=src)
            embed_ms.append((time.perf_counter() - t0) * 1000)
            mpix += img.size[0] * img.size[1] / 1e6
            r.raise_for_status()
            out = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), dtype=np.float64)
            assert out.shape == original.shape, (out.shape, original.shape)
            psnr.append(10 * np.log10(255**2 / max(np.mean((out - original) ** 2), 1e-12)))
            for v, body in image_variants(r.content).items():
                d = client.post("/watermark/image/detect", content=body).json()
                dec = (np.array(d["bits"]) > 0.5).astype(np.uint8)
                who, dist, unique = _attribute(dec, issued, IMAGE_MAX_HAMMING, True)
                marked_rows[v].append({"id": item["id"], "detected": d["detected"], "score": d["score"],
                                       "bit_acc": float(np.mean(dec == bits)), "exact": d["message_hex"] == hexmsg,
                                       "hamming": int((dec != bits).sum()),
                                       "nn_ok": unique and int((issued != dec).sum(axis=1).argmin()) == 0,
                                       "rule_ok": who == 0})
            if rep == 0:
                for v, body in image_variants(src).items():
                    d = client.post("/watermark/image/detect", content=body).json()
                    dec = (np.array(d["bits"]) > 0.5).astype(np.uint8)
                    who, dist, _ = _attribute(dec, issued, IMAGE_MAX_HAMMING, True)
                    clean_rows[v].append({"detected": d["detected"], "score": d["score"], "rule_hit": who is not None,
                                          "min_d": dist})
        print(f"  imagen {item['id']} lista", flush=True)
    return {
        "medios": [{"id": i["id"], "tipo": i["tipo"], "tamano": list(i["img"].size)} for i in items],
        "con_marca": {v: summarize(rows) for v, rows in marked_rows.items()},
        "sin_marca": {v: summarize_clean(rows) for v, rows in clean_rows.items()},
        "calidad": {"psnr_db_media": round(float(np.mean(psnr)), 2), "psnr_db_min": round(float(np.min(psnr)), 2)},
        "costo": {"ms_por_megapixel": round(float(np.sum(embed_ms) / mpix), 1)},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "eval" / "results" / "watermark.json"))
    ap.add_argument("--reps", type=int, default=3, help="mensajes distintos por cada medio del demo")
    ap.add_argument("--only", choices=["audio", "imagen"],
                    help="corre solo esa parte y conserva la otra del archivo de salida (cada parte tiene su semilla)")
    args = ap.parse_args()

    os.environ.setdefault("ML_MODELS_DIR", str(ML / "models"))
    os.environ.pop("ML_TOKEN", None)
    from fastapi.testclient import TestClient

    from blindaje_ml.app import create_app
    from blindaje_ml.config import get_settings, reset_settings
    from blindaje_ml.indices import IndexStore
    from blindaje_ml.voice import Cohort

    reset_settings()
    out = Path(args.out)
    previous = json.loads(out.read_text(encoding="utf-8")) if args.only and out.exists() else {}
    t0 = time.perf_counter()
    with TestClient(create_app(store=IndexStore(), cohort=Cohort(ML / "_no_cohort.npy"))) as client:
        if args.only == "imagen":
            audio = previous["audio"]
        else:
            print("audio...", flush=True)
            audio = run_audio(client, np.random.default_rng(SEED), args.reps)
        if args.only == "audio":
            images = previous["imagen"]
        else:
            print("imágenes...", flush=True)
            images = run_images(client, np.random.default_rng(SEED + 1), args.reps)
    report = {
        "schema_version": "1.0",
        "generado": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
        "ficticio": True,
        "aviso": "Medios ficticios: voces sintéticas y fotos generadas del demo, y escenas y señales sintéticas.",
        "comando": "cd services/ml && uv run python scripts/eval_watermark.py",
        "semilla": {"audio": SEED, "imagen": SEED + 1},
        "hilos_torch": get_settings().threads,
        "plataforma": f"{platform.system()} {platform.machine()}, Python {platform.python_version()}",
        "duracion_s": round(time.perf_counter() - t0, 1),
        "modelos": {"audio": "audioseal-16bits (generador y detector de 16 bits)",
                    "imagen": "videoseal-1.0 (y_256b_img: embebedor y extractor, 256 bits)"},
        "destinatarios_simulados": N_ISSUED,
        "regla_de_atribucion": {
            "audio": f"detected y distancia de Hamming <= {AUDIO_MAX_HAMMING} de 16 bits al mensaje emitido, único",
            "imagen": f"distancia de Hamming <= {IMAGE_MAX_HAMMING} de 256 bits al mensaje emitido más cercano, único",
        },
        "transformaciones": {
            "audio": {
                "sin_cambios": "el WAV que devuelve /watermark/audio/embed",
                "whatsapp_opus_16k": "Opus mono a 16 kbps (nota de voz reenviada) y vuelta a WAV 16 kHz",
                "fragmento_6s_opus_16k": "6 s tomados al azar del audio marcado, luego Opus 16 kbps",
                "opus_8k": "Opus mono a 8 kbps (caso extremo)",
            },
            "imagen": {
                "sin_cambios": "el JPEG 92 que devuelve /watermark/image/embed",
                "whatsapp": "lado mayor a 1600 px como máximo (Lanczos) y JPEG 70",
                "recorte_10_whatsapp": "recorte de ~10 % del ancho y del alto (sin centrar), luego WhatsApp",
                "captura_png": "captura de 1080 x 2340 con la foto escalada al ancho y barras de la app, PNG",
                "captura_png_recortada": "la misma captura recortada a la zona de la foto, PNG",
                "captura_whatsapp": "la captura entera reenviada por WhatsApp (1600 px, JPEG 70)",
            },
        },
        "audio": audio,
        "imagen": images,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"escrito {out}")
    for kind in ("audio", "imagen"):
        print(f"\n{kind}: con marca")
        for v, m in report[kind]["con_marca"].items():
            print(f"  {v:24s} n={m['n']:3d} det={m['deteccion']:.3f} bits={m['precision_bits_media']:.4f} "
                  f"exacto={m['mensaje_exacto']:.3f} atrib={m['atribucion_con_regla']:.3f} "
                  f"hamming_max={m['hamming_max']}")
        print(f"{kind}: sin marca")
        for v, m in report[kind]["sin_marca"].items():
            print(f"  {v:24s} n={m['n']:3d} fp={m['falsos_positivos']:.3f} "
                  f"falsa_atrib={m['falsa_atribucion_con_regla']:.3f} score_max={m['puntaje_max']:.3f} "
                  f"d_min={m['hamming_min_a_emitidos']}")
    print(json.dumps({"audio": audio["calidad"] | audio["costo"], "imagen": images["calidad"] | images["costo"]}))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
