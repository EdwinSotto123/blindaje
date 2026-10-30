import type { VictimReportConConsejos } from "@/api/client";
import type { Fetcher, HttpRequest, HttpResponse } from "@/api/http";
import { fromUtf8, toHex, utf8 } from "@/lib/bytes";
import { sha256Hex } from "@/security/hash";
import {
  type BusinessRecommendationView,
  CENTRAL_ORG_ID,
  type CaseSummary,
  districtOfZone,
  type EvidenceItem,
  type EvidenceType,
  hallazgosParaVictima,
  textoAutenticidadVictima,
  type TimelineEvent,
  type VictimAlert,
  type VictimReport,
} from "@/shared";

/**
 * Servidor simulado en memoria (EXPO_PUBLIC_MOCK_API=1). Respeta los esquemas de
 * packages/shared/src/api.ts; test/mock-api.test.ts valida cada respuesta con Zod.
 * TODO EL CONTENIDO ES FICTICIO.
 */

type Turn = VictimReport["evidencia"][number]["transcripcion"];

type MockEvidence = {
  item: EvidenceItem;
  text: string | null;
  source: string | null;
  processAt: number;
  transcript: NonNullable<Turn> | null;
  nota: string | null;
};

type MockCase = {
  device: string;
  summary: CaseSummary;
  sector: string | null;
  zona: string | null;
  evidence: MockEvidence[];
  narrative: string | null;
  readyAt: number | null;
};

type Device = { id: string; refresh: string; pseudonym: string; org: string };

export type MockOptions = {
  isOnline?: () => Promise<boolean> | boolean;
  latencyMs?: number;
  now?: () => number;
  /** Tiempo que tarda en "procesarse" cada evidencia. */
  processMs?: number;
};

/**
 * Sin código, el celular queda en la organización central, como en el API. Un código de invitación
 * (los APK antiguos lo mandan) solo marca el canal de difusión por el que llegó.
 */
const CENTRAL = { id: CENTRAL_ORG_ID, name: "Equipo central (ficticio)" };
const CANAL_DEMO = { id: "org_demo", name: "Canal de difusión de prueba (ficticio)" };

/** Guiones ficticios para las transcripciones simuladas. */
const GUIONES = [
  "Escucha bien, ya sabemos dónde queda tu bodega. Vas a yapear S/ 2,000 al 987 654 321 en 48 horas. Habla con el jefe, somos de Los X. Y no llames a la policía.",
  "Ya se te vence el plazo. Si no yapeas los dos mil, la próxima no es una foto. Al mismo número, 987 654 321. Habla con el jefe.",
];

const ALERTAS: VictimAlert[] = [
  {
    id: "al_demo_1",
    titulo: "Audios que dicen ser de “Los X”",
    cuerpo:
      "En las últimas semanas circulan audios que piden pagos por Yape con plazos de 48 horas. No pagues ni negocies. Guarda los mensajes y denuncia en la Línea 1818 o en tu comisaría.",
    zona: "San Juan de Lurigancho",
    distrito: "san-juan-de-lurigancho",
    que_hacer: ["No respondas ni pagues", "Guarda audios y mensajes aquí", "Llama a la Línea 1818"],
    approved_at: "2026-10-26T15:00:00-05:00",
  },
  {
    id: "al_demo_2",
    titulo: "Fotos del local enviadas por WhatsApp",
    cuerpo: "Varios comerciantes recibieron fotos de su local tomadas desde la calle. Si te pasa, guarda la foto aquí y no la publiques en redes.",
    zona: "San Juan de Miraflores",
    distrito: "san-juan-de-miraflores",
    que_hacer: ["Guarda la foto aquí", "No publiques la foto", "Si estás en peligro, llama al 105"],
    approved_at: "2026-10-22T10:30:00-05:00",
  },
];

/**
 * Recomendaciones de prevención aprobadas por el equipo central para un distrito y un rubro
 * (GET /v1/recommendations). Historia ficticia: bodegas de San Juan de Lurigancho y la modalidad
 * “Los X”. Nunca números ni cuentas completos y nunca pagar ni negociar. El orden por prioridad
 * está mezclado a propósito: la app lo ordena.
 */
const RECOMENDACIONES: BusinessRecommendationView[] = [
  {
    id: "rec_demo_1",
    sector: "bodegas",
    zona: "San Juan de Lurigancho",
    distrito: "san-juan-de-lurigancho",
    nivel_riesgo: "medio",
    resumen:
      "En las últimas semanas, varias bodegas de San Juan de Lurigancho recibieron audios de un grupo que dice ser “Los X”. Piden pagos por Yape y dan un plazo de 48 horas. No pagues ni negocies: guarda todo y denuncia.",
    modalidades: [
      {
        descripcion: "Mandan audios o mensajes que dicen ser de “Los X”. Piden un pago por Yape y dan 48 horas para pagar.",
        senales_de_alerta: ["Te dicen “habla con el jefe”.", "Te dan un plazo de 48 horas.", "Te piden yapear a un número que no conoces."],
      },
    ],
    recomendaciones: [
      {
        titulo: "Cuida lo que publicas",
        detalle: "No publiques en redes tus horarios ni cuánto vendes o guardas en caja. Revisa también lo que ya publicaste.",
        prioridad: "baja",
      },
      {
        titulo: "Guarda todo sin responder",
        detalle: "Guarda cada audio y cada captura en tus notas privadas. No respondas, aunque te presionen con el plazo.",
        prioridad: "alta",
      },
      {
        titulo: "Cuéntale a alguien de confianza",
        detalle: "No lo cargues solo. Cuéntale a alguien de tu confianza lo que recibiste y guarda todo aquí.",
        prioridad: "media",
      },
      {
        titulo: "Acuerda con tu personal que nadie negocia ni paga",
        detalle: "Si alguien de tu bodega recibe un audio o un mensaje, no responde y te lo pasa para que lo guardes.",
        prioridad: "alta",
      },
      {
        titulo: "Reconoce el guion",
        detalle: "Si te dicen “habla con el jefe” o te dan 48 horas para pagar, es el mismo guion. No respondas y guarda el audio.",
        prioridad: "media",
      },
    ],
    que_hacer_si_te_pasa: [
      "No respondas, no pagues y no negocies.",
      "Guarda el audio o la captura en tus notas privadas.",
      "Llama a la Línea 1818 o ve a tu comisaría.",
      "Si estás en peligro, llama al 105.",
    ],
    advertencias: [
      "Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa.",
      "Datos ficticios del demo.",
    ],
    approved_at: "2026-10-27T09:00:00-05:00",
  },
];

/**
 * Consejos de prevención según el propio caso (campo "consejos" del reporte). Solo usan los datos
 * de esta persona; nunca mencionan otros casos.
 */
function consejosPara(d: Datos, frases: string[]): string[] {
  const out = ["No respondas, no pagues y no negocies. Nadie de tu negocio debe hacerlo por ti."];
  if (d.canal_pago === "yape") out.push("No hagas ningún pago por Yape, aunque te presionen.");
  if (d.plazo) out.push(`El plazo de ${d.plazo} es para presionarte. Si llegan más mensajes, guárdalos aquí sin responder.`);
  if (frases.includes("habla con el jefe")) out.push("Si te vuelven a decir “habla con el jefe”, no contestes. Guarda el audio aquí.");
  out.push("Acuerda con tu personal que nadie negocia ni paga, y que te pasan todo lo que reciban.");
  out.push("No publiques en redes tus horarios ni montos de caja.");
  out.push("Lleva tu denuncia a la Línea 1818 o a tu comisaría. Si estás en peligro, llama al 105.");
  return out;
}

// ---------------------------------------------------------------------------
// Extracción simple de datos para "Lo que encontramos" (solo para el simulador)
// ---------------------------------------------------------------------------

type Datos = {
  canal_pago: "yape" | "plin" | null;
  monto_soles: number | null;
  plazo: string | null;
  grupo: string | null;
  telefonos: string[];
};

export function extraerDatos(texto: string): Datos {
  const t = texto.toLowerCase();
  const canal = /yape|yapea/.test(t) ? "yape" : /plin/.test(t) ? "plin" : null;
  let monto: number | null = null;
  const m = texto.match(/S\/\s?([\d.,]+)/i) ?? texto.match(/([\d][\d.,]*)\s*soles/i);
  if (m?.[1]) monto = Number(m[1].replace(/,/g, "")) || null;
  if (monto === null && /dos mil/.test(t)) monto = 2000;
  const plazo = texto.match(/(\d+)\s*horas/i);
  const grupo = texto.match(/(?:somos de|de parte de|somos)\s+(los\s+[a-záéíóúñ0-9]+)/i);
  const telefonos = Array.from(texto.matchAll(/\b9\d{2}\s?\d{3}\s?\d{3}\b/g)).map((x) => x[0].replace(/\s/g, ""));
  return {
    canal_pago: canal,
    monto_soles: monto,
    plazo: plazo ? `${plazo[1]} horas` : null,
    grupo: grupo?.[1] ? grupo[1].replace(/^los/i, "Los").replace(/ (\w)/, (_s, c: string) => ` ${c.toUpperCase()}`) : null,
    telefonos: Array.from(new Set(telefonos)),
  };
}

function mergeDatos(list: Datos[]): Datos {
  return {
    canal_pago: list.find((d) => d.canal_pago)?.canal_pago ?? null,
    monto_soles: list.find((d) => d.monto_soles != null)?.monto_soles ?? null,
    plazo: list.find((d) => d.plazo)?.plazo ?? null,
    grupo: list.find((d) => d.grupo)?.grupo ?? null,
    telefonos: Array.from(new Set(list.flatMap((d) => d.telefonos))),
  };
}

// ---------------------------------------------------------------------------
// PDF mínimo válido (una página, Helvetica)
// ---------------------------------------------------------------------------

function pdfEscape(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (c >= 32 && c < 127) out += ch;
    else if (c >= 160 && c <= 255) out += `\\${c.toString(8).padStart(3, "0")}`;
    else if (ch === "“" || ch === "”") out += '"';
    else if (ch === "—" || ch === "–") out += "-";
    else out += "?";
  }
  return out;
}

export function minimalPdf(lines: string[]): Uint8Array {
  const content =
    "BT /F1 12 Tf 56 780 Td 16 TL\n" + lines.map((l) => `(${pdfEscape(l)}) Tj T*`).join("\n") + "\nET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Array.from(pdf, (c) => c.charCodeAt(0) & 0xff));
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

function response(status: number, body?: unknown, contentType = "application/json"): HttpResponse {
  const isBytes = body instanceof Uint8Array;
  const text = body === undefined ? "" : isBytes ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    header: (n) => (n.toLowerCase() === "content-type" ? contentType : null),
    json: async () => (text ? JSON.parse(text) : null),
    text: async () => text,
    bytes: async () => (isBytes ? (body as Uint8Array) : utf8(text)),
  };
}

const err = (status: number, code: string, message: string) => response(status, { error: { code, message } });

function rid(prefix: string): string {
  const n = Math.floor(Math.random() * 0xffffffff);
  return `${prefix}_${n.toString(16).padStart(8, "0")}`;
}

export function createMockServer(opts: MockOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const processMs = opts.processMs ?? 2500;
  const devices = new Map<string, Device>();
  const tokens = new Map<string, { device: string; exp: number }>();
  const cases = new Map<string, MockCase>();
  let caseSeq = 0;
  let voiceSamples = 0;

  const iso = (ms = now()) => new Date(ms).toISOString();

  function issue(deviceId: string) {
    const access = `acc_${toHex(utf8(rid("t"))).slice(0, 24)}`;
    const refresh = `ref_${toHex(utf8(rid("r"))).slice(0, 24)}`;
    tokens.set(access, { device: deviceId, exp: now() + 15 * 60_000 });
    const d = devices.get(deviceId);
    if (d) d.refresh = refresh;
    return { access_token: access, refresh_token: refresh, expires_in: 900 };
  }

  function whoami(req: HttpRequest): string | null {
    const h = req.headers.authorization ?? req.headers.Authorization;
    const tok = h?.startsWith("Bearer ") ? h.slice(7) : null;
    const t = tok ? tokens.get(tok) : undefined;
    if (!t || t.exp < now()) return null;
    return t.device;
  }

  function jsonBody(req: HttpRequest): Record<string, unknown> {
    if (!req.body) return {};
    const s = typeof req.body === "string" ? req.body : fromUtf8(req.body);
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  function settle(c: MockCase) {
    const t = now();
    for (const e of c.evidence) {
      if (e.item.status !== "procesado" && t >= e.processAt) e.item.status = "procesado";
      else if (e.item.status === "recibido") e.item.status = "procesando";
    }
    if (c.summary.status === "procesando" && c.readyAt !== null && t >= c.readyAt) {
      c.summary.status = "listo";
      c.summary.updated_at = iso();
    }
  }

  function datosDe(c: MockCase): Datos {
    const textos = c.evidence
      .filter((e) => e.item.status === "procesado")
      .map((e) => e.text ?? e.transcript?.map((x) => x.text).join(" ") ?? "");
    if (c.narrative) textos.push(c.narrative);
    return mergeDatos(textos.map(extraerDatos));
  }

  function report(c: MockCase): VictimReportConConsejos {
    settle(c);
    const d = datosDe(c);
    const hallazgos = hallazgosParaVictima({
      canal_pago: d.canal_pago,
      plazo: d.plazo,
      grupo_que_dice_ser: d.grupo,
      monto_soles: d.monto_soles,
      tipo_amenaza: null,
    });
    const listo = c.summary.status === "listo";
    const frases = ["habla con el jefe", "no llames a la policía"].filter((f) =>
      c.evidence.some((e) => (e.text ?? e.transcript?.map((x) => x.text).join(" ") ?? "").toLowerCase().includes(f)),
    );
    const sorted = [...c.evidence].sort((a, b) => (a.item.captured_at ?? a.item.received_utc).localeCompare(b.item.captured_at ?? b.item.received_utc));
    const cronologia: TimelineEvent[] = listo
      ? sorted.map((e) => ({
          fecha: (e.item.captured_at ?? e.item.received_utc).slice(0, 10),
          texto:
            e.item.tipo === "audio"
              ? "Recibió un audio con exigencia de pago."
              : e.item.tipo === "imagen"
                ? "Recibió una foto de su local."
                : "Recibió un mensaje con exigencia de pago.",
          evidencia: [e.item.label],
        }))
      : [];
    return {
      case_id: c.summary.id,
      code: c.summary.code,
      status: c.summary.status,
      consent_mode: c.summary.consent_mode,
      hallazgos,
      ficha: listo
        ? {
            sector: c.sector,
            zona: c.zona,
            primer_contacto: sorted[0]?.item.captured_at ?? sorted[0]?.item.received_utc ?? null,
            amenaza: "Amenaza de daño al local si no paga en el plazo.",
            monto_soles: d.monto_soles,
            plazo: d.plazo,
            canal_pago: d.canal_pago,
            grupo_que_dice_ser: d.grupo,
            frases_firma: frases,
            identificadores: d.telefonos.map((v) => ({ tipo: d.canal_pago === "yape" ? "cuenta_yape" : "telefono", valor: v })),
            resumen:
              "Una voz masculina exige un pago por Yape con plazo de 48 horas, dice ser de un grupo y amenaza con dañar el local. Datos ficticios del demo.",
          }
        : null,
      cronologia,
      evidencia: c.evidence.map((e) => ({
        ...e.item,
        transcripcion: e.item.status === "procesado" ? e.transcript : null,
        nota: e.item.status === "procesado" ? e.nota : null,
        // Como el API: audio, imagen y video procesados traen el texto corto de autenticidad; el texto, null.
        autenticidad: e.item.status === "procesado" && e.item.tipo !== "texto" ? textoAutenticidadVictima("sin_senales") : null,
        origen: e.source,
      })),
      updated_at: c.summary.updated_at,
      consejos: listo ? consejosPara(d, frases) : [],
    };
  }

  /** El distrito pedido (?zona=) o, si no viene, el del último caso de este celular. */
  function zonaDe(device: string, params: URLSearchParams): string | null {
    const pedido = districtOfZone(params.get("zona"));
    if (pedido) return pedido.id;
    const ultimo = Array.from(cases.values())
      .filter((c) => c.device === device)
      .pop();
    return districtOfZone(ultimo?.zona)?.id ?? null;
  }

  async function route(url: string, req: HttpRequest): Promise<HttpResponse> {
    const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/v1/, "").split("?");
    const params = new URLSearchParams(search);
    const m = req.method;

    if (m === "GET" && path === "/health") return response(200, { ok: true, env: "mock", version: "mock" });

    if (m === "POST" && path === "/auth/device/register") {
      const b = jsonBody(req);
      // El código es opcional desde el rediseño. Si llega (APK antiguo), se valida como antes.
      const code = b.invite_code == null ? null : String(b.invite_code);
      if (code !== null && !/^[A-Za-z0-9-]{4,32}$/.test(code)) return err(400, "bad_request", "Código inválido");
      // Igual que el Worker: código inexistente o agotado = 400 bad_request.
      if (code?.toUpperCase().startsWith("NO")) return err(400, "bad_request", "El código de invitación no es válido o ya venció");
      const org = code ? CANAL_DEMO : CENTRAL;
      const id = rid("dev");
      const pseudonym = `V-${toHex(utf8(id)).slice(-4).toUpperCase()}`;
      devices.set(id, { id, refresh: "", pseudonym, org: org.id });
      return response(200, { ...issue(id), device_id: id, pseudonym, org });
    }

    if (m === "POST" && path === "/auth/device/refresh") {
      const b = jsonBody(req);
      const d = devices.get(String(b.device_id));
      if (!d || d.refresh !== b.refresh_token || typeof b.signature !== "string") return err(401, "unauthorized", "Sesión vencida");
      return response(200, issue(d.id));
    }

    if (m === "POST" && path === "/auth/logout") {
      const dev = whoami(req);
      if (dev) devices.delete(dev);
      return response(204);
    }

    const device = whoami(req);
    if (!device) return err(401, "unauthorized", "Falta token");

    if (m === "POST" && path === "/me/voice-sample") {
      voiceSamples += 1;
      return response(200, { ok: true });
    }

    if (m === "POST" && path === "/cases") {
      const b = jsonBody(req);
      caseSeq += 1;
      const id = rid("case");
      const summary: CaseSummary = {
        id,
        code: `C-${String(caseSeq).padStart(4, "0")}`,
        status: "borrador",
        consent_mode: b.consent_mode === "comunitario" ? "comunitario" : "solo_denuncia",
        created_at: iso(),
        updated_at: iso(),
        evidence_count: 0,
      };
      // Como el API: la zona se normaliza a id de distrito; un texto que no es distrito queda como llegó.
      const zona = typeof b.zona === "string" ? (districtOfZone(b.zona)?.id ?? b.zona) : null;
      cases.set(id, { device, summary, sector: (b.sector as string) ?? null, zona, evidence: [], narrative: null, readyAt: null });
      return response(200, summary);
    }

    if (m === "GET" && path === "/cases") return response(200, { cases: Array.from(cases.values()).filter((c) => c.device === device).map((c) => c.summary) });

    // Avisos y recomendaciones de su distrito, no de su organización. Sin distrito, todos.
    if (m === "GET" && path === "/alerts") {
      const zona = zonaDe(device, params);
      return response(200, { alerts: zona ? ALERTAS.filter((a) => a.distrito === zona) : ALERTAS });
    }

    if (m === "GET" && path === "/recommendations") {
      const zona = zonaDe(device, params);
      return response(200, { recommendations: zona ? RECOMENDACIONES.filter((r) => r.distrito === zona) : RECOMENDACIONES });
    }

    const cm = path.match(/^\/cases\/([^/]+)(\/[a-z.]+)?$/);
    const c = cm ? cases.get(decodeURIComponent(cm[1]!)) : undefined;
    if (cm && !c) return err(404, "not_found", "No encontrado");
    if (c && cm) {
      const sub = cm[2] ?? "";
      if (m === "POST" && sub === "/evidence") {
        const bytes = typeof req.body === "string" ? utf8(req.body) : (req.body ?? new Uint8Array());
        const declared = req.headers["x-content-sha256"];
        const actual = sha256Hex(bytes);
        if (declared !== actual) return err(422, "integrity_mismatch", "La huella no coincide");
        if (bytes.length > 50 * 1024 * 1024) return err(413, "payload_too_large", "Archivo muy grande");
        const tipo = (req.headers["x-evidence-type"] ?? "texto") as EvidenceType;
        const n = c.evidence.length + 1;
        const item: EvidenceItem = {
          id: rid("ev"),
          label: `EV-${c.summary.code.slice(-1)}${n}`,
          tipo,
          mime: req.headers["content-type"] ?? "application/octet-stream",
          size_bytes: bytes.length,
          sha256: actual,
          received_utc: iso(),
          captured_at: req.headers["x-captured-at"] ?? null,
          duration_ms: req.headers["x-duration-ms"] ? Number(req.headers["x-duration-ms"]) : null,
          status: "recibido",
        };
        const audioIdx = c.evidence.filter((e) => e.item.tipo === "audio").length;
        const guion = GUIONES[audioIdx % GUIONES.length]!;
        const dur = item.duration_ms ?? 20_000;
        c.evidence.push({
          item,
          text: tipo === "texto" ? fromUtf8(bytes) : null,
          source: req.headers["x-source"] ?? null,
          processAt: now() + processMs,
          transcript:
            tipo === "audio"
              ? [{ speaker: "Voz 1", start_ms: 0, end_ms: dur, text: guion, es_victima: false }]
              : tipo === "texto"
                ? [{ speaker: null, start_ms: 0, end_ms: 0, text: fromUtf8(bytes), es_victima: false }]
                : null,
          nota: tipo === "imagen" ? "Rostros tapados" : null,
        });
        c.summary.evidence_count = c.evidence.length;
        c.summary.updated_at = iso();
        return response(201, item);
      }
      if (m === "POST" && sub === "/submit") {
        const b = jsonBody(req);
        c.narrative = typeof b.narrative === "string" ? b.narrative : null;
        c.summary.status = "procesando";
        c.readyAt = now() + processMs + 1500;
        c.summary.updated_at = iso();
        return response(202, { case_id: c.summary.id, status: c.summary.status });
      }
      if (m === "GET" && sub === "/report") return response(200, report(c));
      if (m === "GET" && sub === "/report.pdf") {
        const r = report(c);
        const lines = [
          "DENUNCIA - BORRADOR PARA LA COMISARIA",
          "Datos ficticios del demo de Blindaje.",
          "",
          `Caso: ${r.code}   Estado: ${r.status}`,
          `Resumen: ${r.ficha?.resumen ?? "En preparación"}`,
          "",
          "Lo que encontramos:",
          ...r.hallazgos.map((h) => `  - ${h}`),
          "",
          "Evidencia (huella SHA-256):",
          ...r.evidencia.map((e) => `  ${e.label}  ${e.tipo}  ${e.sha256.slice(0, 32)}...`),
          "",
          "Linea 1818 (denuncias). Emergencias: 105.",
        ];
        return response(200, minimalPdf(lines), "application/pdf");
      }
      if (m === "PUT" && sub === "/consent") {
        const b = jsonBody(req);
        c.summary.consent_mode = b.mode === "comunitario" ? "comunitario" : "solo_denuncia";
        c.summary.updated_at = iso();
        return response(200, c.summary);
      }
      if (m === "DELETE" && sub === "") {
        cases.delete(c.summary.id);
        return response(204);
      }
    }
    return err(404, "not_found", "Ruta desconocida");
  }

  const fetcher: Fetcher = async (url, req) => {
    const online = opts.isOnline ? await opts.isOnline() : true;
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    if (!online) throw new TypeError("Network request failed");
    return route(url, req);
  };

  return {
    fetcher,
    /** Para tests: inspección del estado interno. */
    debug: { cases, devices, voiceSamples: () => voiceSamples },
  };
}
