import { randomBytes } from "node:crypto";
import { hmacIdentifier, identifierLabel, importAllianceKey, lastThree, normalizeIdentifier } from "@blindaje/shared";
import { loadEscenarios, pairKey } from "./data";

/**
 * Coincidencia de identificadores (sección 16.2, meta 100 %): sobre los escenarios, cada
 * identificador se normaliza (E.164, dígitos, placas) y se cifra con HMAC-SHA256 usando
 * exactamente el código de packages/shared. Dos casos coinciden si comparten un HMAC. Se compara
 * contra los pares que la verdad de referencia vincula por identificador.
 *
 * La clave de la evaluación es aleatoria en cada corrida: nunca se usa la clave de la alianza.
 */

export interface IdentifiersReport {
  estado: "ok";
  identificadores: number;
  normalizados: number;
  invalidos: string[];
  pares_esperados: number;
  pares_detectados: number;
  verdaderos: number;
  falsos: string[];
  faltantes: string[];
  exactitud: number;
  casos_cercanos_sin_falso_positivo: boolean;
  formatos_probados: string[];
  almacenado: string;
}

export async function hmacIndex(key: CryptoKey) {
  const esc = loadEscenarios();
  const porHmac = new Map<string, Set<string>>();
  const porCaso = new Map<string, { ref: string; tipo: string; ultimos_3: string }[]>();
  const invalidos: string[] = [];
  let total = 0;
  let ok = 0;
  for (const c of esc.casos) {
    for (const i of c.identificadores) {
      total++;
      const n = normalizeIdentifier(i.tipo, i.valor);
      if (!n) {
        invalidos.push(`${c.id}:${i.valor}`);
        continue;
      }
      ok++;
      const h = await hmacIdentifier(key, i.tipo, n);
      if (!porHmac.has(h)) porHmac.set(h, new Set());
      porHmac.get(h)!.add(c.id);
      const arr = porCaso.get(c.id) ?? [];
      arr.push({ ref: identifierLabel(h), tipo: i.tipo, ultimos_3: lastThree(n) });
      porCaso.set(c.id, arr);
    }
  }
  const pares = new Map<string, string[]>();
  for (const [h, casos] of porHmac) {
    const l = [...casos].sort();
    for (let x = 0; x < l.length; x++)
      for (let y = x + 1; y < l.length; y++) {
        const k = pairKey(l[x]!, l[y]!);
        pares.set(k, [...(pares.get(k) ?? []), identifierLabel(h)]);
      }
  }
  return { esc, porHmac, porCaso, pares, invalidos, total, ok };
}

export function randomEvalKey(): string {
  return randomBytes(32).toString("base64url");
}

export async function runIdentifiersEval(): Promise<IdentifiersReport> {
  const key = await importAllianceKey(randomEvalKey());
  const { esc, pares, invalidos, total, ok } = await hmacIndex(key);
  const esperados = new Set(esc.pares_vinculados.filter((p) => p.por.includes("identificador")).map((p) => pairKey(p.a, p.b)));
  const detectados = new Set(pares.keys());
  const verdaderos = [...detectados].filter((k) => esperados.has(k));
  const falsos = [...detectados].filter((k) => !esperados.has(k));
  const faltantes = [...esperados].filter((k) => !detectados.has(k));
  const e13 = [...detectados].some((k) => k.includes("E13"));
  const formatos = [...new Set(esc.casos.flatMap((c) => c.identificadores.map((i) => i.valor.replace(/\d/g, "9").replace(/[a-z]/gi, "Z"))))];
  return {
    estado: "ok",
    identificadores: total,
    normalizados: ok,
    invalidos,
    pares_esperados: esperados.size,
    pares_detectados: detectados.size,
    verdaderos: verdaderos.length,
    falsos,
    faltantes,
    exactitud: esperados.size ? verdaderos.length / esperados.size : 1,
    casos_cercanos_sin_falso_positivo: !e13,
    formatos_probados: formatos.sort(),
    almacenado: "Solo HMAC-SHA256 (referencia ID-xxxxxx) y los últimos 3 dígitos; nunca el valor legible.",
  };
}
