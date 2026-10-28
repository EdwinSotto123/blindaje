from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from blindaje_ml.models import Registry


def test_model_loads_are_serialized_and_loaded_once():
    active, peak, calls = 0, 0, {"voice": 0, "text": 0, "image": 0}
    guard = threading.Lock()

    def factory(key):
        def build():
            nonlocal active, peak
            with guard:
                active += 1
                peak = max(peak, active)
                calls[key] += 1
            time.sleep(0.05)
            with guard:
                active -= 1
            return object()

        return build

    reg = Registry({k: factory(k) for k in calls})
    with ThreadPoolExecutor(12) as ex:
        list(ex.map(reg.get, ["voice", "text", "image"] * 4))
    assert peak == 1  # nunca dos cargas a la vez
    assert calls == {"voice": 1, "text": 1, "image": 1}
    assert all(s["loaded"] for s in reg.status().values())
