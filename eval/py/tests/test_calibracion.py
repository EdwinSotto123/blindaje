import math

import numpy as np

from blindaje_eval.voice_eval import ajustar_logistica, calibracion_gaussiana, eer, logistic, operar, proponer


def test_gaussiana_misma_varianza_cruza_en_el_punto_medio():
    rng = np.random.default_rng(0)
    tar = rng.normal(0.7, 0.05, 20000)
    non = rng.normal(0.3, 0.05, 20000)
    a, b = calibracion_gaussiana(tar, non)
    assert abs(b - 0.5) < 0.005
    # pendiente analítica: (mu1 - mu0) / sigma^2 = 0.4 / 0.0025 = 160
    assert abs(a - 160) / 160 < 0.05


def test_gaussiana_no_diverge_con_clases_separadas():
    tar = np.linspace(0.65, 0.85, 50)
    non = np.linspace(0.0, 0.55, 500)
    a, b = calibracion_gaussiana(tar, non)
    assert 0.55 < b < 0.65
    assert math.isfinite(a) and 0 < a < 1000
    with np.errstate(over="ignore"):
        a_ml, _ = ajustar_logistica(np.concatenate([tar, non]), np.concatenate([np.ones(50), np.zeros(500)]))
    assert a_ml > a  # la máxima verosimilitud se dispara; por eso no se usa


def test_restriccion_de_falsos_vinculos():
    rng = np.random.default_rng(1)
    tar = rng.normal(0.75, 0.05, 200)
    non = rng.normal(0.30, 0.15, 5000)
    p = proponer(tar, non)
    op = operar(tar, non, p["a"], p["b"])
    assert op["falsos_por_100_pares_distintos"] <= 1.0 + 1e-9
    assert p["b"] >= p["b_gauss"]


def test_logistica_y_eer():
    assert abs(float(logistic(0.6, 50, 0.6)) - 0.5) < 1e-9
    e, _ = eer(np.array([0.9, 0.8, 0.7]), np.array([0.1, 0.2, 0.3]))
    assert e == 0.0
