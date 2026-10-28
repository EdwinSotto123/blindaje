import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Api, ApiHttpError, deviceSession, mimeFor, sha256Hex, type DeviceSession } from "./api-client";
import { DEMO_DIR, apiUrl, requireSecret, secret } from "./env";

/** Datos y pasos compartidos por demo:seed, demo:reset y las métricas que dependen de la API. */

export interface EvidenciaDemo {
  tipo: "audio" | "imagen" | "texto";
  archivo?: string;
  texto?: string;
  /** Días antes de hoy (hora de Lima). */
  dia: number;
  /** HH:MM, hora de Lima. */
  hora: string;
  /** Se calcula al cargar: ISO 8601 con -05:00. */
  captured_at: string;
  source: string;
}
export interface CasoDemo {
  code: string;
  invite: string;
  /** Caso de fondo (solo texto) para que la red y el Vigía tengan volumen. */
  fondo?: boolean;
  sector: string;
  zona: string;
  consent_mode: "comunitario" | "solo_denuncia";
  muestra_voz?: string;
  evidencia: EvidenciaDemo[];
  relato: string;
}
export interface DemoFile {
  ficticio: true;
  identificadores: Record<string, string>;
  casos: CasoDemo[];
  infiltrado: Omit<CasoDemo, "code">;
}

const LIMA_MS = -5 * 3600 * 1000;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Fecha (YYYY-MM-DD) de hace `dias` días en Lima, relativa a `ahora`. */
function diaLima(dias: number, ahora: Date): { ymd: string; texto: string } {
  const d = new Date(ahora.getTime() + LIMA_MS - dias * 86400000);
  const ymd = d.toISOString().slice(0, 10);
  return { ymd, texto: `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}` };
}

/** Carga demo.json y resuelve las fechas relativas al momento actual (o a DEMO_TODAY=YYYY-MM-DD). */
export function loadDemo(ahora = process.env.DEMO_TODAY ? new Date(`${process.env.DEMO_TODAY}T12:00:00-05:00`) : new Date()): DemoFile {
  const raw = JSON.parse(readFileSync(resolve(DEMO_DIR, "demo.json"), "utf8")) as DemoFile;
  const resolver = (c: Omit<CasoDemo, "code">) => {
    for (const e of c.evidencia) e.captured_at = `${diaLima(e.dia, ahora).ymd}T${e.hora}:00-05:00`;
    c.relato = c.relato.replace(/\{fecha:(\d+)\}/g, (_, n: string) => diaLima(Number(n), ahora).texto);
  };
  raw.casos.forEach(resolver);
  resolver(raw.infiltrado);
  return raw;
}

export function demoApi(): Api {
  const url = apiUrl();
  if (!url) throw new Error("Falta API_URL (o la URL en services/api/README.md)");
  return new Api(url);
}

export function demoSecret(): string {
  return requireSecret("DEMO_SECRET");
}

export function hasDemoSecret(): boolean {
  return Boolean(secret("DEMO_SECRET"));
}

interface CaseSummary {
  id: string;
  code: string;
  status: string;
  consent_mode: string;
  evidence_count: number;
}

function ffprobeDurationMs(path: string): number | undefined {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], {
      encoding: "utf8",
    });
    return Math.round(Number(out.trim()) * 1000);
  } catch {
    return undefined;
  }
}

export interface PreparedCase {
  code: string;
  case_id: string;
  status: string;
  session: DeviceSession;
  creado: boolean;
  subidas: { etiqueta: string; nueva: boolean }[];
  muestra_voz: "ok" | "omitida" | string;
}

/**
 * Registra (o renueva) el dispositivo, crea el caso si no existe, sube la muestra de voz y la
 * evidencia (idempotente por SHA-256). No envía el caso.
 */
export async function prepareCase(api: Api, name: string, c: Omit<CasoDemo, "code"> & { code?: string }): Promise<PreparedCase> {
  const { s, nuevo } = await deviceSession(api, name, c.invite);
  console.log(`  dispositivo ${name}: ${nuevo ? "registrado" : "sesión renovada"} (${s.pseudonym})`);
  let muestra: PreparedCase["muestra_voz"] = "omitida";
  if (c.muestra_voz) {
    try {
      await api.request("/v1/me/voice-sample", {
        token: s.access_token,
        body: readFileSync(resolve(DEMO_DIR, c.muestra_voz)),
        headers: { "content-type": mimeFor(c.muestra_voz) },
      });
      muestra = "ok";
    } catch (e) {
      muestra = e instanceof Error ? e.message : String(e);
    }
    console.log(`  muestra de voz de la víctima: ${muestra}`);
  }
  const { cases } = await api.request<{ cases: CaseSummary[] }>("/v1/cases", { token: s.access_token });
  let cs = c.code ? cases.find((x) => x.code === c.code) : cases[0];
  let creado = false;
  if (!cs) {
    cs = await api.request<CaseSummary>("/v1/cases", {
      token: s.access_token,
      json: { sector: c.sector, zona: c.zona, consent_mode: c.consent_mode },
      headers: c.code ? { "x-demo-case-code": c.code } : {},
    });
    creado = true;
  }
  console.log(`  caso ${cs.code}: ${creado ? "creado" : "ya existía"} (${cs.status})`);
  const subidas: PreparedCase["subidas"] = [];
  for (const ev of c.evidencia) {
    const bytes = ev.archivo ? readFileSync(resolve(DEMO_DIR, ev.archivo)) : Buffer.from(ev.texto ?? "", "utf8");
    const mime = ev.archivo ? mimeFor(ev.archivo) : "text/plain; charset=utf-8";
    const headers: Record<string, string> = {
      "content-type": mime,
      "x-evidence-type": ev.tipo,
      "x-content-sha256": sha256Hex(bytes),
      "x-captured-at": ev.captured_at,
      "x-source": ev.source,
    };
    if (ev.archivo && ev.tipo === "audio") {
      const ms = ffprobeDurationMs(resolve(DEMO_DIR, ev.archivo));
      if (ms) headers["x-duration-ms"] = String(ms);
    }
    const res = await fetch(`${api.base}/v1/cases/${cs.id}/evidence`, {
      method: "POST",
      headers: { ...headers, authorization: `Bearer ${s.access_token}` },
      body: new Uint8Array(bytes),
    });
    const data = (await res.json().catch(() => null)) as { label?: string; error?: { code: string; message: string } } | null;
    if (!res.ok) throw new ApiHttpError(res.status, data?.error?.code ?? "http_error", data?.error?.message ?? "", data);
    subidas.push({ etiqueta: data?.label ?? "?", nueva: res.status === 201 });
    console.log(`  ${data?.label}: ${ev.archivo ?? "mensaje de texto"} ${res.status === 201 ? "subido" : "ya estaba"} (SHA-256 ${headers["x-content-sha256"]!.slice(0, 12)}…)`);
  }
  return { code: cs.code, case_id: cs.id, status: cs.status, session: s, creado, subidas, muestra_voz: muestra };
}

export interface ProcessingResult {
  status: string;
  segundos: number;
  hallazgos: string[];
  report: unknown;
}

/** Envía el caso ("Preparar mi denuncia") y espera a que deje de estar "procesando". */
export async function submitAndWait(api: Api, p: PreparedCase, relato: string, maxSeconds: number): Promise<ProcessingResult> {
  const sinCambios = !p.creado && p.subidas.every((x) => !x.nueva) && (p.status === "listo" || p.status === "procesando");
  let r = { status: p.status };
  if (sinCambios) {
    console.log(`  submit ${p.code}: no hace falta (el caso ya está ${p.status} y no hay evidencia nueva)`);
  } else {
    r = await api.request<{ status: string }>(`/v1/cases/${p.case_id}/submit`, {
      token: p.session.access_token,
      json: { narrative: relato },
    });
    console.log(`  submit ${p.code}: ${r.status}`);
  }
  const t0 = Date.now();
  let report: { status: string; hallazgos?: string[] } = { status: r.status };
  while ((Date.now() - t0) / 1000 < maxSeconds) {
    report = await api.request(`/v1/cases/${p.case_id}/report`, { token: p.session.access_token });
    if (report.status !== "procesando") break;
    await new Promise((res) => setTimeout(res, 5000));
  }
  const segundos = Math.round((Date.now() - t0) / 1000);
  return { status: report.status, segundos, hallazgos: report.hallazgos ?? [], report };
}
