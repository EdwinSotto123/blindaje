from __future__ import annotations

from blindaje_ml import graph


def _red():
    nodes = [{"id": c, "type": "caso"} for c in ["A", "B", "C", "D", "E", "F"]]
    nodes += [
        {"id": "V-3", "type": "huella"},
        {"id": "ID-aaa111", "type": "identificador"},
        {"id": "ID-bbb222", "type": "identificador"},
        {"id": "F-1", "type": "frase"},
    ]
    edges = [
        # Red 1: A, B, C comparten la voz V-3 y la cuenta ID-aaa111.
        {"source": "A", "target": "V-3"},
        {"source": "B", "target": "V-3"},
        {"source": "C", "target": "V-3"},
        {"source": "A", "target": "ID-aaa111"},
        {"source": "B", "target": "ID-aaa111"},
        {"source": "A", "target": "B", "weight": 0.95},
        # Red 2: D, E, F comparten otra cuenta y una frase.
        {"source": "D", "target": "ID-bbb222"},
        {"source": "E", "target": "ID-bbb222"},
        {"source": "F", "target": "ID-bbb222"},
        {"source": "E", "target": "F-1"},
        {"source": "F", "target": "F-1"},
    ]
    return nodes, edges


def test_two_networks():
    nodes, edges = _red()
    out = graph.analyze(nodes, edges)
    assert sorted(out["communities"]) == [["A", "B", "C"], ["D", "E", "F"]]
    assert out["degree"]["V-3"] == 3
    assert out["degree"]["A"] == 3
    m = out["membership"]
    assert m["V-3"] == m["A"] and m["ID-bbb222"] == m["D"] and m["A"] != m["D"]
    # La señal compartida por tres casos es la más central de su red.
    assert out["centrality"]["V-3"] > out["centrality"]["C"]


def test_deterministic():
    nodes, edges = _red()
    a = graph.analyze(nodes, edges)
    b = graph.analyze(list(reversed(nodes)), list(reversed(edges)))
    assert a == b


def test_without_case_nodes_runs_on_full_graph():
    out = graph.analyze(
        [{"id": "x"}, {"id": "y"}, {"id": "z"}],
        [{"source": "x", "target": "y"}, {"source": "y", "target": "z"}],
    )
    assert sum(len(c) for c in out["communities"]) == 3
    assert out["centrality"]["y"] == 1.0


def test_empty_and_isolated():
    assert graph.analyze([], []) == {"communities": [], "centrality": {}, "degree": {}, "membership": {}}
    out = graph.analyze([{"id": "A", "type": "caso"}], [])
    assert out["communities"] == [["A"]]


def test_route(client):
    nodes, edges = _red()
    r = client.post("/graph/analyze", json={"nodes": nodes, "edges": edges})
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"communities", "centrality", "degree"}
    assert len(body["communities"]) == 2
