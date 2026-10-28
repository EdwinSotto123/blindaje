import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { NetworkView } from "@blindaje/shared";
import { setMlClientForTests, type MlClient } from "../src/ml/client";
import { analyzeGraph, betweenness, buildGraph, loadNetworkData, territorialStats } from "../src/networks";
import { apiJson, loginAs } from "./helpers";
import { seedNetwork } from "./agents-helpers";

afterEach(() => setMlClientForTests(null));

describe("grafo de redes", () => {
  it("tiene nodos de los cinco tipos, aristas caso–señal y vínculo, y evidencia en voz e imagen", async () => {
    const net = await seedNetwork({ n: 3 });
    const graph = await buildGraph(await loadNetworkData(env, net.networkId));
    expect(new Set(graph.nodes.map((n) => n.type))).toEqual(new Set(["caso", "voz", "identificador", "imagen", "frase"]));
    expect(graph.edges.filter((e) => e.type === "vinculo")).toHaveLength(2);
    const voz = graph.nodes.find((n) => n.label === `V-${net.voices[0]}`)!;
    expect(voz.data).toMatchObject({ evidencia: [net.cases[0]!.evidence[0]!.label] });
    const img = graph.nodes.find((n) => n.type === "imagen")!;
    expect(img.data).toMatchObject({ concept: "bala", evidencia: [net.cases[0]!.evidence[1]!.label] });
    // La frase "habla con el jefe" es un solo nodo unido a los tres casos.
    const frase = graph.nodes.find((n) => n.type === "frase" && n.label === "habla con el jefe")!;
    expect(graph.edges.filter((e) => e.target === frase.id)).toHaveLength(3);
    const ident = graph.nodes.find((n) => n.type === "identificador")!;
    expect(ident.label).toBe(net.identifier);
    expect(JSON.stringify(graph)).not.toContain(net.devices[0]!.pseudonym);
  });

  it("usa el ML para comunidades y centralidad, y el Worker si el ML no responde", async () => {
    const net = await seedNetwork({ n: 3 });
    const graph = await buildGraph(await loadNetworkData(env, net.networkId));
    const fallback = await analyzeGraph(env, graph);
    expect(fallback.source).toBe("worker");
    expect(fallback.communities).toHaveLength(1);
    expect(fallback.communities[0]).toHaveLength(3);
    const caseB = `caso:${net.cases[1]!.id}`;
    expect(fallback.degree[caseB]).toBeGreaterThan(0);

    const calls: unknown[] = [];
    setMlClientForTests({
      kind: "http",
      raw: async (path: string, init: RequestInit) => {
        calls.push({ path, body: JSON.parse(String(init.body)) });
        return Response.json({ communities: [graph.nodes.filter((n) => n.type === "caso").map((n) => n.id)], centrality: { [caseB]: 0.5 }, degree: { [caseB]: 7 }, membership: {} });
      },
    } as unknown as MlClient);
    const ml = await analyzeGraph(env, graph);
    expect(ml.source).toBe("ml");
    expect(ml.degree[caseB]).toBe(7);
    expect(calls).toHaveLength(1);
    // Segunda vez: caché en KV, sin volver a llamar al contenedor.
    await analyzeGraph(env, graph);
    expect(calls).toHaveLength(1);
  });

  it("intermediación como networkx y umbral territorial de 5 casos y 3 víctimas", () => {
    const adj = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a", "c"])],
      ["c", new Set(["b"])],
    ]);
    expect(betweenness(adj)).toEqual({ a: 0, b: 1, c: 0 });

    const mk = (n: number, victims: number, zona = "Lima Este - E12") => Array.from({ length: n }, (_, i) => ({ device_id: `d${i % victims}`, zona }));
    expect(territorialStats(mk(4, 4), "cuadricula")).toEqual({ disponible: false, nivel: "cuadricula", zonas: [] });
    expect(territorialStats(mk(5, 2), "cuadricula").zonas).toEqual([]);
    expect(territorialStats(mk(5, 3), "cuadricula").zonas).toEqual([{ zona: "Lima Este - E12", casos: 5 }]);
    // Una zona chica dentro de una red grande se suma en "Otras zonas"; por distrito sí alcanza.
    const mixed = [...mk(5, 3), ...mk(2, 2, "Lima Este - E13")];
    expect(territorialStats(mixed, "cuadricula").zonas).toEqual([
      { zona: "Lima Este - E12", casos: 5 },
      { zona: "Otras zonas (agregado)", casos: 2 },
    ]);
    expect(territorialStats(mixed, "distrito").zonas).toEqual([{ zona: "Lima Este", casos: 7 }]);
  });

  it("GET /v1/console/networks/:id devuelve nodos con análisis, aristas, línea de tiempo y vínculos", async () => {
    const net = await seedNetwork({ n: 3 });
    const analyst = await loginAs("analyst", net.orgId);
    const res = await apiJson<NetworkView>(`/v1/console/networks/${net.networkId}`, { token: analyst.token });
    expect(res.status).toBe(200);
    const v = res.body;
    expect(v.label).toBe(net.label);
    expect(v.n_cases).toBe(3);
    expect(v.links.map((l) => l.label)).toEqual(net.links.map((l) => `VIN-${l.num}`));
    expect(v.nodes.every((n) => typeof n.data?.degree === "number" && "community" in (n.data ?? {}))).toBe(true);
    expect(v.edges.some((e) => e.type === "senal")).toBe(true);
    const textos = v.timeline.map((t) => t.texto);
    expect(textos).toContain("Primer contacto");
    expect(textos.some((t) => t.startsWith("Vence el plazo de 48 horas"))).toBe(true);
    expect(textos).toContain("Foto del local con una bala");
    expect(textos.some((t) => t.startsWith(`Vínculo VIN-${net.links[0]!.num} confirmado`))).toBe(true);
    const fechas = v.timeline.map((t) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(t.fecha) ? `${t.fecha}T12:00:00-05:00` : t.fecha));
    expect([...fechas].sort((a, b) => a - b)).toEqual(fechas);
  });
});
