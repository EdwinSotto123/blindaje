import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VICTIM_FORBIDDEN_KEYS, extractCitations, MIN_CASES_FOR_STATS } from "@blindaje/shared";
import { Api, ApiHttpError, consoleLogin } from "./api-client";
import { RESULTS_DIR, apiUrl } from "./env";
import { hasDemoSecret, loadDemo, prepareCase, submitAndWait } from "./demo-data";

/**
 * Métricas que dependen de la API desplegada (docs/API.md). Se corren después de `pnpm demo:seed`.
 * Si la API, los datos del demo o las salidas de los agentes todavía no existen, cada métrica
 * queda "pendiente" con el motivo: nunca se inventa un resultado.
 *
 *  - Fidelidad de citas de los agentes: cada afirmación del Vinculador (afirmaciones y
 *    contradicciones), del Cartógrafo (hechos e hipótesis) y del Vigía (evidencia de la alerta)
 *    debe citar al menos un identificador y todos sus identificadores deben existir en el material
 *    que la consola expone (EV-…, FICHA-…, VIN-…, V-…, ID-…, IMG-…, R-…).
 *  - Cero estadísticas con menos de 5 casos: ningún perfil de red con menos de 5 casos muestra
 *    territorio.
 *  - Prueba del infiltrado (16.3): un dispositivo nuevo se registra como víctima, sube un audio
 *    con la misma voz de A y B y la cuenta de B y C, y nunca recibe vínculos ni datos de otros casos.
 */

type Estado = "ok" | "pendiente" | "error";

export interface AgentesReport {
  estado: Estado;
  motivo?: string;
  salidas: number;
  afirmaciones: number;
  verificadas: number;
  fidelidad: number | null;
  sin_cita: string[];
  citas_inexistentes: string[];
  por_agente: Record<string, { salidas: number; afirmaciones: number; verificadas: number }>;
  validacion_de_la_api: { vinculador_valid_false: number; perfiles_citation_check_false: number };
}

export interface EstadisticasReport {
  estado: Estado;
  motivo?: string;
  perfiles_revisados: number;
  perfiles_con_menos_de_5_casos: number;
  estadisticas_con_menos_de_5: number;
  detalle: { red: string; casos: number; territorio: number }[];
}

export interface InfiltradoReport {
  estado: Estado;
  motivo?: string;
  pasa: boolean | null;
  chequeos: { nombre: string; ok: boolean; detalle?: string }[];
}

export interface ApiEvalsReport {
  api: string | null;
  agentes: AgentesReport;
  estadisticas_menos_5: EstadisticasReport;
  infiltrado: InfiltradoReport;
}

const pend = (motivo: string) => ({ estado: "pendiente" as const, motivo });

function demoSeedResult(): { casos: Record<string, { case_id: string }> } | null {
  const p = resolve(RESULTS_DIR, "demo-seed.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function collectStrings(x: unknown, out: Set<string>) {
  if (typeof x === "string") {
    for (const c of extractCitations(x)) out.add(c);
    if (/^(EV|FICHA|VIN|V|ID|IMG|R)-/.test(x)) out.add(x);
  } else if (Array.isArray(x)) x.forEach((v) => collectStrings(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach((v) => collectStrings(v, out));
}

function forbiddenKeys(x: unknown, path = "$", out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v, i) => forbiddenKeys(v, `${path}[${i}]`, out));
  else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      if ((VICTIM_FORBIDDEN_KEYS as readonly string[]).includes(k)) out.push(`${path}.${k}`);
      forbiddenKeys(v, `${path}.${k}`, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

interface Claim {
  agente: string;
  texto: string;
  evidencia: string[];
}

async function runAgentes(api: Api): Promise<{ agentes: AgentesReport; estadisticas: EstadisticasReport }> {
  const base: AgentesReport = {
    estado: "pendiente",
    salidas: 0,
    afirmaciones: 0,
    verificadas: 0,
    fidelidad: null,
    sin_cita: [],
    citas_inexistentes: [],
    por_agente: {},
    validacion_de_la_api: { vinculador_valid_false: 0, perfiles_citation_check_false: 0 },
  };
  const est: EstadisticasReport = {
    estado: "pendiente",
    perfiles_revisados: 0,
    perfiles_con_menos_de_5_casos: 0,
    estadisticas_con_menos_de_5: 0,
    detalle: [],
  };
  let token: string;
  try {
    token = await consoleLogin(api, "analyst");
  } catch (e) {
    const m = `No se pudo entrar a la consola como analista (${e instanceof Error ? e.message : e}). Corre pnpm demo:seed.`;
    return { agentes: { ...base, motivo: m }, estadisticas: { ...est, motivo: m } };
  }
  const known = new Set<string>();
  const claims: Claim[] = [];
  let salidas = 0;
  const porAgente: AgentesReport["por_agente"] = {};
  const addClaims = (agente: string, list: { texto: string; evidencia: string[] }[]) => {
    porAgente[agente] ??= { salidas: 0, afirmaciones: 0, verificadas: 0 };
    porAgente[agente].salidas++;
    salidas++;
    for (const c of list) claims.push({ agente, texto: c.texto, evidencia: c.evidencia });
  };

  try {
    // Vinculador
    const { links } = await api.request<{ links: Record<string, unknown>[] }>("/v1/console/links?status=todos", { token });
    for (const l of links) {
      collectStrings({ label: l.label, signals: l.signals, a: l.case_a, b: l.case_b, fragments: l.fragments }, known);
      const v = l.vinculador as { afirmaciones: Claim[]; contradicciones: Claim[] } | null;
      if (v) addClaims("vinculador", [...v.afirmaciones, ...v.contradicciones]);
      if (l.vinculador_valid === false) base.validacion_de_la_api.vinculador_valid_false++;
    }
    // Redes, Cartógrafo (perfil) y estadísticas
    const { networks } = await api.request<{ networks: { id: string; label: string; n_cases: number }[] }>("/v1/console/networks", { token });
    for (const n of networks) {
      const view = await api.request<Record<string, unknown>>(`/v1/console/networks/${n.id}`, { token });
      collectStrings(view, known);
      known.add(n.label);
      const { profiles } = await api.request<{ profiles: { perfil: Record<string, unknown>; citation_check: { ok: boolean } }[] }>(
        `/v1/console/networks/${n.id}/profiles`,
        { token },
      );
      for (const p of profiles) {
        const perfil = p.perfil as { hechos: Claim[]; hipotesis: Claim[]; territorio: unknown[] };
        addClaims("cartografo", [...perfil.hechos, ...perfil.hipotesis]);
        if (!p.citation_check.ok) base.validacion_de_la_api.perfiles_citation_check_false++;
        est.perfiles_revisados++;
        const menos5 = n.n_cases < MIN_CASES_FOR_STATS;
        if (menos5) est.perfiles_con_menos_de_5_casos++;
        if (menos5 && perfil.territorio.length > 0) est.estadisticas_con_menos_de_5++;
        est.detalle.push({ red: n.label, casos: n.n_cases, territorio: perfil.territorio.length });
      }
    }
    // Vigía
    const { alerts } = await api.request<{ alerts: { borrador: { titulo: string; evidencia: string[] } }[] }>("/v1/console/alerts", { token });
    for (const a of alerts) addClaims("vigia", [{ texto: a.borrador.titulo, evidencia: a.borrador.evidencia }]);
  } catch (e) {
    const m = e instanceof ApiHttpError && e.status === 501 ? "La API todavía no implementa esta ruta (501)" : String(e instanceof Error ? e.message : e);
    return { agentes: { ...base, estado: "error", motivo: m }, estadisticas: { ...est, estado: "error", motivo: m } };
  }

  for (const c of claims) {
    const citas = new Set([...c.evidencia, ...extractCitations(c.texto)]);
    const inexistentes = [...citas].filter((x) => !known.has(x));
    const ok = citas.size > 0 && inexistentes.length === 0;
    porAgente[c.agente]!.afirmaciones++;
    if (ok) porAgente[c.agente]!.verificadas++;
    if (citas.size === 0) base.sin_cita.push(`${c.agente}: ${c.texto.slice(0, 80)}`);
    base.citas_inexistentes.push(...inexistentes.map((x) => `${c.agente}: ${x}`));
  }
  const verificadas = Object.values(porAgente).reduce((n, a) => n + a.verificadas, 0);
  const agentes: AgentesReport =
    claims.length === 0
      ? { ...base, salidas, por_agente: porAgente, motivo: "Todavía no hay salidas de los agentes (Vinculador, Cartógrafo, Vigía) en el entorno del demo." }
      : { ...base, estado: "ok", salidas, afirmaciones: claims.length, verificadas, fidelidad: verificadas / claims.length, por_agente: porAgente };
  const estadisticas: EstadisticasReport =
    est.perfiles_revisados === 0
      ? { ...est, motivo: "Todavía no hay perfiles de red del Cartógrafo para revisar." }
      : { ...est, estado: "ok" };
  return { agentes, estadisticas };
}

// ---------------------------------------------------------------------------------------------

async function runInfiltrado(api: Api, waitSeconds: number): Promise<InfiltradoReport> {
  const seed = demoSeedResult();
  if (!seed) return { ...pend("Falta correr pnpm demo:seed (los casos A, B y C son el blanco de la prueba)."), pasa: null, chequeos: [] };
  const demo = loadDemo();
  const chequeos: InfiltradoReport["chequeos"] = [];
  const check = (nombre: string, ok: boolean, detalle?: string) => chequeos.push({ nombre, ok, ...(detalle ? { detalle } : {}) });
  try {
    const p = await prepareCase(api, "infiltrado", demo.infiltrado);
    const r = await submitAndWait(api, p, demo.infiltrado.relato, waitSeconds);
    check("Su caso se procesa con normalidad", r.status === "listo" || r.status === "procesando", `estado: ${r.status}`);
    const t = p.session.access_token;
    const respuestas: Record<string, unknown> = {
      casos: await api.request("/v1/cases", { token: t }),
      reporte: await api.request(`/v1/cases/${p.case_id}/report`, { token: t }),
      alertas: await api.request("/v1/alerts", { token: t }),
    };
    const claves = forbiddenKeys(respuestas);
    check("Ninguna respuesta trae claves prohibidas (vínculos, redes, puntajes, HMAC…)", claves.length === 0, claves.join(", ") || undefined);
    const blob = JSON.stringify(respuestas);
    const codigos = demo.casos.map((c) => c.code);
    const otros = [
      ...codigos.flatMap((k) => [`EV-${k}1`, `EV-${k}2`, `FICHA-${k}`]),
      ...Object.values(seed.casos).map((c) => c.case_id),
    ].filter((x) => blob.includes(x));
    check(`No aparece ningún caso, evidencia ni ficha de los casos del demo (${codigos.join(", ")})`, otros.length === 0, otros.join(", ") || undefined);
    const digits = blob.replace(/\D/g, "");
    // La cuenta recaudadora la subió el propio infiltrado: puede verla en su ficha. Las demás no.
    const ajenos = Object.entries(demo.identificadores)
      .filter(([k]) => k !== "yape_recaudadora")
      .map(([, x]) => x.replace(/\D/g, "").replace(/^51/, ""))
      .filter((d) => digits.includes(d));
    check("No aparecen números ni cuentas de otros casos", ajenos.length === 0, ajenos.join(", ") || undefined);
    check("No aparecen etiquetas de vínculos ni redes (VIN-, R-)", !/\bVIN-\d+|\bR-\d{3}/.test(blob));
    const ajeno = Object.values(seed.casos)[0]!.case_id;
    try {
      await api.request(`/v1/cases/${ajeno}/report`, { token: t });
      check("Pedir el reporte de otro caso responde 404", false, "respondió 200");
    } catch (e) {
      check("Pedir el reporte de otro caso responde 404", e instanceof ApiHttpError && e.status === 404, e instanceof ApiHttpError ? `${e.status}` : String(e));
    }
    try {
      await api.request("/v1/console/links", { token: t });
      check("La consola rechaza el token de víctima", false, "respondió 200");
    } catch (e) {
      check("La consola rechaza el token de víctima", e instanceof ApiHttpError && (e.status === 401 || e.status === 403), e instanceof ApiHttpError ? `${e.status}` : String(e));
    }
    // Limpieza: el caso del infiltrado no debe quedar en la red ni en el conteo del Vigía.
    try {
      await api.request(`/v1/cases/${p.case_id}`, { method: "DELETE", token: t });
      check("El infiltrado puede borrar su propio caso (y deja de contar en la red)", true);
    } catch (e) {
      check("El infiltrado puede borrar su propio caso (y deja de contar en la red)", false, e instanceof Error ? e.message : String(e));
    }
  } catch (e) {
    return { estado: "error", motivo: e instanceof Error ? e.message : String(e), pasa: null, chequeos };
  }
  return { estado: "ok", pasa: chequeos.every((c) => c.ok), chequeos };
}

export async function runApiEvals(opts: { waitSeconds?: number } = {}): Promise<ApiEvalsReport> {
  const url = apiUrl();
  if (!url) {
    const m = "La API no está desplegada (falta API_URL o la URL en services/api/README.md).";
    return {
      api: null,
      agentes: { ...pend(m), salidas: 0, afirmaciones: 0, verificadas: 0, fidelidad: null, sin_cita: [], citas_inexistentes: [], por_agente: {}, validacion_de_la_api: { vinculador_valid_false: 0, perfiles_citation_check_false: 0 } },
      estadisticas_menos_5: { ...pend(m), perfiles_revisados: 0, perfiles_con_menos_de_5_casos: 0, estadisticas_con_menos_de_5: 0, detalle: [] },
      infiltrado: { ...pend(m), pasa: null, chequeos: [] },
    };
  }
  const api = new Api(url);
  try {
    await api.request("/v1/health");
  } catch (e) {
    const m = `La API no responde: ${e instanceof Error ? e.message : e}`;
    return {
      api: url,
      agentes: { ...pend(m), salidas: 0, afirmaciones: 0, verificadas: 0, fidelidad: null, sin_cita: [], citas_inexistentes: [], por_agente: {}, validacion_de_la_api: { vinculador_valid_false: 0, perfiles_citation_check_false: 0 } },
      estadisticas_menos_5: { ...pend(m), perfiles_revisados: 0, perfiles_con_menos_de_5_casos: 0, estadisticas_con_menos_de_5: 0, detalle: [] },
      infiltrado: { ...pend(m), pasa: null, chequeos: [] },
    };
  }
  const { agentes, estadisticas } = await runAgentes(api);
  const infiltrado = hasDemoSecret() || demoSeedResult()
    ? await runInfiltrado(api, opts.waitSeconds ?? 120)
    : { ...pend("Falta DEMO_SECRET y pnpm demo:seed."), pasa: null, chequeos: [] };
  return { api: url, agentes, estadisticas_menos_5: estadisticas, infiltrado };
}
