"""Grafo de casos y señales para el Cartógrafo (sección 10.3 del documento de diseño).

- Comunidades: Louvain (networkx) con semilla fija sobre la proyección en los casos: dos casos
  quedan unidos si tienen una arista directa (vínculo confirmado) o comparten una señal (huella,
  identificador, frase, imagen). Si no hay nodos de tipo caso, Louvain corre sobre todo el grafo.
- Centralidad: intermediación normalizada y grado (número de vecinos) sobre el grafo completo.
"""

from __future__ import annotations

from itertools import combinations

import networkx as nx

LOUVAIN_SEED = 42
CASE_TYPES = {"caso", "case"}
BETWEENNESS_EXACT_MAX_NODES = 2_000


def build_graph(nodes: list[dict], edges: list[dict]) -> nx.Graph:
    g = nx.Graph()
    for n in sorted(nodes, key=lambda n: str(n["id"])):
        g.add_node(str(n["id"]), type=str(n.get("type") or "").lower())
    for e in sorted(edges, key=lambda e: (str(e["source"]), str(e["target"]))):
        s, t = str(e["source"]), str(e["target"])
        if s == t:
            continue
        for x in (s, t):
            if x not in g:
                g.add_node(x, type="")
        w = float(e.get("weight") if e.get("weight") is not None else 1.0)
        if g.has_edge(s, t):
            g[s][t]["weight"] += w
        else:
            g.add_edge(s, t, weight=w)
    return g


def project_cases(g: nx.Graph) -> nx.Graph:
    cases = sorted(n for n, d in g.nodes(data=True) if d.get("type") in CASE_TYPES)
    p = nx.Graph()
    p.add_nodes_from(cases)
    case_set = set(cases)
    for u, v, d in g.edges(data=True):
        if u in case_set and v in case_set:
            _bump(p, u, v, d["weight"])
    for s in sorted(n for n in g.nodes if n not in case_set):
        nbrs = sorted(n for n in g.neighbors(s) if n in case_set)
        for u, v in combinations(nbrs, 2):
            _bump(p, u, v, min(g[s][u]["weight"], g[s][v]["weight"]))
    return p


def _bump(g: nx.Graph, u: str, v: str, w: float) -> None:
    if g.has_edge(u, v):
        g[u][v]["weight"] += w
    else:
        g.add_edge(u, v, weight=w)


def analyze(nodes: list[dict], edges: list[dict]) -> dict:
    g = build_graph(nodes, edges)
    if g.number_of_nodes() == 0:
        return {"communities": [], "centrality": {}, "degree": {}, "membership": {}}
    has_cases = any(d.get("type") in CASE_TYPES for _, d in g.nodes(data=True))
    target = project_cases(g) if has_cases else g
    comms = nx.community.louvain_communities(target, weight="weight", seed=LOUVAIN_SEED)
    communities = sorted((sorted(c) for c in comms), key=lambda c: (-len(c), c[0]))

    membership: dict[str, int] = {n: i for i, c in enumerate(communities) for n in c}
    # Señales: a la comunidad con más casos vecinos (empate: la de menor índice).
    for n in sorted(g.nodes):
        if n in membership:
            continue
        votes: dict[int, float] = {}
        for m in g.neighbors(n):
            if m in membership:
                votes[membership[m]] = votes.get(membership[m], 0.0) + g[n][m]["weight"]
        if votes:
            membership[n] = min(votes, key=lambda i: (-votes[i], i))

    if g.number_of_nodes() > BETWEENNESS_EXACT_MAX_NODES:
        bc = nx.betweenness_centrality(g, k=500, normalized=True, seed=LOUVAIN_SEED)
    else:
        bc = nx.betweenness_centrality(g, normalized=True)
    return {
        "communities": communities,
        "centrality": {n: round(float(v), 6) for n, v in sorted(bc.items())},
        "degree": {n: int(d) for n, d in sorted(g.degree())},
        "membership": dict(sorted(membership.items())),
    }
