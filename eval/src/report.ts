import type { Calibration } from "@blindaje/shared";
import type { ApiEvalsReport } from "./api-evals";
import type { EscenariosReport } from "./escenarios-eval";
import type { FichaReport } from "./ficha-eval";
import type { IdentifiersReport } from "./identifiers-eval";
import type { MoReport } from "./mo-eval";
import type { CostSummary } from "./meta";

/**
 * Estructura estable de eval/report.json (schema_version 1.x). El README y la landing leen
 * `resumen` (una fila por métrica con id fijo); el resto es el detalle de cada sección. Cambios
 * que rompan la forma suben la versión mayor. Documentada en eval/README.md.
 */

export const SCHEMA_VERSION = "1.1";

export type Estado = "ok" | "pendiente" | "error";

export type MetricaId =
  | "voz_top1"
  | "voz_top3"
  | "falsos_vinculos_100"
  | "identificadores"
  | "ficha_campos"
  | "agentes_citas"
  | "estadisticas_menos_5"
  | "infiltrado";

export interface MetricaResumen {
  id: MetricaId;
  nombre: string;
  nombre_en: string;
  /** Proporción 0–1, conteo, tasa por 100 o 1/0 para pruebas que pasan o no. null si está pendiente. */
  valor: number | null;
  unidad: "proporcion" | "por_100" | "conteo" | "pasa";
  meta: { op: ">=" | "<=" | "=="; valor: number; texto: string };
  cumple: boolean | null;
  estado: Estado;
  nota: string;
}

export interface VozSection {
  estado: Estado;
  motivo?: string;
  backend?: string;
  modelo?: string;
  dataset?: Record<string, unknown>;
  canales?: Record<string, unknown>;
  protocolo?: string;
  identificacion?: Record<string, number>;
  identificacion_corta?: Record<string, number>;
  verificacion?: Record<string, unknown>;
  calibracion?: Record<string, unknown>;
  falsos_vinculos?: Record<string, unknown>;
  cohorte?: Record<string, unknown>;
}

export interface ImagenesSection {
  estado: Estado;
  motivo?: string;
  backend_dino?: string;
  fuentes?: string[];
  transformaciones?: string[];
  distribuciones?: Record<string, unknown>;
  por_transformacion?: Record<string, { hamming: number[]; dino_min: number }>;
  con_hamming_max_10?: Record<string, number>;
}

export interface Report {
  schema_version: string;
  generado: string;
  ficticio: true;
  aviso: string;
  git_commit: string | null;
  comando: string;
  resumen: MetricaResumen[];
  voz: VozSection;
  ficha: FichaReport;
  identificadores: IdentifiersReport;
  imagenes: ImagenesSection;
  escenarios: EscenariosReport;
  /** 1.1: calibración de la señal de modus operandi con datos. */
  modus_operandi: MoReport;
  agentes: ApiEvalsReport["agentes"];
  privacidad: { estadisticas_menos_5: ApiEvalsReport["estadisticas_menos_5"]; infiltrado: ApiEvalsReport["infiltrado"] };
  calibracion: Calibration;
  costos: { meta_api_usd_total: number; llamadas: number; por_modelo: CostSummary["por_modelo"]; nota: string };
}

function cumple(valor: number | null, op: ">=" | "<=" | "==", meta: number): boolean | null {
  if (valor === null) return null;
  if (op === ">=") return valor >= meta;
  if (op === "<=") return valor <= meta;
  return Math.abs(valor - meta) < 1e-9;
}

export function buildResumen(r: Omit<Report, "resumen">): MetricaResumen[] {
  const v = r.voz;
  const vozOk = v.estado === "ok";
  const nb = vozOk ? `SLR73, ${String((v.dataset as { hablantes_prueba?: number })?.hablantes_prueba ?? "?")} hablantes, backend ${v.backend}` : (v.motivo ?? "");
  const m = (x: Omit<MetricaResumen, "cumple">): MetricaResumen => ({ ...x, cumple: x.estado === "ok" ? cumple(x.valor, x.meta.op, x.meta.valor) : null });
  const fv = v.falsos_vinculos as { por_100_comparaciones?: number } | undefined;
  return [
    m({
      id: "voz_top1",
      nombre: "Vinculación por voz: caso correcto en primer lugar",
      nombre_en: "Voice linking: correct case ranked first",
      valor: vozOk ? (v.identificacion?.top1 ?? null) : null,
      unidad: "proporcion",
      meta: { op: ">=", valor: 0.8, texto: "≥ 80 %" },
      estado: v.estado,
      nota: nb,
    }),
    m({
      id: "voz_top3",
      nombre: "Vinculación por voz: caso correcto entre los 3 primeros",
      nombre_en: "Voice linking: correct case in top 3",
      valor: vozOk ? (v.identificacion?.top3 ?? null) : null,
      unidad: "proporcion",
      meta: { op: ">=", valor: 0.9, texto: "≥ 90 %" },
      estado: v.estado,
      nota: nb,
    }),
    m({
      id: "falsos_vinculos_100",
      nombre: "Falsos vínculos por cada 100 comparaciones sobre el umbral de revisión",
      nombre_en: "False links per 100 comparisons above the review threshold",
      valor: vozOk ? (fv?.por_100_comparaciones ?? null) : null,
      unidad: "por_100",
      meta: { op: "<=", valor: 2, texto: "≤ 2" },
      estado: v.estado,
      nota: vozOk ? `Señal de voz sola con la calibración propuesta (umbral 0.60); ${nb}` : (v.motivo ?? ""),
    }),
    m({
      id: "identificadores",
      nombre: "Coincidencias exactas de identificadores detectadas",
      nombre_en: "Exact identifier matches detected",
      valor: r.identificadores.exactitud,
      unidad: "proporcion",
      meta: { op: "==", valor: 1, texto: "100 %" },
      estado: "ok",
      nota: `${r.identificadores.verdaderos}/${r.identificadores.pares_esperados} pares, ${r.identificadores.falsos.length} falsos; normalización y HMAC de packages/shared`,
    }),
    m({
      id: "ficha_campos",
      nombre: "Campos de la ficha correctos frente a la etiqueta manual",
      nombre_en: "Case-file fields correct vs. manual labels",
      valor: r.ficha.exactitud_global,
      unidad: "proporcion",
      meta: { op: ">=", valor: 0.9, texto: "≥ 90 %" },
      estado: r.ficha.estado,
      nota: r.ficha.estado === "ok" ? `${r.ficha.guiones} guiones, ${r.ficha.campos_puntuados.length} campos, ${r.ficha.modelo} (reasoning ${r.ficha.reasoning_effort})` : (r.ficha.motivo ?? ""),
    }),
    m({
      id: "agentes_citas",
      nombre: "Afirmaciones de los agentes con evidencia citada y verificable",
      nombre_en: "Agent claims with cited, verifiable evidence",
      valor: r.agentes.fidelidad,
      unidad: "proporcion",
      meta: { op: "==", valor: 1, texto: "100 %" },
      estado: r.agentes.estado,
      nota: r.agentes.estado === "ok" ? `${r.agentes.verificadas}/${r.agentes.afirmaciones} afirmaciones` : (r.agentes.motivo ?? ""),
    }),
    m({
      id: "estadisticas_menos_5",
      nombre: "Estadísticas mostradas con menos de 5 casos",
      nombre_en: "Statistics shown with fewer than 5 cases",
      valor: r.privacidad.estadisticas_menos_5.estado === "ok" ? r.privacidad.estadisticas_menos_5.estadisticas_con_menos_de_5 : null,
      unidad: "conteo",
      meta: { op: "==", valor: 0, texto: "0" },
      estado: r.privacidad.estadisticas_menos_5.estado,
      nota:
        r.privacidad.estadisticas_menos_5.estado === "ok"
          ? `${r.privacidad.estadisticas_menos_5.perfiles_revisados} perfiles de red revisados`
          : (r.privacidad.estadisticas_menos_5.motivo ?? ""),
    }),
    m({
      id: "infiltrado",
      nombre: "Prueba del infiltrado: no recibe vínculos ni datos de otros casos",
      nombre_en: "Infiltrator test: receives no links or other cases' data",
      valor: r.privacidad.infiltrado.pasa === null ? null : r.privacidad.infiltrado.pasa ? 1 : 0,
      unidad: "pasa",
      meta: { op: "==", valor: 1, texto: "pasa" },
      estado: r.privacidad.infiltrado.estado,
      nota:
        r.privacidad.infiltrado.estado === "ok"
          ? `${r.privacidad.infiltrado.chequeos.filter((c) => c.ok).length}/${r.privacidad.infiltrado.chequeos.length} chequeos${r.privacidad.infiltrado.advertencias?.length ? "; pipeline sin vínculos todavía, repetir" : ""}`
          : (r.privacidad.infiltrado.motivo ?? ""),
    }),
  ];
}

// ---------------------------------------------------------------------------------------------
// REPORT.md
// ---------------------------------------------------------------------------------------------

const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "—" : `${(100 * x).toFixed(d)} %`);
const num = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));

function valorResumen(m: MetricaResumen): string {
  if (m.valor === null) return "pendiente";
  if (m.unidad === "proporcion") return pct(m.valor);
  if (m.unidad === "por_100") return num(m.valor, 2);
  if (m.unidad === "pasa") return m.valor === 1 ? "pasa" : "no pasa";
  return String(m.valor);
}

export function renderMarkdown(r: Report): string {
  const L: string[] = [];
  const p = (s = "") => L.push(s);
  const fecha = new Date(r.generado).toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "long", timeStyle: "short" });
  p("# Evaluación de Blindaje");
  p();
  p(`Generado el ${fecha} (hora de Lima) con \`${r.comando}\`${r.git_commit ? ` en el commit \`${r.git_commit}\`` : ""}.`);
  p(`Estructura de los datos: \`eval/report.json\` (schema ${r.schema_version}, ver \`eval/README.md\`).`);
  p();
  p(`> ${r.aviso}`);
  p();
  p("## Resumen");
  p();
  p("| Métrica | Resultado | Meta | Cumple | Nota |");
  p("|---|---|---|---|---|");
  for (const m of r.resumen) {
    const c = m.cumple === null ? "pendiente" : m.cumple ? "sí" : "no";
    p(`| ${m.nombre} | ${valorResumen(m)} | ${m.meta.texto} | ${c} | ${m.nota.replace(/\|/g, "/")} |`);
  }
  p();
  p("Las metas son objetivos de trabajo de la sección 16.2 del documento de diseño, no garantías. Los resultados son los reales de esta corrida.");
  p();

  // Voz
  p("## Vinculación por voz");
  p();
  const v = r.voz;
  if (v.estado !== "ok") {
    p(`Pendiente: ${v.motivo}`);
  } else {
    const d = v.dataset as Record<string, number | string | string[]>;
    const ver = v.verificacion as Record<string, Record<string, number> | number>;
    const cal = v.calibracion as {
      metodo: string;
      propuesta: { a: number; b: number; p_max: number };
      detalle: { b_gauss: number; coseno_percentil: number; b_restringido: number };
      regresion_logistica_referencia: { a: number; b: number };
      operacion: Record<string, number>;
      operacion_corta: Record<string, number>;
      validacion_cruzada: { a: number; b: number; prueba: Record<string, number> }[];
    };
    const fv = v.falsos_vinculos as Record<string, number>;
    const tar = ver.coseno_misma_persona as Record<string, number>;
    const non = ver.coseno_distintas as Record<string, number>;
    p(`- **Datos:** ${d.nombre} (${d.licencia}), ${d.hablantes_prueba} hablantes de prueba y ${d.hablantes_cohorte} de cohorte (nunca en la prueba). ${d.audios} notas de voz simuladas; duración media ${num(d.duracion_media_s as number, 1)} s (condición corta: ${num(d.duracion_media_corta_s as number, 1)} s).`);
    p(`- **Modelo:** \`${v.modelo}\` por el backend **${v.backend}**${v.backend === "local" ? " (el mismo modelo, la misma segmentación de 3 s y el mismo VAD que el contenedor; el contenedor no respondía durante la corrida)" : " (contenedor ML, `/voice/embed`)"}.`);
    p(`- **Protocolo:** ${v.protocolo}`);
    p(`- **Canales:** canal 1 = ${(v.canales as Record<string, { nombre: string; opus: string }>)["1"]?.nombre}, Opus ${(v.canales as Record<string, { opus: string }>)["1"]?.opus}; canal 2 = ${(v.canales as Record<string, { nombre: string }>)["2"]?.nombre}, Opus ${(v.canales as Record<string, { opus: string }>)["2"]?.opus}. Ida y vuelta Opus → WAV 16 kHz con ffmpeg.`);
    p();
    p("| | Primer lugar | Entre los 3 primeros | Con s-norm (1.º / top 3) |");
    p("|---|---|---|---|");
    const id = v.identificacion!;
    const ic = v.identificacion_corta!;
    p(`| Notas de ~16 s (${id.pruebas} pruebas contra ${id.inscritos} inscritos) | ${pct(id.top1)} | ${pct(id.top3)} | ${pct(id.top1_snorm)} / ${pct(id.top3_snorm)} |`);
    p(`| Notas cortas de ~7 s (${ic.pruebas} pruebas) | ${pct(ic.top1)} | ${pct(ic.top3)} | ${pct(ic.top1_snorm)} / ${pct(ic.top3_snorm)} |`);
    p();
    p(`Similitud coseno entre centroides: misma persona ${num(tar.media, 3)} ± ${num(tar.std, 3)} (mín. ${num(tar.min, 3)}), personas distintas ${num(non.media, 3)} ± ${num(non.std, 3)} (p99 ${num(non.p99, 3)}, máx. ${num(non.max, 3)}). EER ${pct(ver.eer_coseno as number, 2)} con coseno, ${pct(ver.eer_snorm as number, 2)} con s-norm y ${pct(ver.eer_coseno_corta as number, 2)} en la condición corta.`);
    p();
    p("**Falsos vínculos.** " + (v.falsos_vinculos as { definicion: string }).definicion);
    p();
    p(`| | Falsos por 100 comparaciones | Falsos por 100 pares distintos | Pares de la misma persona sobre el umbral |`);
    p("|---|---|---|---|");
    p(`| Todas las pruebas (~16 s) | ${num(fv.por_100_comparaciones)} | ${num(fv.por_100_pares_distintos)} | ${pct(fv.recall_umbral_revision)} |`);
    p(`| Validación cruzada por hablante (promedio de 2 particiones) | ${num(fv.validacion_cruzada_por_100_comparaciones)} | — | ${pct(fv.recall_validacion_cruzada)} |`);
    p(`| Notas cortas (~7 s) | ${num(fv.corta_por_100_comparaciones)} | ${num(cal.operacion_corta.falsos_por_100_pares_distintos)} | ${pct(fv.corta_recall_umbral_revision)} |`);
    p();
    p("### Calibración de la voz y razonamiento");
    p();
    p(`- Método: ${cal.metodo}`);
    p(`- Con las dos distribuciones de arriba, el cociente de verosimilitud vale 1 en s = ${num(cal.detalle.b_gauss, 4)} y la pendiente de su logaritmo ahí es ${num(cal.propuesta.a, 1)}. El percentil 99 de los pares distintos es ${num(cal.detalle.coseno_percentil, 4)}, que con esa pendiente pide b ≥ ${num(cal.detalle.b_restringido, 4)} para no pasar de 1 falso por cada 100 pares distintos en el umbral 0.60. Propuesta: **a = ${num(cal.propuesta.a, 2)}, b = ${num(cal.propuesta.b, 4)}**, p_max = ${cal.propuesta.p_max} (la voz sola nunca llega a "probable").`);
    p(`- La regresión logística por máxima verosimilitud da a = ${num(cal.regresion_logistica_referencia.a, 1)}, b = ${num(cal.regresion_logistica_referencia.b, 4)}: con clases casi separadas la pendiente crece sin límite y las probabilidades quedan sobreconfiadas, así que no se usa.`);
    p(`- Validación cruzada (se ajusta con la mitad de los hablantes y se mide en la otra mitad): ${cal.validacion_cruzada.map((c) => `a = ${num(c.a, 1)}, b = ${num(c.b, 3)} → ${num(c.prueba.falsos_por_100_comparaciones)} falsos por 100 y ${pct(c.prueba.recall_umbral_revision)} de pares correctos sobre el umbral`).join("; ")}.`);
    p("- Límite honesto: SLR73 es habla leída y grabada con buena calidad; la compresión de WhatsApp y los dos celulares son simulados. Con grabaciones reales de voluntarios (eval/audio/raw/) las distribuciones se van a abrir y hay que recalibrar. Por eso la voz nunca vincula sola y todo vínculo pasa por revisión humana.");
    const co = v.cohorte as Record<string, unknown>;
    p(`- Cohorte de referencia para s-norm: \`eval/cohort.npy\`, ${co.vectores} vectores de ${co.dim} dimensiones (${(co.hablantes as string[]).length} hablantes x ${co.audios_por_hablante} audios, ambos canales), backend ${co.backend}. Se carga en el contenedor con \`POST /voice/cohort\`.`);
  }
  p();

  // Ficha
  const f = r.ficha;
  p("## Ficha del caso (Muse Spark)");
  p();
  if (f.estado === "pendiente" || f.exactitud_global === null) {
    p(`Pendiente: ${f.motivo ?? ""}`);
  } else {
    p(`\`${f.modelo}\`, prompt \`FICHA_SYSTEM\` (versión ${f.prompt_version}), salida estructurada strict de \`FichaExtraction\` y \`reasoning.effort: "${f.reasoning_effort}"\`, sobre ${f.guiones} guiones ficticios. Se puntúan ${f.campos_puntuados.length} campos estructurados; ${f.campos_no_puntuados.join(", ")} son texto libre y no se puntúan.`);
    p();
    p(`**Exactitud global: ${pct(f.exactitud_global)}** (${f.fichas_perfectas} de ${f.guiones} fichas sin errores). Frases firma encontradas: ${pct(f.frases_firma_recall)}. Identificadores: precisión ${pct(f.identificadores.precision)}, recall ${pct(f.identificadores.recall)}. Fichas sin datos de la víctima: ${f.privacidad.fichas_sin_datos_victima}/${f.privacidad.total}.`);
    p();
    p("| Campo | Correctos |");
    p("|---|---|");
    for (const [k, x] of Object.entries(f.exactitud_por_campo)) p(`| ${k} | ${pct(x)} |`);
    p();
    const errores = f.casos.flatMap((c) =>
      Object.entries(c.campos)
        .filter(([, x]) => !x.ok)
        .map(([k, x]) => `| ${c.guion} | ${k} | ${JSON.stringify(x.esperado)} | ${JSON.stringify(x.obtenido)} |`),
    );
    if (errores.length) {
      p("<details><summary>Errores por guion</summary>");
      p();
      p("| Guion | Campo | Esperado | Obtenido |");
      p("|---|---|---|---|");
      for (const e of errores) p(e.replace(/\n/g, " "));
      p();
      p("</details>");
    }
    const fugas = f.casos.filter((c) => !c.privacidad_ok);
    if (fugas.length) p(`Fichas con datos de la víctima: ${fugas.map((c) => `${c.guion} (${c.privacidad_fugas.join(", ")})`).join("; ")}.`);
    p();
    p(`Costo de esta corrida: ${num(f.costo_usd_corrida, 4)} USD en ${f.llamadas_nuevas} llamadas nuevas (las demás salieron de la caché; costo total de las respuestas cacheadas: ${num(f.costo_usd_total_cacheado, 4)} USD).`);
  }
  p();

  // Identificadores
  const i = r.identificadores;
  p("## Identificadores");
  p();
  p(`${i.identificadores} identificadores de los escenarios en ${i.formatos_probados.length} formatos de escritura distintos, normalizados (E.164, dígitos, placas) y cifrados con HMAC-SHA256 con el código de \`packages/shared\` y una clave aleatoria de evaluación. **${i.verdaderos} de ${i.pares_esperados} pares esperados detectados (${pct(i.exactitud)})**, ${i.falsos.length} pares falsos, ${i.invalidos.length} identificadores inválidos. La cuenta que difiere en un dígito ${i.casos_cercanos_sin_falso_positivo ? "no" : "sí"} produjo un falso positivo. ${i.almacenado}`);
  p();

  // Imágenes
  const im = r.imagenes;
  p("## Imágenes reutilizadas");
  p();
  if (im.estado !== "ok") p(`Pendiente: ${im.motivo}`);
  else {
    const dd = im.distribuciones as Record<string, Record<string, number> | null>;
    p(`Fuentes ficticias: foto del demo y una foto parecida (Muse Image) y ${(im.fuentes ?? []).filter((x) => x.startsWith("N")).length} notas manuscritas generadas. Transformaciones: ${(im.transformaciones ?? []).join(", ")}. DINOv2 por el backend ${im.backend_dino}.`);
    p();
    p("| Transformación | Distancia de Hamming del phash frente al original | DINOv2 mínimo |");
    p("|---|---|---|");
    for (const [t, x] of Object.entries(im.por_transformacion ?? {})) p(`| ${t} | ${x.hamming.join(", ")} | ${num(x.dino_min, 3)} |`);
    p();
    p(`Pares de imágenes distintas: Hamming mínimo ${dd.hamming_distintas?.min}, DINOv2 hasta ${num(dd.dino_distintas?.max, 3)}. Foto del demo frente a la foto parecida: DINOv2 ${num(dd.dino_foto_A_vs_alternativa?.min, 3)} a ${num(dd.dino_foto_A_vs_alternativa?.max, 3)}. Con Hamming ≤ 10 se detecta ${pct(im.con_hamming_max_10?.reutilizadas_detectadas)} de las reutilizaciones y se marca ${pct(im.con_hamming_max_10?.distintas_marcadas)} de los pares distintos.`);
    p();
    p("Lectura: el hash perceptual reconoce sin error una foto reenviada por WhatsApp, pero falla con capturas de pantalla (recorte y bordes). DINOv2 sobre la imagen completa mide parecido de escena, no identidad: dos notas distintas con el mismo estilo o dos fotos parecidas de una bodega se parecen tanto como una foto y su captura. Por eso la propuesta deja a DINOv2 por debajo del umbral de revisión cuando va solo.");
  }
  p();

  // Escenarios
  const e = r.escenarios;
  p("## Motor de vinculación sobre los escenarios");
  p();
  p(`Señales medidas: ${e.senales_medidas.join(", ")} (el modus operandi sale de la ficha real del guion de cada caso y nunca vincula solo). Combinación 1 − ∏(1 − pᵢ) y umbrales 0.90 / 0.60 de \`packages/shared\`, con la calibración propuesta. ${e.estado === "parcial" ? `Parcial: ${e.motivo}.` : ""}`);
  p();
  p(`**${e.verdaderos} de ${e.pares_esperados} vínculos esperados propuestos (recall ${pct(e.recall)}), ${e.falsos} propuestas falsas (precisión ${pct(e.precision)}), ${num(e.falsos_por_100_comparaciones)} falsas por cada 100 de ${e.pares_totales} comparaciones.**`);
  p();
  p("| Escenario | Tipo | Esperados | Propuestos correctos | Falsos | Faltantes |");
  p("|---|---|---|---|---|---|");
  for (const [k, x] of Object.entries(e.por_escenario)) p(`| ${k} | ${x.tipo} | ${x.esperados} | ${x.verdaderos} | ${x.falsos} | ${x.faltantes} |`);
  p();

  const pe = e.propuestos_por_estado;
  if (pe) p(`Propuestos como "probable": ${pe.probable.esperados} correctos y ${pe.probable.falsos} falsos; como "por revisar": ${pe.por_revisar.esperados} correctos y ${pe.por_revisar.falsos} falsos.`);
  p();

  // Modus operandi
  const mo = r.modus_operandi;
  p("## Modus operandi");
  p();
  if (mo.estado !== "ok" || !mo.calibracion || !mo.verificaciones || !mo.comparacion || !mo.distribuciones || !mo.coseno_texto) {
    p(`Pendiente: ${mo.motivo ?? ""}`);
  } else {
    const c = mo.calibracion;
    const v = mo.verificaciones;
    const ct = mo.coseno_texto;
    const dx = mo.distribuciones;
    p(`Misma fórmula del pipeline (\`moProbability\` de \`services/api/src/linking/signals.ts\`, importada): ${mo.formula}. Fichas reales de Muse Spark para los 32 guiones y vectores \`${mo.modelo_texto}\` del contenedor (\`/text/embed\`, passage). ${mo.pares.mismo_guion} pares del mismo guion o banda frente a ${mo.pares.distintos} pares distintos.`);
    p();
    p(`- **El coseno de texto no separa nada:** mismo guion ${num(ct.mismo_guion!.media, 3)} ± ${num(ct.mismo_guion!.std, 3)}, distintos ${num(ct.distintos!.media, 3)} ± ${num(ct.distintos!.std, 3)}. Lo que separa son las frases firma comunes, el grupo y el canal: x = ${num(dx.x_mismo_guion!.media, 3)} ± ${num(dx.x_mismo_guion!.std, 3)} (mín. ${num(dx.x_mismo_guion!.min, 3)}) frente a ${num(dx.x_distintos!.media, 3)} ± ${num(dx.x_distintos!.std, 3)} (p99 ${num(dx.x_distintos!.p99, 3)}, máx. ${num(dx.x_distintos!.max, 3)}).`);
    p(`- **Umbral que importa:** con la voz en su tope (${r.calibracion.voz.p_max}), el vínculo llega a "probable" (${r.calibracion.thresholds.probable}) si el MO alcanza p_crit = 1 − (1 − ${r.calibracion.thresholds.probable}) / (1 − ${r.calibracion.voz.p_max}) = ${num(c.p_crit, 3)}.`);
    p(`- **Calibración (mismo método que la voz):** gaussiana b = ${num(c.b_gauss, 4)}, a = ${num(c.a, 1)}; la restricción "como máximo 1 de cada 100 pares distintos llega a p_crit" pide b ≥ ${num(c.b_restringido, 4)}. Propuesta: **a = ${num(c.a, 2)}, b = ${num(c.b, 4)}, p_max = ${c.p_max}**.`);
    p();
    p("| Calibración de MO | a | b | Pares del mismo guion que llegan a p_crit | Pares distintos que llegan a p_crit (voz sola + guion distinto → probable) |");
    p("|---|---|---|---|---|");
    const nombres: Record<string, string> = { anterior: "Anterior (valores iniciales)", propuesta_pipeline: "Propuesta del pipeline", propuesta: "**Propuesta (medida)**" };
    for (const [k, x] of Object.entries(mo.comparacion)) p(`| ${nombres[k] ?? k} | ${num(x.a, 2)} | ${num(x.b, 4)} | ${pct(x.mismo_guion_alcanzan_p_crit)} | ${pct(x.distintos_alcanzan_p_crit)} |`);
    p();
    p("Verificaciones con la propuesta:");
    p();
    p(`- (a) ${v.a_demo_AB.cumple ? "cumple" : "NO cumple"}: A–B del demo (voz coseno ${num(v.a_demo_AB.voz_coseno, 3)} → p ${num(v.a_demo_AB.p_voz, 2)}, MO ${num(v.a_demo_AB.p_mo, 3)}) da **${num(v.a_demo_AB.score, 3)}** (${v.a_demo_AB.estado}); con la calibración anterior daba ${num(v.a_demo_AB.con_calibracion_anterior, 3)}.`);
    p(`- (b) ${v.b_voz_sola_guion_distinto.cumple ? "cumple" : "NO cumple"}: con la voz en su tope y guion distinto, ${v.b_voz_sola_guion_distinto.llegan_a_probable} de ${v.b_voz_sola_guion_distinto.pares_guiones} pares de guiones llegarían a "probable" (${pct(v.b_voz_sola_guion_distinto.tasa)}); en el demo ${v.b_voz_sola_guion_distinto.demo.map((d) => `${d.par} queda en ${num(d.score_con_voz_al_tope, 3)} (${d.estado})`).join(" y ")}.`);
    p(`- (c) ${v.c_mo_solo.cumple ? "cumple" : "NO cumple"}: el MO solo llega como máximo a ${num(v.c_mo_solo.mo_max, 2)} (${v.c_mo_solo.estado_max}).`);
    p();
    p("Límite: los guiones de una misma familia comparten frases casi literales a propósito. Con guiones reales más variados, la señal de frases puede ser más débil; el Vinculador y la revisión humana siguen siendo la última palabra.");
    if (mo.demo_pares?.length) {
      p();
      p("<details><summary>Pares del demo</summary>");
      p();
      p("| Par | Coseno de texto | Frases comunes | Mismo canal | Mismo grupo | p MO |");
      p("|---|---|---|---|---|---|");
      for (const d of mo.demo_pares) p(`| ${d.par} | ${num(d.similitud_texto, 3)} | ${d.frases_comunes.join("; ") || "—"} | ${d.mismo_canal ? "sí" : "no"} | ${d.mismo_grupo ? "sí" : "no"} | ${num(d.p_mo, 3)} |`);
      p();
      p("</details>");
    }
  }
  p();

  // API
  p("## Agentes y privacidad (API desplegada)");
  p();
  const ag = r.agentes;
  p(`- **Fidelidad de citas de los agentes:** ${ag.estado === "ok" ? `${pct(ag.fidelidad)} (${ag.verificadas}/${ag.afirmaciones} afirmaciones con cita verificable; ${ag.sin_cita.length} sin cita, ${ag.citas_inexistentes.length} citas inexistentes)` : `${ag.estado}: ${ag.motivo}`}`);
  const es = r.privacidad.estadisticas_menos_5;
  p(`- **Estadísticas con menos de 5 casos:** ${es.estado === "ok" ? `${es.estadisticas_con_menos_de_5} (${es.perfiles_revisados} perfiles revisados, ${es.perfiles_con_menos_de_5_casos} de redes con menos de 5 casos)` : `${es.estado}: ${es.motivo}`}`);
  const inf = r.privacidad.infiltrado;
  p(`- **Prueba del infiltrado:** ${inf.estado === "ok" ? (inf.pasa ? "pasa" : "NO pasa") : `${inf.estado}: ${inf.motivo}`}`);
  for (const c of inf.chequeos) p(`  - ${c.ok ? "ok" : "falla"}: ${c.nombre}${c.detalle ? ` (${c.detalle})` : ""}`);
  for (const a of inf.advertencias ?? []) p(`  - Advertencia: ${a}`);
  p();

  // Calibración
  p("## Calibración propuesta (`eval/calibration.json`)");
  p();
  p("Forma de `Calibration` de `packages/shared`. Para cargarla en el Worker: `npx wrangler kv key put --binding CONFIG calibration:v1 --path ../../eval/calibration.json --remote` desde `services/api`.");
  p();
  p("```json");
  p(JSON.stringify(r.calibracion, null, 2));
  p("```");
  p();
  p("## Costos de la Meta Model API (evaluación)");
  p();
  p(`${num(r.costos.meta_api_usd_total, 4)} USD en ${r.costos.llamadas} llamadas, acumulado de todas las corridas de este frente. ${r.costos.nota}`);
  for (const [k, x] of Object.entries(r.costos.por_modelo)) p(`- \`${k}\`: ${x.llamadas} llamadas, ${num(x.cost_usd, 4)} USD`);
  p();
  p("## Cómo reproducir");
  p();
  p("```bash");
  p("pnpm eval                       # todo; descarga SLR73 si falta y usa la caché de la API");
  p("pnpm eval -- --sin-api          # sin las métricas que dependen de la API desplegada");
  p("ML_URL=http://localhost:8080 pnpm eval -- --voz-backend ml");
  p("```");
  p();
  p("Atribuciones y licencias de los datos en `eval/README.md`.");
  return L.join("\n") + "\n";
}
