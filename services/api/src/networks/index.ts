import type { Env } from "../env";
import { sha256Hex } from "../lib/crypto";
import { newId, nowIso } from "../lib/ids";
import { nextCounter } from "../lib/db";
import { log } from "../lib/log";

/**
 * Redes = componentes conexos de casos unidos por vínculos CONFIRMADOS por una persona revisora.
 * Se calculan en el Worker con union-find. Las comunidades (Louvain) y la centralidad dentro de
 * cada red las calcula el contenedor ML (/graph/analyze) para el Cartógrafo.
 */

export class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: string): string {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Compresión de caminos.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const ka = this.rank.get(ra)!;
    const kb = this.rank.get(rb)!;
    if (ka < kb) this.parent.set(ra, rb);
    else if (ka > kb) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, ka + 1);
    }
  }

  /** Componentes con al menos `minSize` elementos, cada uno ordenado, ordenados entre sí. */
  components(minSize = 2): string[][] {
    const groups = new Map<string, string[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      const g = groups.get(r) ?? [];
      g.push(x);
      groups.set(r, g);
    }
    return [...groups.values()]
      .filter((g) => g.length >= minSize)
      .map((g) => g.sort())
      .sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  }
}

export function connectedComponents(edges: Array<[string, string]>, minSize = 2): string[][] {
  const uf = new UnionFind();
  for (const [a, b] of edges) uf.union(a, b);
  return uf.components(minSize);
}

export interface RecomputeResult {
  networks: number;
  created: string[];
  updated: string[];
  deleted: string[];
}

/** Recalcula las redes desde los vínculos confirmados y conserva los ids de redes existentes. */
export async function recomputeNetworks(env: Env): Promise<RecomputeResult> {
  const [linksRes, membersRes] = await env.DB.batch([
    env.DB.prepare("SELECT case_a, case_b FROM links WHERE status = 'confirmado'"),
    env.DB.prepare("SELECT network_id, case_id FROM network_cases"),
  ]);
  const edges = (linksRes!.results as Array<{ case_a: string; case_b: string }>).map((l) => [l.case_a, l.case_b] as [string, string]);
  const components = connectedComponents(edges);

  const existing = new Map<string, Set<string>>();
  for (const m of membersRes!.results as Array<{ network_id: string; case_id: string }>) {
    const s = existing.get(m.network_id) ?? new Set<string>();
    s.add(m.case_id);
    existing.set(m.network_id, s);
  }
  const allNetworks = await env.DB.prepare("SELECT id FROM networks").all<{ id: string }>();
  for (const n of allNetworks.results) if (!existing.has(n.id)) existing.set(n.id, new Set());

  // Asignación codiciosa por mayor solapamiento: una red existente conserva su id.
  const candidates: Array<{ comp: number; net: string; overlap: number }> = [];
  components.forEach((comp, i) => {
    for (const [net, cases] of existing) {
      const overlap = comp.filter((c) => cases.has(c)).length;
      if (overlap > 0) candidates.push({ comp: i, net, overlap });
    }
  });
  candidates.sort((a, b) => b.overlap - a.overlap);
  const compToNet = new Map<number, string>();
  const usedNets = new Set<string>();
  for (const c of candidates) {
    if (compToNet.has(c.comp) || usedNets.has(c.net)) continue;
    compToNet.set(c.comp, c.net);
    usedNets.add(c.net);
  }

  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const result: RecomputeResult = { networks: components.length, created: [], updated: [], deleted: [] };

  for (let i = 0; i < components.length; i++) {
    const comp = components[i]!;
    const key = (await sha256Hex(comp.join(","))).slice(0, 32);
    const netId = compToNet.get(i);
    if (netId) {
      const prev = existing.get(netId)!;
      const same = prev.size === comp.length && comp.every((c) => prev.has(c));
      if (same) continue;
      stmts.push(env.DB.prepare("DELETE FROM network_cases WHERE network_id = ?").bind(netId));
      for (const c of comp) stmts.push(env.DB.prepare("INSERT INTO network_cases (network_id, case_id) VALUES (?, ?)").bind(netId, c));
      stmts.push(
        env.DB.prepare("UPDATE networks SET n_casos = ?, community_key = ?, updated_at = ? WHERE id = ?").bind(comp.length, key, now, netId),
      );
      result.updated.push(netId);
    } else {
      const id = newId();
      const num = await nextCounter(env, "network");
      stmts.push(
        env.DB.prepare("INSERT INTO networks (id, num, n_casos, community_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
          id,
          num,
          comp.length,
          key,
          now,
          now,
        ),
      );
      for (const c of comp) stmts.push(env.DB.prepare("INSERT INTO network_cases (network_id, case_id) VALUES (?, ?)").bind(id, c));
      result.created.push(id);
    }
  }
  for (const net of existing.keys()) {
    if (!usedNets.has(net)) {
      stmts.push(env.DB.prepare("DELETE FROM networks WHERE id = ?").bind(net));
      result.deleted.push(net);
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  if (result.created.length || result.updated.length || result.deleted.length) {
    log("info", "networks_recomputed", {
      networks: result.networks,
      created: result.created.length,
      updated: result.updated.length,
      deleted: result.deleted.length,
    });
  }
  return result;
}
