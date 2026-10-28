"""Audios del demo (casos A, B y C de la sección 3).

1. Si el equipo grabó los audios (eval/audio/raw/demo/A1.opus, A2.opus, B1.opus, C1.opus,
   victima-A.opus), se usan tal cual: ya vienen comprimidos por WhatsApp. Solo se copian a
   eval/demo/audio/ como OGG Opus.
2. Si falta alguno, se genera un respaldo SINTÉTICO con MMS-TTS de Meta (facebook/mms-tts-spa,
   VITS, licencia CC-BY-NC-4.0: uso no comercial, aceptable para un demo de hackathon) con los
   textos de eval/demo/guiones-audio.json (los mismos de docs/VIDEO.md).
   - persona1 (quien extorsiona en A y B, y el infiltrado): la voz de MMS-TTS sin cambios.
   - persona2 (C1) y persona3 (muestra de la víctima A): la misma síntesis con otro tono y otro
     timbre (asetrate), para que sean voces distintas para la huella de voz.
   Después pasan por la simulación de WhatsApp: A1, A2 y la muestra por el canal 1 (celular 1),
   B1, C1 y el infiltrado por el canal 2 (celular 2).
3. Verificación con la huella de voz (backend local, mismo modelo que el contenedor): A1, A2 y B1
   deben parecerse entre sí y no parecerse a C1 ni a la muestra de la víctima.

Uso:
  uv run python -I -m blindaje_eval.tts_demo [--force]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from .paths import AUDIO_RAW_DIR, DEMO_DIR, MODELS_DIR
from .voice_backend import LocalBackend
from .whatsapp import a_wav, simular

TTS_MODEL = "facebook/mms-tts-spa"
TTS_LICENSE = "CC-BY-NC-4.0"
# Cambios de tono y timbre (factor de asetrate). 1.0 = voz original de MMS-TTS.
VOCES = {"persona1": 1.0, "persona2": 0.86, "persona3": 1.22}
SEED = 7
OUT_DIR = DEMO_DIR / "audio"


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _dur(p: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def _tts():
    import torch
    from transformers import AutoTokenizer, VitsModel

    cache = str(MODELS_DIR / "hf")
    model = VitsModel.from_pretrained(TTS_MODEL, cache_dir=cache)
    tok = AutoTokenizer.from_pretrained(TTS_MODEL, cache_dir=cache)
    model.eval()

    def synth(texto: str, seed: int) -> tuple[np.ndarray, int]:
        torch.manual_seed(seed)
        partes = []
        # Frase por frase: VITS suena más natural con entradas cortas
        for i, frase in enumerate([f.strip() for f in texto.replace("?", "?.").split(".") if f.strip()]):
            inputs = tok(frase + ".", return_tensors="pt")
            with torch.no_grad():
                wav = model(**inputs).waveform[0].cpu().numpy().astype(np.float32)
            partes += [wav, np.zeros(int(0.28 * model.config.sampling_rate), dtype=np.float32)]
        return np.concatenate(partes), int(model.config.sampling_rate)

    return synth


def _cambiar_voz(src: Path, dst: Path, factor: float) -> None:
    if abs(factor - 1.0) < 1e-6:
        shutil.copyfile(src, dst)
        return
    info = sf.info(str(src))
    sr = info.samplerate
    filtro = f"asetrate={int(sr * factor)},aresample={sr},atempo={1 / factor:.5f}"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-af", filtro, str(dst)],
        check=True,
    )


def generar(force: bool = False) -> dict:
    spec = json.loads((DEMO_DIR / "guiones-audio.json").read_text(encoding="utf-8"))["audios"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT_DIR / "manifest.json"
    prev = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"audios": {}}
    synth = None
    out: dict = {
        "ficticio": True,
        "aviso": "Audios ficticios del demo de Blindaje. Los marcados como sintéticos fueron generados con MMS-TTS de Meta; no son voces de personas reales.",
        "tts": {"modelo": TTS_MODEL, "licencia": TTS_LICENSE, "voces": VOCES, "seed": SEED},
        "audios": {},
    }
    for i, (nombre, a) in enumerate(spec.items()):
        dst = OUT_DIR / f"{nombre}.ogg"
        grabado = AUDIO_RAW_DIR / "demo" / f"{nombre}.opus"
        if grabado.exists():
            if force or not dst.exists() or prev["audios"].get(nombre, {}).get("origen") != "grabado":
                # Ya viene comprimido por WhatsApp: se copia sin recodificar.
                shutil.copyfile(grabado, dst)
            origen = "grabado"
        else:
            if dst.exists() and not force and prev["audios"].get(nombre, {}).get("origen") == "sintetico":
                origen = "sintetico"
            else:
                if synth is None:
                    print(f"cargando {TTS_MODEL}…")
                    synth = _tts()
                wav, sr = synth(a["texto"], SEED + i)
                wav = 0.9 * wav / max(float(np.abs(wav).max()), 1e-6)
                with tempfile.TemporaryDirectory() as tmp:
                    base = Path(tmp) / "base.wav"
                    voz = Path(tmp) / "voz.wav"
                    sf.write(str(base), wav, sr, subtype="PCM_16")
                    _cambiar_voz(base, voz, VOCES[a["voz"]])
                    simular(voz, dst, a["canal"], seed=100 + i)
                origen = "sintetico"
        out["audios"][nombre] = {
            "archivo": f"eval/demo/audio/{nombre}.ogg",
            "origen": origen,
            "voz": a["voz"],
            "canal": a["canal"],
            "duracion_s": round(_dur(dst), 2),
            "sha256": _sha(dst),
            "texto": a["texto"],
        }
        print(f"{nombre}: {origen}, {out['audios'][nombre]['duracion_s']} s")
    out["verificacion_voz"] = verificar(list(spec))
    manifest_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out


def verificar(nombres: list[str]) -> dict:
    """Coseno entre huellas (backend local, mismo modelo y regla que el contenedor)."""
    be = LocalBackend()
    huellas = {}
    with tempfile.TemporaryDirectory() as tmp:
        for n in nombres:
            wav = a_wav(OUT_DIR / f"{n}.ogg", Path(tmp) / f"{n}.wav")
            huellas[n] = be.embed(wav).centroid
    pares = {}
    for i, a in enumerate(nombres):
        for b in nombres[i + 1 :]:
            pares[f"{a}~{b}"] = round(float(huellas[a] @ huellas[b]), 4)
    print(json.dumps(pares, indent=1))
    return {"backend": "local", "modelo": LocalBackend.modelo_id, "coseno": pares}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    generar(a.force)


if __name__ == "__main__":
    main()
