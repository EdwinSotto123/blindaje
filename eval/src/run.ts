import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Calibration, DEFAULT_CALIBRATION } from "@blindaje/shared";
import { runApiEvals } from "./api-evals";
import { EVAL_DIR, REPO_DIR, RESULTS_DIR } from "./env";
import { runEscenariosEval } from "./escenarios-eval";
import { runFichaEval } from "./ficha-eval";
import { runIdentifiersEval } from "./identifiers-eval";
import { costSummary } from "./meta";
import { SCHEMA_VERSION, buildResumen, renderMarkdown, type ImagenesSection, type Report, type VozSection } from "./report";

/**
 * pnpm eval: corre toda la evaluación y escribe eval/report.json, eval/REPORT.md y
 * eval/calibration.json.
 *
 *   --sin-voz         no corre la evaluación de voz (usa el último resultado si existe)
 *   --sin-imagenes    ídem para imágenes
 *   --sin-ficha       no llama a Muse Spark (usa solo la caché si existe)
 *   --sin-api         no corre las métricas que dependen de la API desplegada
 *   --todos           ficha sobre los 32 guiones en vez de los 20 del subconjunto
 *   --voz-backend X   auto (por defecto: contenedor si responde, si no local), ml o local
 */

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string, d: string) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};

const PY_DIR = resolve(EVAL_DIR, "py");

function py(mod: string, extra: string[] = []): boolean {
  console.log(`\n$ uv run python -I -m blindaje_eval.${mod} ${extra.join(" ")}`);
  const r = spawnSync("uv", ["run", "--project", PY_DIR, "python", "-I", "-u", "-m", `blindaje_eval.${mod}`, ...extra], {
    cwd: PY_DIR,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" },
    shell: process.platform === "win32",
  });
  return r.status === 0;
}

function readResult<T>(name: string): T | null {
  const p = resolve(RESULTS_DIR, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function seccionVoz(): VozSection {
  const v = readResult<VozSection & { estado: string }>("voz.json");
  if (!v) return { estado: "pendiente", motivo: "No hay resultados de voz: corre pnpm eval sin --sin-voz (descarga SLR73, ~1.9 GB)." };
  const { estado: _e, ...rest } = v;
  const keep = ["backend", "modelo", "dataset", "canales", "protocolo", "identificacion", "identificacion_corta", "verificacion", "calibracion", "falsos_vinculos", "cohorte"] as const;
  const out: VozSection = { estado: "ok" };
  for (const k of keep) (out as unknown as Record<string, unknown>)[k] = (rest as unknown as Record<string, unknown>)[k];
  return out;
}

function seccionImagenes(): ImagenesSection {
  const r = readResult<{
    backend_dino: string;
    fuentes: string[];
    transformaciones: string[];
    imagenes: Record<string, { phash: string; dino: number[] }>;
    distribuciones: Record<string, unknown>;
    con_hamming_max_10: Record<string, number>;
  }>("imagenes.json");
  if (!r) return { estado: "pendiente", motivo: "No hay resultados de imágenes." };
  const hd = (a: string, b: string) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
      while (x) {
        d += x & 1;
        x >>= 1;
      }
    }
    return d;
  };
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
  const por: ImagenesSection["por_transformacion"] = {};
  for (const t of r.transformaciones.filter((x) => x !== "original")) {
    const hs: number[] = [];
    let dmin = 1;
    for (const f of r.fuentes) {
      const o = r.imagenes[`${f}:original`];
      const x = r.imagenes[`${f}:${t}`];
      if (!o || !x) continue;
      hs.push(hd(o.phash, x.phash));
      dmin = Math.min(dmin, dot(o.dino, x.dino));
    }
    por[t] = { hamming: hs, dino_min: dmin };
  }
  return {
    estado: "ok",
    backend_dino: r.backend_dino,
    fuentes: r.fuentes,
    transformaciones: r.transformaciones,
    distribuciones: r.distribuciones,
    por_transformacion: por,
    con_hamming_max_10: r.con_hamming_max_10,
  };
}

/** Calibración propuesta: voz desde la evaluación, imagen desde las distribuciones medidas. */
function calibracion(voz: VozSection, img: ImagenesSection): Calibration {
  const c: Calibration = structuredClone(DEFAULT_CALIBRATION);
  const fuentes: string[] = [];
  if (voz.estado === "ok") {
    const p = (voz.calibracion as { propuesta: { a: number; b: number; p_max: number; min_segmentos: number } }).propuesta;
    c.voz = { a: +p.a.toFixed(3), b: +p.b.toFixed(4), min_segmentos: p.min_segmentos, p_max: p.p_max };
    fuentes.push(`voz: SLR73 ${String((voz.dataset as { hablantes_prueba: number }).hablantes_prueba)} hablantes, backend ${voz.backend}`);
  }
  if (img.estado === "ok") {
    const d = img.distribuciones as { hamming_distintas: { min: number }; dino_distintas: { p95: number } };
    // Hash: el umbral más alto que deja un margen de 2 bajo el par distinto más cercano.
    c.imagen.hamming_max = Math.max(4, Math.min(12, d.hamming_distintas.min - 2));
    // DINOv2 no separa identidad de parecido de escena: solo suma, nunca llega sola al umbral de revisión.
    c.imagen.dino_b = +d.dino_distintas.p95.toFixed(3);
    c.imagen.dino_a = 40;
    c.imagen.p_max = 0.5;
    fuentes.push(`imagen: phash y DINOv2 (backend ${img.backend_dino}) sobre fotos del demo y notas ficticias`);
  }
  c.version = `v1-eval-${new Date().toISOString().slice(0, 10)}`;
  c.updated_at = new Date().toISOString();
  c.source = `eval/report.json (${fuentes.join("; ") || "sin datos"}); modus operandi, identificador y umbrales sin cambios`;
  return Calibration.parse(c);
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const t0 = Date.now();
  const backend = opt("--voz-backend", "auto");

  if (!flag("--sin-voz")) {
    if (!py("slr73", ["descargar"])) console.log("No se pudo preparar SLR73; la voz queda pendiente.");
    else if (!py("voice_eval", ["--backend", backend])) console.log("La evaluación de voz falló; se usa el último resultado si existe.");
  }
  if (!flag("--sin-imagenes")) {
    if (!py("images", ["--backend", backend])) console.log("La evaluación de imágenes falló.");
  }
  const voz = seccionVoz();
  const imagenes = seccionImagenes();
  const cal = calibracion(voz, imagenes);
  writeFileSync(resolve(EVAL_DIR, "calibration.json"), JSON.stringify(cal, null, 2) + "\n");

  console.log("\nFicha con Muse Spark…");
  const ficha = await runFichaEval({ all: flag("--todos"), dryRun: flag("--sin-ficha") });
  console.log("Identificadores…");
  const identificadores = await runIdentifiersEval();
  console.log("Motor sobre escenarios…");
  const escenarios = await runEscenariosEval(cal);
  console.log("Métricas de la API…");
  const api = flag("--sin-api")
    ? null
    : await runApiEvals({ waitSeconds: Number(process.env.DEMO_WAIT_SECONDS ?? 120) });
  const pendApi = { estado: "pendiente" as const, motivo: "Se corrió con --sin-api." };

  const costos = costSummary();
  const base: Omit<Report, "resumen"> = {
    schema_version: SCHEMA_VERSION,
    generado: new Date().toISOString(),
    ficticio: true,
    aviso:
      "Todos los datos de esta evaluación son ficticios (guiones, números, cuentas, grupos, imágenes y audios sintéticos) o públicos con licencia abierta (voces de OpenSLR SLR73, CC BY-SA 4.0). No se usaron datos de víctimas reales.",
    git_commit: gitCommit(),
    comando: `pnpm eval${args.length ? ` -- ${args.join(" ")}` : ""}`,
    voz,
    ficha: { ...ficha, casos: ficha.casos },
    identificadores,
    imagenes,
    escenarios,
    agentes: api?.agentes ?? { ...pendApi, salidas: 0, afirmaciones: 0, verificadas: 0, fidelidad: null, sin_cita: [], citas_inexistentes: [], por_agente: {}, validacion_de_la_api: { vinculador_valid_false: 0, perfiles_citation_check_false: 0 } },
    privacidad: {
      estadisticas_menos_5: api?.estadisticas_menos_5 ?? { ...pendApi, perfiles_revisados: 0, perfiles_con_menos_de_5_casos: 0, estadisticas_con_menos_de_5: 0, detalle: [] },
      infiltrado: api?.infiltrado ?? { ...pendApi, pasa: null, chequeos: [] },
    },
    calibracion: cal,
    costos: {
      meta_api_usd_total: costos.total_usd,
      llamadas: costos.llamadas,
      por_modelo: costos.por_modelo,
      nota: "Solo las llamadas que hace eval/ (ficha y fotos del demo). Lo que gasta el pipeline de la API está en la consola de costos.",
    },
  };
  const report: Report = { ...base, resumen: buildResumen(base) };
  writeFileSync(resolve(EVAL_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(resolve(EVAL_DIR, "REPORT.md"), renderMarkdown(report));

  console.log("\nResumen:");
  for (const m of report.resumen) {
    const val = m.valor === null ? "pendiente" : m.unidad === "proporcion" ? `${(100 * m.valor).toFixed(1)} %` : String(+m.valor.toFixed(3));
    console.log(`  ${m.cumple === null ? "·" : m.cumple ? "ok" : "no"} ${m.nombre}: ${val} (meta ${m.meta.texto})`);
  }
  console.log(`\neval/report.json, eval/REPORT.md y eval/calibration.json listos en ${Math.round((Date.now() - t0) / 1000)} s.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
