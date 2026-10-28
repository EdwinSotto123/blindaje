"""Evaluación de vinculación por voz con SLR73 y calibración de la señal de voz.

Protocolo (sección 16 del documento de diseño, adaptado a SLR73):

1. Partición fija de hablantes (slr73.particion): 10 para la cohorte de referencia (s-norm) y el
   resto para la prueba. La cohorte nunca entra a la prueba.
2. Por hablante de prueba se arman 4 "notas de voz" de unos 16 s, cada una con frases distintas
   (nunca se repite una frase entre audios):
     a1, a2 -> canal 1 (celular 1)   = el caso donde se inscribe la voz (como A1 y A2)
     b1, b2 -> canal 2 (celular 2)   = dos casos de prueba desde otro celular (como B1)
   Cada nota pasa por la simulación de WhatsApp (Opus 16 kHz, ida y vuelta a WAV).
3. Huella de cada audio con el backend (contenedor ML u, opcionalmente, local con el mismo modelo).
   La huella del caso inscrito es el centroide de los segmentos de a1 y a2.
4. Métricas:
   - Identificación: cada prueba (b1, b2) se compara con todos los casos inscritos; acierto en el
     primer lugar y entre los 3 primeros.
   - Comparaciones: todos los pares (caso inscrito, prueba). Pares de la misma persona y de
     personas distintas. Falsos vínculos = pares de personas distintas cuya probabilidad de voz
     calibrada llega al umbral de revisión (0.60). Se reportan por cada 100 comparaciones.
5. Calibración: logística p = 1 / (1 + e^-(a·(s − b))) sobre la similitud coseno s, derivada de
   las dos distribuciones (gaussiana, ver calibracion_gaussiana) y validada con 2 particiones por
   hablante. Si el ajuste deja más de 1 falso vínculo por cada 100 pares distintos sobre el umbral
   de revisión, se sube b hasta cumplirlo (restricción explícita, ver el reporte).
6. Cohorte: centroides de 6 audios (3 por canal) de cada hablante de la cohorte -> eval/cohort.npy.

Uso:
  uv run python -I -m blindaje_eval.voice_eval --backend auto|ml|local
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from . import slr73
from .paths import AUDIO_WHATSAPP_DIR, EVAL_DIR, RESULTS_DIR, ensure_dirs
from .voice_backend import Backend, Huella, elegir_backend
from .whatsapp import CANALES, ida_y_vuelta

DUR_OBJETIVO_S = 16.0
DUR_CORTA_S = 7.0
SILENCIO_S = 0.35
UMBRAL_REVISION = 0.60
UMBRAL_PROBABLE = 0.90
P_MAX_VOZ = 0.85
MAX_FALSOS_POR_100_DISTINTOS = 1.0  # restricción de diseño (la meta del reporte es <= 2 por 100 comparaciones)
SEED = 2026
COHORT_TOPK = 200  # igual que ML_SNORM_TOP_K del contenedor


@dataclass
class Audio:
    hablante: str
    nombre: str  # a1, a2, b1, b2, c1..c6
    canal: int
    frases: list[Path]
    wav: Path | None = None
    huella: Huella | None = None


def _armar_audios(hablante: slr73.Hablante, nombres_canales: list[tuple[str, int]], rng: random.Random,
                  usadas: set[Path], dur_objetivo: float = DUR_OBJETIVO_S) -> list[Audio]:
    disponibles = [f for f in hablante.archivos if f not in usadas]
    rng.shuffle(disponibles)
    out: list[Audio] = []
    for nombre, canal in nombres_canales:
        frases: list[Path] = []
        dur = 0.0
        while dur < dur_objetivo and disponibles:
            f = disponibles.pop()
            info = sf.info(str(f))
            frases.append(f)
            dur += info.frames / info.samplerate + SILENCIO_S
        usadas.update(frases)
        out.append(Audio(hablante=hablante.id, nombre=nombre, canal=canal, frases=frases))
    return out


def _render(a: Audio, seed: int) -> Path:
    out_dir = AUDIO_WHATSAPP_DIR / "slr73" / a.hablante
    wav16 = out_dir / f"{a.nombre}_canal{a.canal}.wav"
    if wav16.exists():
        a.wav = wav16
        return wav16
    out_dir.mkdir(parents=True, exist_ok=True)
    partes = []
    sr0 = None
    for f in a.frases:
        x, sr = sf.read(str(f), dtype="float32", always_2d=False)
        if x.ndim > 1:
            x = x.mean(axis=1)
        sr0 = sr0 or sr
        if sr != sr0:
            raise ValueError("frecuencias distintas dentro de un hablante")
        partes += [x, np.zeros(int(SILENCIO_S * sr), dtype=np.float32)]
    src = out_dir / f"{a.nombre}_fuente.wav"
    sf.write(str(src), np.concatenate(partes), sr0, subtype="PCM_16")
    ida_y_vuelta(src, wav16, a.canal, seed=seed)
    src.unlink(missing_ok=True)
    a.wav = wav16
    return wav16


def _norm(v: np.ndarray) -> np.ndarray:
    return v / max(float(np.linalg.norm(v)), 1e-12)


def _centroide(hs: list[Huella]) -> np.ndarray:
    segs = np.concatenate([h.segmentos for h in hs], axis=0)
    return _norm(segs.mean(axis=0))


# --------------------------------------------------------------------------------------------
# Calibración
# --------------------------------------------------------------------------------------------


def ajustar_logistica(s: np.ndarray, y: np.ndarray, prior: float = 0.5, iters: int = 100) -> tuple[float, float]:
    """Regresión logística ponderada de una variable por Newton. Devuelve (a, b) con p = σ(a(s − b))."""
    n1, n0 = max(int(y.sum()), 1), max(int((1 - y).sum()), 1)
    w = np.where(y == 1, prior / n1, (1 - prior) / n0)
    X = np.stack([s, np.ones_like(s)], axis=1)
    theta = np.array([10.0, -5.0])
    for _ in range(iters):
        z = X @ theta
        p = 1 / (1 + np.exp(-z))
        g = X.T @ (w * (p - y))
        H = (X * (w * p * (1 - p))[:, None]).T @ X + 1e-9 * np.eye(2)
        step = np.linalg.solve(H, g)
        theta = theta - step
        if np.abs(step).max() < 1e-10:
            break
    a, c = float(theta[0]), float(theta[1])
    return a, -c / a


def calibracion_gaussiana(tar: np.ndarray, non: np.ndarray) -> tuple[float, float]:
    """Logística a partir de las dos distribuciones de similitud (misma persona y distintas).

    Con cada clase modelada como normal N(mu, sigma), el log del cociente de verosimilitud es
    cuadrático en s. b es el punto entre las medias donde el cociente vale 1 (p = 0.5 con prior
    0.5) y a es la pendiente del log-cociente en ese punto. A diferencia de la regresión logística,
    no diverge cuando las clases están casi separadas.
    """
    m1, s1 = float(tar.mean()), float(tar.std(ddof=1))
    m0, s0 = float(non.mean()), float(non.std(ddof=1))
    A = -1 / (2 * s1**2) + 1 / (2 * s0**2)
    B = m1 / s1**2 - m0 / s0**2
    C = -(m1**2) / (2 * s1**2) + m0**2 / (2 * s0**2) + math.log(s0 / s1)
    if abs(A) < 1e-12:
        root = -C / B
    else:
        disc = max(B * B - 4 * A * C, 0.0)
        roots = [(-B + r) / (2 * A) for r in (math.sqrt(disc), -math.sqrt(disc))]
        dentro = [r for r in roots if min(m0, m1) <= r <= max(m0, m1)]
        root = dentro[0] if dentro else min(roots, key=lambda r: abs(r - (m0 + m1) / 2))
    return float(2 * A * root + B), float(root)


def logistic(s: np.ndarray | float, a: float, b: float):
    return 1 / (1 + np.exp(-a * (np.asarray(s) - b)))


def eer(tar: np.ndarray, non: np.ndarray) -> tuple[float, float]:
    """Tasa de error igual (FRR = FAR) y su umbral."""
    best_gap, best = 2.0, (1.0, 0.0, 0.0)
    for t in np.unique(np.concatenate([tar, non])):
        frr = float((tar < t).mean())
        far = float((non >= t).mean())
        if abs(frr - far) < best_gap:
            best_gap, best = abs(frr - far), (frr, far, float(t))
    return (best[0] + best[1]) / 2, best[2]


def operar(tar: np.ndarray, non: np.ndarray, a: float, b: float, p_max: float = P_MAX_VOZ) -> dict:
    pt = np.minimum(logistic(tar, a, b), p_max)
    pn = np.minimum(logistic(non, a, b), p_max)
    total = len(tar) + len(non)
    fp = int((pn >= UMBRAL_REVISION).sum())
    tp = int((pt >= UMBRAL_REVISION).sum())
    return {
        "comparaciones": total,
        "pares_misma_persona": len(tar),
        "pares_distintas": len(non),
        "verdaderos_sobre_umbral": tp,
        "falsos_sobre_umbral": fp,
        "recall_umbral_revision": tp / max(len(tar), 1),
        "falsos_por_100_comparaciones": 100 * fp / max(total, 1),
        "falsos_por_100_pares_distintos": 100 * fp / max(len(non), 1),
        "precision_sobre_umbral": tp / max(tp + fp, 1) if (tp + fp) else None,
    }


def histograma(x: np.ndarray, lo: float = -0.2, hi: float = 1.0, bins: int = 24) -> dict:
    h, edges = np.histogram(np.clip(x, lo, hi), bins=bins, range=(lo, hi))
    return {"bordes": [round(float(e), 3) for e in edges], "conteos": [int(c) for c in h]}


# --------------------------------------------------------------------------------------------
# S-norm con la cohorte
# --------------------------------------------------------------------------------------------


def snorm_stats(v: np.ndarray, cohort: np.ndarray, k: int = COHORT_TOPK) -> tuple[float, float]:
    sc = np.sort(cohort @ v)[::-1][: min(k, len(cohort))]
    return float(sc.mean()), float(sc.std() + 1e-6)


def snorm(e: np.ndarray, t: np.ndarray, cohort: np.ndarray) -> float:
    s = float(e @ t)
    me, se = snorm_stats(e, cohort)
    mt, st = snorm_stats(t, cohort)
    return 0.5 * ((s - me) / se + (s - mt) / st)


# --------------------------------------------------------------------------------------------


def _seleccion(hs: dict[str, slr73.Hablante], part: dict[str, list[str]]):
    """Selección determinista de frases. Ninguna frase se repite entre audios."""
    rng = random.Random(SEED)
    usadas: set[Path] = set()
    prueba = {h: _armar_audios(hs[h], [("a1", 1), ("a2", 1), ("b1", 2), ("b2", 2)], rng, usadas) for h in part["prueba"]}
    cohorte = {
        h: _armar_audios(hs[h], [("c1", 1), ("c2", 1), ("c3", 1), ("c4", 2), ("c5", 2), ("c6", 2)], rng, usadas)
        for h in part["cohorte"]
    }
    cortas = {h: _armar_audios(hs[h], [("s1", 2), ("s2", 2)], rng, usadas, dur_objetivo=DUR_CORTA_S) for h in part["prueba"]}
    return prueba, cohorte, cortas, usadas


def _identificar(ids: list[str], inscritos: dict[str, np.ndarray], probes: list[tuple[str, str, np.ndarray]],
                 cohort: np.ndarray) -> dict:
    E = np.stack([inscritos[h] for h in ids])
    top1 = top3 = top1_sn = top3_sn = 0
    detalle, tar, non, tar_sn, non_sn, tar_h, non_h = [], [], [], [], [], [], []
    for h, nombre, v in probes:
        scores = E @ v
        sns = np.array([snorm(inscritos[g], v, cohort) for g in ids])
        rank = [ids[k] for k in np.argsort(-scores)].index(h) + 1
        rank_sn = [ids[k] for k in np.argsort(-sns)].index(h) + 1
        top1 += rank == 1
        top3 += rank <= 3
        top1_sn += rank_sn == 1
        top3_sn += rank_sn <= 3
        detalle.append({
            "hablante": h, "prueba": nombre, "rank_coseno": rank, "rank_snorm": rank_sn,
            "coseno_correcto": round(float(scores[ids.index(h)]), 4),
            "coseno_mejor_distinto": round(float(max(s for g, s in zip(ids, scores) if g != h)), 4),
        })
        for g, sc, z in zip(ids, scores, sns):
            if g == h:
                tar.append(float(sc))
                tar_sn.append(float(z))
                tar_h.append(h)
            else:
                non.append(float(sc))
                non_sn.append(float(z))
                non_h.append(f"{h}|{g}")
    n = len(probes)
    return {
        "resumen": {"pruebas": n, "inscritos": len(ids), "top1": top1 / n, "top3": top3 / n,
                    "top1_snorm": top1_sn / n, "top3_snorm": top3_sn / n},
        "detalle": detalle,
        "tar": np.array(tar), "non": np.array(non), "tar_sn": np.array(tar_sn), "non_sn": np.array(non_sn),
        "tar_h": tar_h, "non_h": non_h,
    }


LOGIT_REV = math.log(UMBRAL_REVISION / (1 - UMBRAL_REVISION))


def proponer(tar: np.ndarray, non: np.ndarray) -> dict:
    """a y b de las distribuciones (gaussiana) y restricción de falsos vínculos sobre b."""
    a_g, b_g = calibracion_gaussiana(tar, non)
    s_q = float(np.quantile(non, 1 - MAX_FALSOS_POR_100_DISTINTOS / 100))
    b_r = s_q - LOGIT_REV / a_g
    return {"a": a_g, "b_gauss": b_g, "coseno_percentil": s_q, "b_restringido": b_r, "b": max(b_g, b_r)}


def _dist(x: np.ndarray) -> dict:
    return {"n": int(len(x)), "media": float(x.mean()), "std": float(x.std(ddof=1)), "min": float(x.min()),
            "max": float(x.max()), "p01": float(np.quantile(x, 0.01)), "p05": float(np.quantile(x, 0.05)),
            "p95": float(np.quantile(x, 0.95)), "p99": float(np.quantile(x, 0.99))}


def _render_y_embeber(audios: list[Audio], backend: Backend, seed0: int, etiqueta: str) -> None:
    print(f"{etiqueta}: armando {len(audios)} notas de voz simuladas")
    for j, a in enumerate(audios):
        _render(a, seed=seed0 + j)
    print(f"{etiqueta}: extrayendo huellas")
    for j, a in enumerate(audios):
        assert a.wav is not None
        a.huella = backend.embed(a.wav)
        if (j + 1) % 50 == 0:
            print(f"  {j + 1}/{len(audios)}")


def escenarios_voz(backend: Backend, hs: dict[str, slr73.Hablante], part: dict[str, list[str]], usadas: set[Path]) -> dict:
    """Huellas de los casos con voz de eval/data/escenarios.json (H01… = hablantes de prueba en orden)."""
    esc = json.loads((EVAL_DIR / "data" / "escenarios.json").read_text(encoding="utf-8"))
    orden = sorted(part["prueba"])
    rng = random.Random(SEED + 7)
    audios = []
    for c in esc["casos"]:
        if not c.get("voz"):
            continue
        h = orden[int(c["voz"]["hablante"][1:]) - 1]
        (a,) = _armar_audios(hs[h], [(c["id"], int(c["voz"]["canal"]))], rng, usadas)
        audios.append(a)
    _render_y_embeber(audios, backend, 5000, "escenarios")
    casos = {
        a.nombre: {
            "hablante": a.hablante, "canal": a.canal,
            "segmentos": int(len(a.huella.segmentos)),  # type: ignore[union-attr]
            "duracion_s": a.huella.duracion_s,  # type: ignore[union-attr]
            "centroid": a.huella.centroid.tolist(),  # type: ignore[union-attr]
        }
        for a in audios
    }
    out = {"backend": backend.nombre, "mapeo": {f"H{i + 1:02d}": h for i, h in enumerate(orden)}, "casos": casos}
    (RESULTS_DIR / "escenarios_voz.json").write_text(json.dumps(out), encoding="utf-8")
    return out


def run(backend_pref: str = "auto", out_json: Path | None = None) -> dict:
    ensure_dirs()
    t0 = time.time()
    backend: Backend = elegir_backend(backend_pref)
    print(f"backend de voz: {backend.nombre}")
    hs = slr73.hablantes()
    part = slr73.particion()
    prueba, cohorte, cortas, usadas = _seleccion(hs, part)

    todos = [a for lst in list(prueba.values()) + list(cohorte.values()) for a in lst]
    _render_y_embeber(todos, backend, 1000, "prueba y cohorte")
    cortos = [a for lst in cortas.values() for a in lst]
    _render_y_embeber(cortos, backend, 3000, "pruebas cortas")

    # Cohorte de referencia (s-norm): centroides de 6 audios por hablante de la cohorte
    cohort_vecs = np.stack([a.huella.centroid for lst in cohorte.values() for a in lst]).astype(np.float32)  # type: ignore[union-attr]
    np.save(EVAL_DIR / "cohort.npy", cohort_vecs)

    ids = sorted(prueba)
    inscritos = {h: _centroide([prueba[h][0].huella, prueba[h][1].huella]) for h in ids}  # type: ignore[list-item]
    principal = _identificar(ids, inscritos, [(h, a.nombre, a.huella.centroid) for h in ids for a in prueba[h][2:]], cohort_vecs)  # type: ignore[union-attr]
    corta = _identificar(ids, inscritos, [(h, a.nombre, a.huella.centroid) for h in ids for a in cortas[h]], cohort_vecs)  # type: ignore[union-attr]
    tar_a, non_a = principal["tar"], principal["non"]

    # Calibración: propuesta con todas las pruebas y validación cruzada por hablante (2 particiones)
    prop = proponer(tar_a, non_a)
    with np.errstate(over="ignore"):
        a_ml, b_ml = ajustar_logistica(np.concatenate([tar_a, non_a]), np.concatenate([np.ones(len(tar_a)), np.zeros(len(non_a))]))
    rng2 = random.Random(SEED + 1)
    mezcla = ids[:]
    rng2.shuffle(mezcla)
    folds = [set(mezcla[: len(mezcla) // 2]), set(mezcla[len(mezcla) // 2 :])]

    def sel(r: dict, fold: set[str]):
        ti = np.array([h in fold for h in r["tar_h"]])
        ni = np.array([x.split("|")[0] in fold and x.split("|")[1] in fold for x in r["non_h"]])
        return r["tar"][ti], r["non"][ni]

    cv = []
    for k in range(2):
        tr_t, tr_n = sel(principal, folds[k])
        te_t, te_n = sel(principal, folds[1 - k])
        pk = proponer(tr_t, tr_n)
        cv.append({"a": pk["a"], "b": pk["b"], "prueba": operar(te_t, te_n, pk["a"], pk["b"])})

    op = operar(tar_a, non_a, prop["a"], prop["b"])
    op_corta = operar(corta["tar"], corta["non"], prop["a"], prop["b"])
    eer_cos, thr_cos = eer(tar_a, non_a)
    eer_sn, thr_sn = eer(principal["tar_sn"], principal["non_sn"])
    eer_corta, _ = eer(corta["tar"], corta["non"])
    health = None
    if backend.nombre == "ml":
        try:
            health = backend.health()  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            health = None
    modelo = next(a.huella.modelo for a in todos if a.huella)  # type: ignore[union-attr]
    esc = escenarios_voz(backend, hs, part, usadas)

    res = {
        "estado": "ok",
        "backend": backend.nombre,
        "modelo": modelo,
        "ml_health": health,
        "dataset": {
            "nombre": "OpenSLR SLR73 (español de Perú)",
            "url": "https://www.openslr.org/73/",
            "licencia": "CC BY-SA 4.0",
            "hablantes_total": len(hs),
            "hablantes_prueba": len(ids),
            "hablantes_cohorte": len(part["cohorte"]),
            "cohorte": part["cohorte"],
            "duracion_objetivo_s": DUR_OBJETIVO_S,
            "duracion_corta_s": DUR_CORTA_S,
            "audios": len(todos) + len(cortos) + len(esc["casos"]),
            "duracion_media_s": float(np.mean([a.huella.duracion_s for a in todos])),  # type: ignore[union-attr]
            "duracion_media_corta_s": float(np.mean([a.huella.duracion_s for a in cortos])),  # type: ignore[union-attr]
        },
        "canales": {str(k): {"nombre": c.nombre, "filtros": c.filtros, "ruido": c.ruido_amplitud, "opus": c.bitrate}
                    for k, c in CANALES.items()},
        "protocolo": (
            "Por hablante: inscripción = centroide de 2 notas de voz (~16 s) por el canal 1; pruebas = 2 notas por el "
            "canal 2, comparadas contra todos los inscritos. Condición corta: 2 notas de ~7 s por el canal 2."
        ),
        "identificacion": principal["resumen"],
        "identificacion_corta": corta["resumen"],
        "verificacion": {
            "eer_coseno": eer_cos,
            "umbral_eer_coseno": thr_cos,
            "eer_snorm": eer_sn,
            "umbral_eer_snorm": thr_sn,
            "eer_coseno_corta": eer_corta,
            "coseno_misma_persona": _dist(tar_a),
            "coseno_distintas": _dist(non_a),
            "coseno_misma_persona_corta": _dist(corta["tar"]),
            "coseno_distintas_corta": _dist(corta["non"]),
            "hist_misma_persona": histograma(tar_a),
            "hist_distintas": histograma(non_a),
        },
        "calibracion": {
            "metodo": (
                "Gaussiana: cada distribución (misma persona, distintas) como normal; b = similitud donde el cociente de "
                "verosimilitud vale 1 y a = pendiente de su logaritmo en ese punto. Luego b sube si hace falta para dejar "
                f"como máximo {MAX_FALSOS_POR_100_DISTINTOS:g} falso por cada 100 pares distintos sobre el umbral de revisión."
            ),
            "propuesta": {"a": prop["a"], "b": prop["b"], "p_max": P_MAX_VOZ, "min_segmentos": 2},
            "detalle": prop,
            "regresion_logistica_referencia": {
                "a": a_ml, "b": b_ml,
                "nota": "Máxima verosimilitud con pesos balanceados. Con clases casi separables la pendiente crece sin límite; no se usa.",
            },
            "operacion": op,
            "operacion_corta": op_corta,
            "validacion_cruzada": cv,
        },
        "falsos_vinculos": {
            "umbral_revision": UMBRAL_REVISION,
            "definicion": (
                "Pares de personas distintas cuya probabilidad de voz calibrada (con p_max) alcanza el umbral de revisión, "
                "por cada 100 comparaciones (todas: misma persona y distintas). La voz sola nunca supera p_max = 0.85: "
                "no llega a 'probable' (0.90) y siempre pasa por revisión humana."
            ),
            "por_100_comparaciones": op["falsos_por_100_comparaciones"],
            "por_100_pares_distintos": op["falsos_por_100_pares_distintos"],
            "validacion_cruzada_por_100_comparaciones": float(np.mean([c["prueba"]["falsos_por_100_comparaciones"] for c in cv])),
            "recall_umbral_revision": op["recall_umbral_revision"],
            "recall_validacion_cruzada": float(np.mean([c["prueba"]["recall_umbral_revision"] for c in cv])),
            "corta_por_100_comparaciones": op_corta["falsos_por_100_comparaciones"],
            "corta_recall_umbral_revision": op_corta["recall_umbral_revision"],
        },
        "cohorte": {"archivo": "eval/cohort.npy", "vectores": int(cohort_vecs.shape[0]), "dim": int(cohort_vecs.shape[1]),
                    "hablantes": part["cohorte"], "audios_por_hablante": 6, "topk_snorm": COHORT_TOPK,
                    "backend": backend.nombre},
        "escenarios": {"casos_con_voz": len(esc["casos"]), "mapeo": esc["mapeo"]},
        "detalle_pruebas": principal["detalle"],
        "detalle_pruebas_cortas": corta["detalle"],
        "segundos": round(time.time() - t0, 1),
    }
    out = out_json or (RESULTS_DIR / "voz.json")
    out.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: res[k] for k in ("backend", "identificacion", "identificacion_corta", "falsos_vinculos")}, indent=2, ensure_ascii=False))
    print(f"calibración propuesta: a={prop['a']:.2f} b={prop['b']:.4f} (gaussiana b={prop['b_gauss']:.4f}); resultados en {out}")
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["auto", "ml", "local"], default="auto")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    run(a.backend, a.out)


if __name__ == "__main__":
    main()
