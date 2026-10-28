"""Llama Prompt Guard 2 de Meta: detecta intentos de inyección de instrucciones en el texto de la
evidencia (mensajes que pega la víctima, transcripciones) antes de que lo lean los agentes.

Clasificador binario (benigno / malicioso) con contexto de 512 tokens. Un texto más largo se parte en
ventanas de 512 tokens (con los especiales) que se solapan 64 tokens; el puntaje del texto es la
probabilidad máxima de "malicioso" entre sus ventanas. La etiqueta usa el umbral calibrado
(`ML_PROMPT_GUARD_THRESHOLD`, ver docs/ML_API.md).

Pesos: `meta-llama/Llama-Prompt-Guard-2-*` (Llama 4 Community License, repositorio con acceso
restringido). Se descargan en el host con un token y se hornean en la imagen junto a la licencia y el
aviso (NOTICE); el contenedor nunca descarga nada.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from .config import get_settings
from .models import ModelUnavailable, _torch

MAX_TOKENS = 512
OVERLAP = 64


class PromptGuardUnavailable(ModelUnavailable):
    """Faltan los pesos de Prompt Guard (o el extra `models`): la API responde 503."""


def token_windows(n: int, size: int, overlap: int) -> list[tuple[int, int]]:
    """Ventanas [a, b) de a lo más `size` tokens que cubren n tokens, solapadas `overlap`. La última
    se alinea al final para que también tenga `size` tokens de contexto."""
    if n <= 0:
        return []
    if n <= size:
        return [(0, n)]
    step = max(1, size - overlap)
    out = []
    start = 0
    while start + size < n:
        out.append((start, start + size))
        start += step
    out.append((n - size, n))
    return out


class PromptGuard:
    max_tokens = MAX_TOKENS
    overlap = OVERLAP
    batch_size = 8

    def __init__(self) -> None:
        torch = _torch()
        s = get_settings()
        src = s.prompt_guard_dir
        if not (src / "config.json").exists() or not (src / "model.safetensors").exists():
            raise ModelUnavailable("prompt_guard_weights_missing")
        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as e:
            raise ModelUnavailable("transformers_not_installed") from e
        # Tokenizar un texto largo sin truncar avisa que pasa de 512 tokens: aquí se parte en ventanas.
        logging.getLogger("transformers.tokenization_utils_base").setLevel(logging.ERROR)
        self._torch = torch
        self._tok = AutoTokenizer.from_pretrained(str(src))
        self._model = AutoModelForSequenceClassification.from_pretrained(str(src)).eval()
        self.name = s.prompt_guard_model
        labels = {int(k): str(v).upper() for k, v in self._model.config.id2label.items()}
        self.malicious_index = next(
            (i for i, lab in sorted(labels.items()) if any(x in lab for x in ("MALICIOUS", "INJECTION", "JAILBREAK"))),
            max(labels) if labels else 1,
        )
        self._pad = self._tok.pad_token_id if self._tok.pad_token_id is not None else 0
        # Las ventanas se arman con [CLS] ids [SEP] a mano (los tokenizadores rápidos de transformers 5
        # no tienen build_inputs_with_special_tokens). Se comprueba que coincida con el tokenizador.
        probe = "Pagarás 2,000 soles por Yape."
        if self._wrap(self._tok(probe, add_special_tokens=False)["input_ids"]) != list(self._tok(probe)["input_ids"]):
            raise ModelUnavailable("prompt_guard_tokenizer_mismatch")
        self._specials = len(self._wrap([]))
        self._lock = threading.Lock()

    def _wrap(self, ids: list[int]) -> list[int]:
        cls, sep = self._tok.cls_token_id, self._tok.sep_token_id
        return ([cls] if cls is not None else []) + list(ids) + ([sep] if sep is not None else [])

    def windows(self, text: str) -> list[list[int]]:
        """Ids (con tokens especiales) de cada ventana del texto. Texto vacío: ninguna."""
        if not text or not text.strip():
            return []
        ids = self._tok(text, add_special_tokens=False, truncation=False)["input_ids"]
        size = self.max_tokens - self._specials
        return [self._wrap(ids[a:b]) for a, b in token_windows(len(ids), size, self.overlap)]

    def score(self, texts: list[str]) -> list[dict[str, Any]]:
        """Por texto: `score` = probabilidad máxima de "malicioso" entre sus ventanas y `chunks`."""
        torch = self._torch
        items: list[tuple[int, list[int]]] = []
        counts = [0] * len(texts)
        for i, t in enumerate(texts):
            for ids in self.windows(t):
                items.append((i, ids))
                counts[i] += 1
        scores = [0.0] * len(texts)
        order = sorted(range(len(items)), key=lambda k: len(items[k][1]))  # poco relleno por lote
        with self._lock, torch.inference_mode():
            for start in range(0, len(order), self.batch_size):
                idx = order[start : start + self.batch_size]
                n = max(len(items[k][1]) for k in idx)
                input_ids = torch.full((len(idx), n), self._pad, dtype=torch.long)
                mask = torch.zeros((len(idx), n), dtype=torch.long)
                for r, k in enumerate(idx):
                    ids = items[k][1]
                    input_ids[r, : len(ids)] = torch.tensor(ids, dtype=torch.long)
                    mask[r, : len(ids)] = 1
                logits = self._model(input_ids=input_ids, attention_mask=mask).logits.float()
                probs = torch.softmax(logits, dim=-1)[:, self.malicious_index].tolist()
                for r, k in enumerate(idx):
                    i = items[k][0]
                    scores[i] = max(scores[i], float(probs[r]))
        return [{"score": scores[i], "chunks": counts[i]} for i in range(len(texts))]
