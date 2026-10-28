import { vi } from "vitest";
import { env } from "cloudflare:workers";
import { evidenceLabel, type FichaStored } from "@blindaje/shared";
import { nextCounter } from "../src/lib/db";
import { caseCode, newId, nowIso, pseudonym } from "../src/lib/ids";
import { recomputeNetworks } from "../src/networks";
import * as agentsCommon from "../src/agents/common";
import { insertLink } from "./helpers";

/**
 * Datos ficticios para los tests de los agentes de red y un Meta API simulado.
 * Nada de esto es real: casos, voces, cuentas y zonas son inventados.
 */

export function daysAgo(n: number, hour = 10): string {
  const d = new Date(Date.now() - n * 86_400_000);
  d.setUTCHours(hour + 5, 0, 0, 0);
  return `${d.toISOString().slice(0, 19)}-05:00`;
}

export async function seedOrgRow(name = "Gremio ficticio de prueba"): Promise<string> {
  const id = `org-${newId().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO organizations (id, name, kind, is_demo, created_at) VALUES (?, ?, 'gremio', 0, ?)").bind(id, name, nowIso()).run();
  return id;
}

export async function seedDevice(orgId: string): Promise<{ id: string; pseudonym: string }> {
  const id = newId();
  const pse = pseudonym();
  await env.DB.prepare("INSERT INTO devices (id, org_id, pseudonym, public_key_jwk, platform, created_at) VALUES (?, ?, ?, '{}', 'android', ?)")
    .bind(id, orgId, pse, nowIso())
    .run();
  return { id, pseudonym: pse };
}

export interface SeedCaseOpts {
  orgId: string;
  device: { id: string; pseudonym: string };
  zona?: string | null;
  sector?: string;
  primer_contacto?: string;
  grupo?: string | null;
  canal?: "yape" | "plin" | "transferencia" | "efectivo" | "otro" | null;
  frases?: string[];
  plazo_horas?: number | null;
  escalamiento?: Array<{ fecha: string | null; tipo: string }>;
  evidence?: number;
  consent?: "comunitario" | "solo_denuncia";
}

export interface SeededCase {
  id: string;
  code: string;
  evidence: Array<{ id: string; label: string; sha256: string }>;
}

export async function seedCase(o: SeedCaseOpts): Promise<SeededCase> {
  const id = newId();
  let code = caseCode();
  while (await env.DB.prepare("SELECT 1 FROM cases WHERE code = ?").bind(code).first()) code = caseCode();
  const now = nowIso();
  const evidence: SeededCase["evidence"] = [];
  for (let i = 1; i <= (o.evidence ?? 2); i++) {
    evidence.push({ id: newId(), label: evidenceLabel(code, i), sha256: (newId() + newId()).replace(/-/g, "").slice(0, 64) });
  }
  const ev = evidence.map((e) => e.label);
  const ficha: FichaStored = {
    caso: code,
    zona: o.zona ?? null,
    sector: (o.sector ?? "bodega") as FichaStored["sector"],
    primer_contacto: o.primer_contacto ?? daysAgo(5),
    tipo_amenaza: "dano_local",
    amenaza: "Amenaza con dañar el local si no paga (ficticio)",
    monto_soles: 2000,
    periodicidad: "unico",
    plazo: o.plazo_horas ? `${o.plazo_horas} horas` : null,
    plazo_horas: o.plazo_horas ?? 48,
    canal_pago: o.canal === undefined ? "yape" : o.canal,
    identificadores: [],
    grupo_que_dice_ser: o.grupo === undefined ? "Los Ficticios del Cerro" : o.grupo,
    frases_firma: o.frases ?? ["habla con el jefe", "no llames a la policía"],
    escalamiento: (o.escalamiento ?? []).map((e) => ({ ...e, evidencia: [ev[ev.length - 1]!] })),
    resumen_mo: "Audio de voz masculina, pago por Yape con plazo de 48 horas (ficticio)",
    fuentes: ev,
  };
  await env.DB.prepare(
    `INSERT INTO cases (id, code, org_id, device_id, seudonimo_victima, sector, zona_cuadricula, primer_contacto, estado, consent_mode,
       ficha_json, indexed, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'listo', ?, ?, 1, 0, ?, ?)`,
  )
    .bind(id, code, o.orgId, o.device.id, o.device.pseudonym, o.sector ?? "bodega", o.zona ?? null, ficha.primer_contacto, o.consent ?? "comunitario", JSON.stringify(ficha), now, now)
    .run();
  let seq = 0;
  for (const e of evidence) {
    seq++;
    await env.DB.prepare(
      `INSERT INTO evidence (id, case_id, label, seq, tipo, mime, size_bytes, sha256, sha256_client, received_utc, captured_at, r2_key, uploader_pseudonym, status)
       VALUES (?, ?, ?, ?, ?, ?, 1000, ?, ?, ?, ?, ?, ?, 'procesado')`,
    )
      .bind(e.id, id, e.label, seq, seq === 1 ? "audio" : "imagen", seq === 1 ? "audio/ogg" : "image/jpeg", e.sha256, e.sha256, now, ficha.primer_contacto, `evidence/${e.id}`, o.device.pseudonym)
      .run();
  }
  return { id, code, evidence };
}

/** Agrega una huella de voz (V-n) a un caso, sacada de su primera evidencia. */
export async function addVoice(c: SeededCase, num?: number): Promise<number> {
  const n = num ?? (await nextCounter(env, "voice"));
  await env.DB.prepare(
    `INSERT INTO voice_prints (id, num, case_id, evidence_id, speaker, segmentos, duracion_seg, model, created_at)
     VALUES (?, ?, ?, ?, 'A', 4, 18.5, 'ecapa-ficticio', ?)`,
  )
    .bind(newId(), n, c.id, c.evidence[0]!.id, nowIso())
    .run();
  return n;
}

/** Identificador HMAC ficticio compartido (cuenta de cobro). Devuelve la referencia ID-xxxxxx. */
export async function addIdentifier(cases: SeededCase[], ultimos3 = "488"): Promise<string> {
  const hmac = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const ref = `ID-${hmac.slice(0, 6)}`;
  await env.DB.prepare("INSERT INTO identifiers (hmac, ref, tipo, ultimos_3, first_seen) VALUES (?, ?, 'cuenta_yape', ?, ?)").bind(hmac, ref, ultimos3, nowIso()).run();
  for (const c of cases) {
    await env.DB.prepare("INSERT INTO case_identifiers (case_id, hmac, rol, evidence_json, indexed, created_at) VALUES (?, ?, 'cobro', ?, 1, ?)")
      .bind(c.id, hmac, JSON.stringify([c.evidence[c.evidence.length - 1]!.label]), nowIso())
      .run();
  }
  return ref;
}

export async function addCrop(c: SeededCase, concept = "bala"): Promise<number> {
  const n = await nextCounter(env, "image");
  await env.DB.prepare(
    `INSERT INTO image_crops (id, num, case_id, evidence_id, concept, box_json, score, phash, created_at)
     VALUES (?, ?, ?, ?, ?, '{"x1":1,"y1":1,"x2":10,"y2":10}', 0.9, 'ffff0000ffff0000', ?)`,
  )
    .bind(newId(), n, c.id, c.evidence[c.evidence.length - 1]!.id, concept, nowIso())
    .run();
  return n;
}

export interface SeededNetwork {
  networkId: string;
  label: string;
  orgId: string;
  cases: SeededCase[];
  devices: Array<{ id: string; pseudonym: string }>;
  links: Array<{ id: string; num: number }>;
  voices: number[];
  identifier: string;
  crop: number;
}

/**
 * Red ficticia: `n` casos en cadena (A–B, B–C…) con vínculos confirmados, una huella de voz
 * compartida por todos, una cuenta de cobro compartida por los dos primeros y una imagen.
 */
export async function seedNetwork(opts: { n?: number; victims?: number; zona?: string } = {}): Promise<SeededNetwork> {
  const orgId = await seedOrgRow();
  const devices = [];
  for (let i = 0; i < (opts.victims ?? opts.n ?? 3); i++) devices.push(await seedDevice(orgId));
  const cases: SeededCase[] = [];
  for (let i = 0; i < (opts.n ?? 3); i++) {
    cases.push(
      await seedCase({
        orgId,
        device: devices[i % devices.length]!,
        zona: opts.zona ?? "Lima Este - E12",
        sector: i % 2 ? "mototaxi" : "bodega",
        primer_contacto: daysAgo(20 - i * 3),
        escalamiento: i === 0 ? [{ fecha: daysAgo(20 - 6).slice(0, 10), tipo: "Foto del local con una bala" }] : [],
      }),
    );
  }
  // V-n es único por fila: cada caso tiene su huella; el motor las relaciona en las señales de voz.
  const voices: number[] = [];
  for (const c of cases) voices.push(await addVoice(c));
  const identifier = await addIdentifier(cases.slice(0, 2));
  const crop = await addCrop(cases[0]!);
  const links = [];
  for (let i = 1; i < cases.length; i++) links.push(await insertLink(cases[i - 1]!.id, cases[i]!.id, "confirmado", 0.9 + i / 100));
  for (let i = 1; i < cases.length; i++) {
    const [a, b] = [cases[i - 1]!, cases[i]!];
    const signals = {
      voz: { p: 0.8, similitud: 0.82, z: null, segmentos: 3, segmentos_total: 4, huellas: [`V-${voices[i - 1]}`, `V-${voices[i]}`], evidencia: [a.evidence[0]!.label, b.evidence[0]!.label] },
      ...(i === 1 ? { identificador: { p: 0.95, compartidos: [{ ref: identifier, tipo: "cuenta_yape", ultimos_3: "488", evidencia: [a.evidence[1]!.label, b.evidence[1]!.label] }] } } : {}),
    };
    await env.DB.prepare("UPDATE links SET reviewed_at = ?, signals_json = ? WHERE id = ?").bind(nowIso(), JSON.stringify(signals), links[i - 1]!.id).run();
  }
  await recomputeNetworks(env);
  const net = await env.DB.prepare("SELECT n.id, n.num FROM networks n JOIN network_cases nc ON nc.network_id = n.id WHERE nc.case_id = ?")
    .bind(cases[0]!.id)
    .first<{ id: string; num: number }>();
  return { networkId: net!.id, label: `R-${String(net!.num).padStart(3, "0")}`, orgId, cases, devices, links, voices, identifier, crop };
}

// ---------------------------------------------------------------------------
// Meta API simulada
// ---------------------------------------------------------------------------

export type OutputItem = Record<string, unknown>;

export interface RecordedRequest {
  url: string;
  body: Record<string, unknown>;
}

export function call(name: string, args: Record<string, unknown>): OutputItem {
  return { type: "function_call", id: `fc_${newId().slice(0, 8)}`, call_id: `call_${newId().slice(0, 8)}`, name, arguments: JSON.stringify(args), status: "completed" };
}

export function final(value: unknown): OutputItem {
  return { type: "message", id: `msg_${newId().slice(0, 8)}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value), annotations: [] }] };
}

/** Salidas de herramientas que el Worker le mandó al modelo en una petición. */
export function toolOutputs(req: RecordedRequest): string[] {
  const input = req.body.input;
  if (!Array.isArray(input)) return [];
  return input.filter((i: { type?: string }) => i.type === "function_call_output").map((i: { output: string }) => i.output);
}

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type MetaFetch = (url: string, init: { body?: string | ArrayBuffer }) => Promise<Response>;
type FetchSeam = (fetch: MetaFetch | null) => void;

/** `setMetaFetchForTests` de src/agents/common (si existe): el cliente de Meta usa ese fetch. */
const metaSeam = (agentsCommon as unknown as { setMetaFetchForTests?: FetchSeam }).setMetaFetchForTests;

/** Lo mismo que instala test/setup.ts por defecto: ningún test habla con la Meta API real. */
const metaOff: MetaFetch = async () =>
  Response.json({ error: { message: "Meta API no simulada en este test", type: "invalid_request_error", code: "unauthorized" } }, { status: 401 });

/** Deja la Meta API simulada apagada (401) y quita los espías de `fetch`. Para `afterEach`. */
export function restoreMeta(): void {
  vi.restoreAllMocks();
  metaSeam?.(metaOff);
}

/**
 * Meta API simulada. Cada petición a /responses consume el siguiente paso del guion (una función
 * que recibe la petición y devuelve los ítems de salida); sin pasos, usa `fallback`. Usa el
 * `fetch` inyectable del cliente de Meta (o, si no existe, un espía sobre `globalThis.fetch`).
 */
/** Un paso del guion: ítems de salida, o una respuesta HTTP tal cual (por ejemplo un 400 de Meta). */
export type MetaStep = (req: RecordedRequest) => OutputItem[] | Response;

export function fakeMeta(script: MetaStep[], fallback?: MetaStep) {
  const requests: RecordedRequest[] = [];
  const queue = [...script];
  const handle: MetaFetch = async (url, init) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const req = { url, body };
    requests.push(req);
    if (url.endsWith("/images/generations")) {
      return Response.json({ created: 1, data: [{ b64_json: PNG_1PX }], output_format: "png" }, { headers: { "x-request-id": "req-img" } });
    }
    const step = queue.shift() ?? fallback;
    if (!step) return Response.json({ error: { message: "guion agotado" } }, { status: 400 });
    const output = step(req);
    if (output instanceof Response) return output;
    return Response.json(
      {
        id: `resp_${requests.length}`,
        object: "response",
        model: String(body.model),
        status: "completed",
        output,
        usage: { input_tokens: 2000, output_tokens: 300, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 } },
      },
      { headers: { "x-request-id": `req-${requests.length}` } },
    );
  };
  if (metaSeam) {
    metaSeam(handle);
  } else {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://api.meta.ai/")) return realFetch(input, init);
      return handle(url, { body: init?.body as string | undefined });
    });
  }
  return {
    requests,
    responses: () => requests.filter((r) => r.url.endsWith("/responses")),
    remaining: () => queue.length,
  };
}

export const PNG_BYTES = Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0));
