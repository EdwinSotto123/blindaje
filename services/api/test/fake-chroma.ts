import type { ChromaConfig, ChromaFetch } from "../src/vectors/chroma";

/**
 * Chroma Cloud falso, en memoria: las mismas rutas de la API REST v2 que usa `ChromaClient`, con
 * búsqueda exacta por coseno. Determinista; nunca sale a la red.
 */

export const FAKE_CHROMA_CONFIG: ChromaConfig = {
  url: "https://chroma.prueba.blindaje.test",
  apiKey: "ck-prueba-no-es-real",
  tenant: "tenant-de-prueba",
  database: "blindaje",
};

interface Record_ {
  embedding: number[];
  metadata: Record<string, unknown>;
}

interface Collection {
  id: string;
  name: string;
  space: string;
  records: Map<string, Record_>;
}

function cosine(a: number[], b: number[]): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export class FakeChroma {
  readonly collections = new Map<string, Collection>();
  /** Peticiones recibidas (método y ruta sin el tenant), para revisar qué hizo el cliente. */
  readonly calls: string[] = [];
  /** Si es true, toda consulta responde 503. */
  failQueries = false;
  private seq = 0;

  byName(name: string): Collection | undefined {
    return this.collections.get(name);
  }

  ids(name: string): string[] {
    return [...(this.byName(name)?.records.keys() ?? [])].sort((a, b) => Number(a) - Number(b));
  }

  private byId(id: string): Collection | undefined {
    return [...this.collections.values()].find((c) => c.id === id);
  }

  readonly fetch: ChromaFetch = async (input, init) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    if (headers.get("x-chroma-token") !== FAKE_CHROMA_CONFIG.apiKey) return Response.json({ error: "unauthorized" }, { status: 401 });
    const path = url.pathname;
    this.calls.push(`${method} ${path.replace(FAKE_CHROMA_CONFIG.tenant, "<t>")}`);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (path === "/api/v2/heartbeat") return Response.json({ "nanosecond heartbeat": 1 });

    const prefix = `/api/v2/tenants/${FAKE_CHROMA_CONFIG.tenant}/databases/${FAKE_CHROMA_CONFIG.database}/collections`;
    if (!path.startsWith(prefix)) return Response.json({ error: "not_found" }, { status: 404 });
    const rest = path.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);

    if (rest.length === 0 && method === "POST") {
      let col = this.byName(body.name);
      if (!col) {
        col = { id: `col-${++this.seq}`, name: body.name, space: body.configuration?.spann?.space ?? "l2", records: new Map() };
        this.collections.set(body.name, col);
      }
      return Response.json({ id: col.id, name: col.name, configuration_json: { spann: { space: col.space } } });
    }
    if (rest.length === 1 && method === "GET") {
      const col = this.byName(rest[0]!) ?? this.byId(rest[0]!);
      return col ? Response.json({ id: col.id, name: col.name }) : Response.json({ error: "not_found" }, { status: 404 });
    }
    const col = this.byId(rest[0]!);
    if (!col) return Response.json({ error: "not_found" }, { status: 404 });
    switch (`${method} ${rest[1]}`) {
      case "POST upsert":
        body.ids.forEach((id: string, i: number) => col.records.set(id, { embedding: body.embeddings[i], metadata: body.metadatas?.[i] ?? {} }));
        return Response.json({});
      case "POST delete":
        for (const id of body.ids) col.records.delete(id);
        return Response.json({});
      case "GET count":
        return Response.json(col.records.size);
      case "POST get": {
        const all = [...col.records.keys()];
        return Response.json({ ids: all.slice(body.offset ?? 0, (body.offset ?? 0) + (body.limit ?? all.length)) });
      }
      case "POST query": {
        if (this.failQueries) return Response.json({ error: "unavailable" }, { status: 503 });
        const q = body.query_embeddings[0] as number[];
        const ranked = [...col.records.entries()]
          .map(([id, r]) => ({ id, d: 1 - cosine(q, r.embedding) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, body.n_results);
        return Response.json({ ids: [ranked.map((r) => r.id)], distances: [ranked.map((r) => r.d)] });
      }
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  };
}
