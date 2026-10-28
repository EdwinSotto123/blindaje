from __future__ import annotations

import base64
import io

import numpy as np
import pytest

from blindaje_ml import voice
from blindaje_ml.voice import Turn

from .conftest import FakeVoice, needs_ffmpeg, silence, to_wav, tone


def test_split_span_rules():
    assert voice.split_span(0, 2_999) == []
    assert voice.split_span(0, 3_000) == [(0, 3_000)]
    assert voice.split_span(0, 6_000) == [(0, 6_000)]
    parts = voice.split_span(1_000, 14_000)  # 13 s -> 3 ventanas de 4.33 s
    assert len(parts) == 3
    assert parts[0][0] == 1_000 and parts[-1][1] == 14_000
    for s, e in parts:
        assert 3_000 <= e - s <= 6_000
    for dur in range(3_000, 60_000, 137):
        for s, e in voice.split_span(0, dur):
            assert 3_000 <= e - s <= 6_000


def test_windows_over_whole_audio():
    assert voice.windows_over(2_000) == []
    assert voice.windows_over(9_000) == [(0, 3_000), (3_000, 6_000), (6_000, 9_000)]
    # El sobrante se suma a la última ventana.
    assert voice.windows_over(10_500)[-1] == (6_000, 10_500)


def test_merge_turns_joins_close_same_speaker():
    turns = [Turn("A", 0, 1_500), Turn("A", 1_800, 3_600), Turn("B", 4_000, 9_000), Turn("A", 9_100, 10_000)]
    spans = voice.merge_turns(turns, 10_000)
    assert spans["A"] == [(0, 3_600), (9_100, 10_000)]
    assert spans["B"] == [(4_000, 9_000)]


def test_merge_turns_clips_to_audio():
    spans = voice.merge_turns([Turn("A", 0, 99_000)], 5_000)
    assert spans["A"] == [(0, 5_000)]


def test_silence_windows_are_dropped():
    wave = np.concatenate([tone(200, 6.0), silence(6.0)])
    plan = voice.plan_segments(wave, None)
    assert [(s.start_ms, s.end_ms) for s in plan["A"]] == [(0, 3_000), (3_000, 6_000)]


def test_embed_speakers_with_turns_and_victim_exclusion():
    emb = FakeVoice()
    # Víctima a 500 Hz (0-4 s), extorsionador a 1200 Hz (4-16 s), turno corto de la víctima al final.
    wave = np.concatenate([tone(500, 4.0), tone(1200, 12.0), tone(500, 2.0)])
    victim = emb.embed([tone(500, 3.0)])[0].tolist()
    turns = [Turn("S1", 0, 4_000), Turn("S2", 4_000, 16_000), Turn("S1", 16_000, 18_000)]
    speakers, skipped = voice.embed_speakers(wave, turns, emb, [victim], 0.6)
    by = {s.speaker: s for s in speakers}
    assert set(by) == {"S1", "S2"} and skipped == []
    assert by["S1"].excluded and by["S1"].victim_similarity > 0.9
    assert not by["S2"].excluded and by["S2"].victim_similarity < 0.3
    assert len(by["S2"].segments) == 2  # 12 s -> 2 ventanas de 6 s
    assert all(not s.excluded for s in by["S2"].segments)
    np.testing.assert_allclose(np.linalg.norm(by["S2"].centroid), 1.0, atol=1e-5)


def test_embed_speakers_without_turns_drops_victim_segments():
    emb = FakeVoice()
    wave = np.concatenate([tone(1200, 9.0), tone(500, 3.0)])  # sin diarización: todo es "A"
    victim = emb.embed([tone(500, 3.0)])[0].tolist()
    speakers, _ = voice.embed_speakers(wave, None, emb, [victim], 0.6)
    (a,) = speakers
    assert a.speaker == "A" and not a.excluded
    assert [s.excluded for s in a.segments] == [False, False, False, True]
    # El centroide no incluye el segmento de la víctima.
    expected = emb.embed([tone(1200, 3.0)])[0]
    assert float(a.centroid @ expected) > 0.99


def test_embed_speakers_short_speaker_is_skipped():
    emb = FakeVoice()
    wave = np.concatenate([tone(1200, 6.0), tone(700, 2.0)])
    speakers, skipped = voice.embed_speakers(wave, [Turn("A", 0, 6_000), Turn("B", 6_000, 8_000)], emb)
    assert [s.speaker for s in speakers] == ["A"]
    assert skipped == [{"speaker": "B", "reason": "sin_segmentos_de_3s"}]
    assert speakers[0].victim_similarity is None and not speakers[0].excluded


def test_embed_route(client):
    emb = FakeVoice()
    wave = np.concatenate([tone(500, 3.5), tone(1500, 8.0)])
    victim = emb.embed([tone(500, 3.0)])[0].tolist()
    r = client.post(
        "/voice/embed",
        json={
            "wav_b64": base64.b64encode(to_wav(wave)).decode(),
            "turns": [{"speaker": "A", "startMs": 0, "endMs": 3_500}, {"speaker": "B", "start_ms": 3_500,
                                                                         "end_ms": 11_500}],
            "exclude_vectors": [victim],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dim"] == 192
    sp = {s["speaker"]: s for s in body["speakers"]}
    assert sp["A"]["excluded"] is True
    assert sp["B"]["excluded"] is False
    assert sp["B"]["n_segments"] == 2
    assert len(sp["B"]["centroid"]) == 192
    assert {"start_ms", "end_ms", "vector"} <= set(sp["B"]["segments"][0])
    assert sp["B"]["duration_sec"] == pytest.approx(8.0, abs=0.01)


def test_embed_route_rejects_wrong_exclude_dim(client):
    r = client.post(
        "/voice/embed",
        json={"wav_b64": base64.b64encode(to_wav(tone(300, 4))).decode(), "exclude_vectors": [[1.0, 0.0]]},
    )
    assert r.status_code == 422
    assert r.json()["error"] == "exclude_vectors_dim"


@needs_ffmpeg
def test_enroll_route(client):
    r = client.post("/voice/enroll", content=to_wav(tone(500, 10.0)))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dim"] == 192 and len(body["vector"]) == 192
    assert body["n_segments"] == 3
    assert np.linalg.norm(body["vector"]) == pytest.approx(1.0, abs=1e-5)


@needs_ffmpeg
def test_enroll_too_short(client):
    r = client.post("/voice/enroll", content=to_wav(tone(500, 2.0)))
    assert r.status_code == 422
    assert r.json()["error"] == "audio_too_short"


def test_compare_without_cohort(client):
    r = client.post("/voice/compare", json={"a": [1, 0, 0], "b": [1, 1, 0]})
    assert r.status_code == 200
    body = r.json()
    assert body["cosine"] == pytest.approx(0.707107, abs=1e-5)
    assert body["snorm"] is None


def test_compare_with_cohort_upload(client):
    rng = np.random.default_rng(7)
    cohort = rng.standard_normal((300, 192)).astype(np.float32)
    buf = io.BytesIO()
    np.save(buf, cohort)
    r = client.post("/voice/cohort", content=buf.getvalue())
    assert r.status_code == 200 and r.json()["size"] == 300
    assert client.get("/health").json()["cohort"]["size"] == 300

    a = rng.standard_normal(192)
    same = a + 0.1 * rng.standard_normal(192)
    other = rng.standard_normal(192)
    s_same = client.post("/voice/compare", json={"a": a.tolist(), "b": same.tolist()}).json()
    s_other = client.post("/voice/compare", json={"a": a.tolist(), "b": other.tolist()}).json()
    assert s_same["snorm"] is not None and s_other["snorm"] is not None
    assert s_same["snorm"] > 5 > s_other["snorm"]
    assert s_same["cohort_size"] == 300


def test_cohort_file_is_picked_up_after_start(tmp_path):
    path = tmp_path / "cohort.npy"
    c = voice.Cohort(path)
    assert c.matrix() is None
    np.save(path, np.eye(4, dtype=np.float32))
    assert c.size() == 4
