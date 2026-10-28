"""Simulación de una nota de voz de WhatsApp con ffmpeg.

Una nota de voz de WhatsApp es Opus mono a 16 kHz y baja tasa de bits. Para simular "dos
celulares distintos" usamos dos canales con micrófono, ruido y tasa de bits diferentes:

  canal 1  celular de gama media: pasa altos 120 Hz, pasa bajos 7 kHz, ruido rosa leve, Opus 16 kbps
  canal 2  celular barato o con funda: pasa banda 300-3400 Hz, -3 dB, más ruido, Opus 10 kbps

Cada audio hace ida y vuelta: WAV -> filtros + ruido -> Opus (OGG) -> WAV mono 16 kHz PCM16,
que es lo que recibe el contenedor ML después de /audio/normalize.

Uso:
  uv run python -I -m blindaje_eval.whatsapp entrada.wav salida.ogg --canal 1 [--wav salida.wav]
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Canal:
    nombre: str
    filtros: str
    ruido_amplitud: float
    bitrate: str


CANALES: dict[int, Canal] = {
    1: Canal(
        nombre="celular 1 (gama media)",
        filtros="highpass=f=120,lowpass=f=7000",
        ruido_amplitud=0.002,
        bitrate="16k",
    ),
    2: Canal(
        nombre="celular 2 (gama baja, banda telefónica)",
        filtros="highpass=f=300,lowpass=f=3400,volume=-3dB",
        ruido_amplitud=0.006,
        bitrate="10k",
    ),
}


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falló ({proc.returncode}): {proc.stderr[-800:]}")


def simular(entrada: Path, salida_ogg: Path, canal: int, seed: int = 0, salida_wav: Path | None = None) -> Path:
    """Aplica el canal y codifica a Opus. Si se pide, decodifica de vuelta a WAV 16 kHz mono."""
    c = CANALES[canal]
    salida_ogg.parent.mkdir(parents=True, exist_ok=True)
    grafo = (
        f"[0:a]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono,{c.filtros}[s];"
        f"[1:a]aformat=sample_fmts=fltp:channel_layouts=mono[n];"
        f"[s][n]amix=inputs=2:duration=first:normalize=0[out]"
    )
    _run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(entrada),
            "-f", "lavfi", "-i", f"anoisesrc=color=pink:amplitude={c.ruido_amplitud}:sample_rate=16000:seed={seed}",
            "-filter_complex", grafo, "-map", "[out]",
            "-c:a", "libopus", "-b:a", c.bitrate, "-vbr", "on", "-application", "voip",
            "-ar", "16000", "-ac", "1",
            str(salida_ogg),
        ]
    )
    if salida_wav is not None:
        a_wav(salida_ogg, salida_wav)
    return salida_ogg


def a_wav(entrada: Path, salida_wav: Path) -> Path:
    """Igual que /audio/normalize del contenedor: WAV mono 16 kHz PCM16."""
    salida_wav.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(entrada), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(salida_wav),
        ]
    )
    return salida_wav


def ida_y_vuelta(entrada: Path, salida_wav: Path, canal: int, seed: int = 0) -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        ogg = Path(tmp) / "nota.ogg"
        simular(entrada, ogg, canal, seed=seed)
        return a_wav(ogg, salida_wav)


def main() -> None:
    ap = argparse.ArgumentParser(description="Simula una nota de voz de WhatsApp (Opus 16 kHz)")
    ap.add_argument("entrada", type=Path)
    ap.add_argument("salida_ogg", type=Path)
    ap.add_argument("--canal", type=int, choices=sorted(CANALES), default=1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--wav", type=Path, default=None, help="Además decodifica a WAV 16 kHz mono")
    a = ap.parse_args()
    simular(a.entrada, a.salida_ogg, a.canal, seed=a.seed, salida_wav=a.wav)
    print(f"{a.salida_ogg} ({CANALES[a.canal].nombre})")


if __name__ == "__main__":
    main()
