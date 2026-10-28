import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { combineSignals, importAllianceKey, logistic, statusForScore, type Calibration } from "@blindaje/shared";
import { RESULTS_DIR } from "./env";
import { loadEscenarios, pairKey } from "./data";
import { hmacIndex, randomEvalKey } from "./identifiers-eval";

/**
 * Motor de vinculación sobre los escenarios (sección 9 con la calibración propuesta): para cada
 * par de casos se calculan las señales (identificador por HMAC, voz por coseno de centroides,
 * imagen por hash perceptual o DINOv2), se combinan con 1 − ∏(1 − pᵢ) del código compartido y se
 * clasifican con los umbrales 0.90 / 0.60. Un par se "propone" si llega a por_revisar o probable.
 * El modus operandi no se mide aquí (no vincula solo y requiere embeddings de texto del contenedor).
 */

interface VozCaso {
  centroid: number[];
  segmentos: number;
  hablante: string;
  canal: number;
}
interface ImagenFeat {
  phash: string;
  dino: number[] | null;
}

export interface EscenarioPar {
  a: string;
  b: string;
  esperado: boolean;
  propuesto: boolean;
  estado: string;
  score: number;
  senales: Record<string, number>;
  coseno_voz?: number;
  hamming?: number;
  dino?: number;
}

export interface EscenariosReport {
  estado: "ok" | "parcial";
  motivo?: string;
  senales_medidas: string[];
  pares_totales: number;
  pares_esperados: number;
  verdaderos: number;
  falsos: number;
  faltantes: number;
  precision: number | null;
  recall: number | null;
  falsos_por_100_comparaciones: number;
  por_escenario: Record<string, { tipo: string; esperados: number; verdaderos: number; falsos: number; faltantes: number }>;
  pares: EscenarioPar[];
}

function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);

export function loadJson<T>(name: string): T | null {
  const p = resolve(RESULTS_DIR, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}

export async function runEscenariosEval(cal: Calibration): Promise<EscenariosReport> {
  const key = await importAllianceKey(randomEvalKey());
  const { esc, pares: idPares } = await hmacIndex(key);
  const voz = loadJson<{ casos: Record<string, VozCaso> }>("escenarios_voz.json");
  const img = loadJson<{ imagenes: Record<string, ImagenFeat> }>("imagenes.json");
  const medidas = ["identificador", ...(voz ? ["voz"] : []), ...(img ? ["imagen"] : [])];
  const esperados = new Set(esc.pares_vinculados.map((p) => pairKey(p.a, p.b)));
  const casoEsc = new Map<string, string>();
  for (const e of esc.escenarios) for (const c of e.casos) casoEsc.set(c, e.id);

  const out: EscenarioPar[] = [];
  const casos = esc.casos;
  for (let i = 0; i < casos.length; i++) {
    for (let j = i + 1; j < casos.length; j++) {
      const A = casos[i]!;
      const B = casos[j]!;
      const k = pairKey(A.id, B.id);
      const senales: Record<string, number> = {};
      const par: EscenarioPar = { a: A.id, b: B.id, esperado: esperados.has(k), propuesto: false, estado: "", score: 0, senales };
      if (idPares.has(k)) senales.identificador = cal.identificador.p;
      const va = voz?.casos[A.id];
      const vb = voz?.casos[B.id];
      if (va && vb) {
        const s = dot(va.centroid, vb.centroid);
        par.coseno_voz = s;
        if (Math.min(va.segmentos, vb.segmentos) >= cal.voz.min_segmentos) {
          senales.voz = Math.min(logistic(s, cal.voz.a, cal.voz.b), cal.voz.p_max);
        }
      }
      if (img && A.imagenes.length && B.imagenes.length) {
        let best = 0;
        for (const ia of A.imagenes)
          for (const ib of B.imagenes) {
            const fa = img.imagenes[`${ia.imagen}:${ia.transformacion}`];
            const fb = img.imagenes[`${ib.imagen}:${ib.transformacion}`];
            if (!fa || !fb) continue;
            const h = hamming(fa.phash, fb.phash);
            par.hamming = Math.min(par.hamming ?? 64, h);
            let p = h <= cal.imagen.hamming_max ? cal.imagen.p_hamming : 0;
            if (fa.dino && fb.dino) {
              const d = dot(fa.dino, fb.dino);
              par.dino = Math.max(par.dino ?? -1, d);
              p = Math.max(p, Math.min(logistic(d, cal.imagen.dino_a, cal.imagen.dino_b), cal.imagen.p_max));
            }
            best = Math.max(best, p);
          }
        if (best > 0) senales.imagen = best;
      }
      par.score = combineSignals(Object.values(senales));
      par.estado = statusForScore(par.score, cal);
      par.propuesto = par.estado !== "descartado_auto";
      out.push(par);
    }
  }
  const tp = out.filter((p) => p.esperado && p.propuesto).length;
  const fp = out.filter((p) => !p.esperado && p.propuesto).length;
  const fn = out.filter((p) => p.esperado && !p.propuesto).length;
  const porEsc: EscenariosReport["por_escenario"] = {};
  for (const e of esc.escenarios) {
    const dentro = out.filter((p) => casoEsc.get(p.a) === e.id || casoEsc.get(p.b) === e.id);
    porEsc[e.id] = {
      tipo: e.tipo,
      esperados: dentro.filter((p) => p.esperado).length,
      verdaderos: dentro.filter((p) => p.esperado && p.propuesto).length,
      falsos: dentro.filter((p) => !p.esperado && p.propuesto).length,
      faltantes: dentro.filter((p) => p.esperado && !p.propuesto).length,
    };
  }
  const faltan = [!voz && "voz (corre la evaluación de voz)", !img && "imagen (corre el script de imágenes)"].filter(Boolean);
  return {
    estado: faltan.length ? "parcial" : "ok",
    ...(faltan.length ? { motivo: `Sin señales de ${faltan.join(" ni ")}` } : {}),
    senales_medidas: medidas,
    pares_totales: out.length,
    pares_esperados: esperados.size,
    verdaderos: tp,
    falsos: fp,
    faltantes: fn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: esperados.size ? tp / esperados.size : null,
    falsos_por_100_comparaciones: (100 * fp) / out.length,
    por_escenario: porEsc,
    // Solo los pares interesantes: esperados, propuestos o con alguna señal
    pares: out.filter((p) => p.esperado || p.propuesto || Object.keys(p.senales).length > 0 || (p.coseno_voz ?? 0) > 0.4),
  };
}
