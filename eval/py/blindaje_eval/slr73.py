"""Descarga y organiza OpenSLR SLR73 (español de Perú, CC BY-SA 4.0).

Fuente: https://www.openslr.org/73/  (Guevara-Rukoz et al., LREC 2020; (c) 2018, 2019 Google, Inc.)
Archivos: es_pe_female.zip (913 MB) y es_pe_male.zip (1.0 GB), WAV mono de 48 kHz. El nombre de
cada archivo es <pef|pem>_<hablante>_<id>.wav, así que el hablante sale del nombre.

La descarga es idempotente: si el zip ya está completo no se vuelve a bajar.

Uso:
  uv run python -I -m blindaje_eval.slr73 descargar
  uv run python -I -m blindaje_eval.slr73 resumen
"""

from __future__ import annotations

import argparse
import json
import random
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import httpx

from .paths import SLR73_DIR, ensure_dirs

MIRRORS = [
    "https://openslr.trmal.net/resources/73",
    "https://openslr.elda.org/resources/73",
    "https://openslr.magicdatatech.com/resources/73",
]
FILES = {
    "LICENSE": None,
    "about.html": None,
    "line_index_female.tsv": None,
    "line_index_male.tsv": None,
    "es_pe_female.zip": 913_983_951,
    "es_pe_male.zip": 1_026_322_863,
}
SUBDIRS = {"es_pe_female.zip": "female", "es_pe_male.zip": "male"}

# Partición fija y reproducible de hablantes
SPLIT_SEED = 73
COHORTE_POR_SEXO = 5  # 10 hablantes para la cohorte de referencia (s-norm), nunca se usan en la prueba


def _download(name: str, expected: int | None) -> Path:
    dest = SLR73_DIR / name
    if dest.exists() and (expected is None or dest.stat().st_size == expected):
        return dest
    last_err: Exception | None = None
    for base in MIRRORS:
        url = f"{base}/{name}"
        try:
            tmp = dest.with_suffix(dest.suffix + ".part")
            with httpx.stream("GET", url, follow_redirects=True, timeout=60) as r:
                r.raise_for_status()
                with tmp.open("wb") as fh:
                    for chunk in r.iter_bytes(1 << 20):
                        fh.write(chunk)
            if expected is not None and tmp.stat().st_size != expected:
                raise RuntimeError(f"tamaño inesperado de {name}: {tmp.stat().st_size}")
            tmp.replace(dest)
            print(f"descargado {name} desde {base}")
            return dest
        except Exception as e:  # noqa: BLE001 - probamos el siguiente espejo
            last_err = e
            print(f"fallo {url}: {e}")
    raise RuntimeError(f"no se pudo descargar {name}: {last_err}")


def descargar() -> None:
    ensure_dirs()
    SLR73_DIR.mkdir(parents=True, exist_ok=True)
    for name, size in FILES.items():
        _download(name, size)
    for zname, sub in SUBDIRS.items():
        out = SLR73_DIR / sub
        if out.exists() and any(out.glob("*.wav")):
            continue
        print(f"descomprimiendo {zname}…")
        with zipfile.ZipFile(SLR73_DIR / zname) as z:
            for m in z.infolist():
                # Datos descargados: solo extraemos .wav/.tsv y sin rutas raras
                base = Path(m.filename).name
                if not base or not (base.endswith(".wav") or base.endswith(".tsv") or base == "LICENSE"):
                    continue
                target = out / base
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(m) as src, target.open("wb") as dst:
                    dst.write(src.read())
    print("SLR73 listo en", SLR73_DIR)


@dataclass
class Hablante:
    id: str  # p. ej. pem_00295
    sexo: str  # F | M
    archivos: list[Path]


def hablantes() -> dict[str, Hablante]:
    out: dict[str, Hablante] = {}
    por: dict[str, list[Path]] = defaultdict(list)
    for sub in ("female", "male"):
        for wav in sorted((SLR73_DIR / sub).glob("*.wav")):
            parts = wav.stem.split("_")
            por["_".join(parts[:2])].append(wav)
    for hid, files in sorted(por.items()):
        out[hid] = Hablante(id=hid, sexo="F" if hid.startswith("pef") else "M", archivos=files)
    if not out:
        raise RuntimeError("SLR73 no está descargado: corre `python -m blindaje_eval.slr73 descargar`")
    return out


def particion() -> dict[str, list[str]]:
    """Cohorte (10 hablantes, 5 y 5) y prueba (el resto). Fija con SPLIT_SEED."""
    hs = hablantes()
    rng = random.Random(SPLIT_SEED)
    cohorte: list[str] = []
    for sexo in ("F", "M"):
        # Solo hablantes con suficientes frases para la cohorte y la prueba
        ids = sorted(h.id for h in hs.values() if h.sexo == sexo and len(h.archivos) >= 60)
        rng.shuffle(ids)
        cohorte += sorted(ids[:COHORTE_POR_SEXO])
    prueba = sorted(h for h in hs if h not in cohorte)
    return {"cohorte": cohorte, "prueba": prueba}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("accion", choices=["descargar", "resumen"])
    a = ap.parse_args()
    if a.accion == "descargar":
        descargar()
    else:
        hs = hablantes()
        p = particion()
        print(json.dumps({"hablantes": len(hs), "cohorte": p["cohorte"], "prueba": len(p["prueba"])}, indent=2))


if __name__ == "__main__":
    main()
