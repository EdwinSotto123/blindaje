import { Hono } from "hono";
import { z } from "zod";
import {
  BusinessRecommendationView,
  CaseSummary,
  districtOfZone,
  ConsentRequest,
  CreateCaseRequest,
  EvidenceItem,
  EvidenceUploadHeaders,
  LINEA_DENUNCIAS,
  LINEA_EMERGENCIAS,
  Sector,
  SubmitCaseRequest,
  SubmitCaseResponse,
  VictimAlert,
  VictimReport,
  type FichaStored,
} from "@blindaje/shared";
import { audit } from "../audit";
import { approvedRecommendations } from "../business/recommendations";
import { approvedAlerts, zoneKey } from "../business/risk";
import {
  buildVictimReport,
  caseSummary,
  CONSENT_TEXT_VERSION,
  deleteCaseFully,
  getOwnedCase,
  setConsent,
  toCaseSummary,
  type CaseRow,
} from "../cases";
import { MAX_EVIDENCE_BYTES, storeEvidence, toEvidenceItem, type EvidenceRow } from "../evidence";
import { readBodyLimited } from "../lib/body";
import { sealString, sha256Hex } from "../lib/crypto";
import { isUniqueViolation, parseJsonColumn } from "../lib/db";
import { utf8 } from "../lib/encoding";
import { ApiError } from "../lib/errors";
import { parseQuery, readJson, victimJson, zodDetails } from "../lib/http";
import { caseCode, newId, nowIso } from "../lib/ids";
import { getMlClient } from "../ml/client";
import { denunciaPdfData, enrichVictimReport } from "../pipeline/report";
import { getAuth, requireAuth, requireRole } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { actorOf, type AppEnv } from "../types";

/**
 * Rutas de la víctima. Todas las respuestas JSON pasan por `victimJson` (esquema del contrato +
 * verificación de VICTIM_FORBIDDEN_KEYS). Un caso ajeno siempre responde 404.
 */
export const victimRoutes = new Hono<AppEnv>();

// Middleware por ruta (no "*"): este sub-app se monta en /v1 junto a otros.
for (const path of ["/me/*", "/cases", "/cases/*", "/alerts", "/recommendations"]) {
  victimRoutes.use(path, requireAuth, requireRole("victim"), rateLimit("victim"));
}

const MAX_VOICE_SAMPLE_BYTES = 5 * 1024 * 1024;

victimRoutes.post("/me/voice-sample", rateLimit("upload"), async (c) => {
  const auth = getAuth(c);
  const bytes = await readBodyLimited(c, MAX_VOICE_SAMPLE_BYTES);
  if (!bytes.byteLength) throw new ApiError("bad_request", "Falta el audio");
  const ml = getMlClient(c.env);
  const enrolled = await ml.voiceEnroll(bytes);
  const vectorEnc = await sealString(c.env.EVIDENCE_ENCRYPTION_KEY, JSON.stringify(enrolled.vector), `voice:${auth.sub}`);
  await c.env.DB.prepare(
    `INSERT INTO victim_voice_samples (device_id, vector_enc, model, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET vector_enc = excluded.vector_enc, model = excluded.model, created_at = excluded.created_at`,
  )
    .bind(auth.sub, vectorEnc, enrolled.model, nowIso())
    .run();
  await audit(c.env, { ...actorOf(auth), action: "voice_sample.enroll", target_type: "device", target_id: auth.sub, details: { model: enrolled.model } });
  return victimJson(c, z.object({ ok: z.literal(true) }), { ok: true });
});

victimRoutes.post("/cases", async (c) => {
  const auth = getAuth(c);
  const body = await readJson(c, CreateCaseRequest);
  const device = await c.env.DB.prepare("SELECT is_demo FROM devices WHERE id = ?").bind(auth.sub).first<{ is_demo: number }>();
  if (!device) throw new ApiError("unauthorized", "Dispositivo no registrado");

  // En el demo, el script de los casos A, B y C pide el código con este header.
  const demoCode = c.req.header("x-demo-case-code")?.trim().toUpperCase();
  const useDemoCode = Boolean(demoCode) && c.env.DEMO_MODE === "true" && device.is_demo === 1;
  if (useDemoCode && !/^[A-Z]$/.test(demoCode!)) throw new ApiError("bad_request", "Código de demo inválido");

  // La zona es un distrito (id de DISTRICTS); las apps antiguas mandan texto libre: si se reconoce
  // un distrito ("San Juan de Lurigancho - E12", "Rímac"), se guarda su id; si no, el texto tal cual
  // (no cuenta en el mapa).
  const zonaTexto = body.zona?.trim() || null;
  const zona = districtOfZone(zonaTexto)?.id ?? zonaTexto;
  const id = newId();
  const now = nowIso();
  let row: CaseRow | null = null;
  for (let attempt = 0; attempt < 6 && !row; attempt++) {
    const code = useDemoCode ? demoCode! : caseCode();
    try {
      const [inserted] = await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO cases (id, code, org_id, device_id, seudonimo_victima, sector, zona_cuadricula, consent_mode, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        ).bind(id, code, auth.org, auth.sub, auth.pse ?? "", body.sector ?? null, zona, body.consent_mode, device.is_demo, now, now),
        c.env.DB.prepare("INSERT INTO consents (id, case_id, device_id, mode, text_version, granted_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
          newId(),
          id,
          auth.sub,
          body.consent_mode,
          CONSENT_TEXT_VERSION,
          now,
        ),
      ]);
      row = (inserted!.results[0] as CaseRow | undefined) ?? null;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (useDemoCode) throw new ApiError("conflict", `El código de demo ${demoCode} ya está en uso`);
    }
  }
  if (!row) throw new ApiError("conflict", "No se pudo crear el caso, intenta de nuevo");
  await audit(c.env, {
    ...actorOf(auth),
    action: "case.create",
    target_type: "case",
    target_id: id,
    details: { code: row.code, consent_mode: row.consent_mode },
  });
  return victimJson(c, CaseSummary, toCaseSummary(row, 0), 201);
});

victimRoutes.get("/cases", async (c) => {
  const auth = getAuth(c);
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id) AS evidence_count
     FROM cases c WHERE c.device_id = ? ORDER BY c.created_at DESC`,
  )
    .bind(auth.sub)
    .all<CaseRow & { evidence_count: number }>();
  return victimJson(c, z.object({ cases: z.array(CaseSummary) }), { cases: results.map((r) => toCaseSummary(r, r.evidence_count)) });
});

victimRoutes.post("/cases/:id/evidence", rateLimit("upload"), async (c) => {
  const auth = getAuth(c);
  const cs = await getOwnedCase(c.env, c.req.param("id"), auth.sub);
  const headers = EvidenceUploadHeaders.safeParse({
    "x-evidence-type": c.req.header("x-evidence-type"),
    "x-content-sha256": c.req.header("x-content-sha256")?.toLowerCase(),
    "x-captured-at": c.req.header("x-captured-at") || undefined,
    "x-source": c.req.header("x-source") || undefined,
    "x-duration-ms": c.req.header("x-duration-ms") || undefined,
  });
  if (!headers.success) throw new ApiError("bad_request", "Faltan o son inválidos los headers de la evidencia", { details: zodDetails(headers.error) });
  const h = headers.data;
  const capturedAt = h["x-captured-at"];
  if (capturedAt && Number.isNaN(Date.parse(capturedAt))) throw new ApiError("bad_request", "x-captured-at debe ser ISO 8601");
  const mime = (c.req.header("content-type") ?? "application/octet-stream").split(";")[0]!.trim().toLowerCase().slice(0, 100);
  const bytes = await readBodyLimited(c, MAX_EVIDENCE_BYTES);
  if (cs.estado === "procesando" || cs.estado === "listo") {
    // Caso ya enviado: un reintento de la misma subida sigue siendo idempotente (200); evidencia
    // nueva va a un caso nuevo (la app abre uno y reintenta).
    const sha = await sha256Hex(bytes);
    const dup = await c.env.DB.prepare("SELECT * FROM evidence WHERE case_id = ? AND sha256 = ?").bind(cs.id, sha).first<EvidenceRow>();
    if (dup && sha === h["x-content-sha256"]) return victimJson(c, EvidenceItem, toEvidenceItem(dup), 200);
    throw new ApiError("conflict", "Este caso ya fue enviado y no admite más evidencia. Abre un caso nuevo para agregarla.", {
      details: { case_status: cs.estado },
    });
  }
  const { item, created } = await storeEvidence(c.env, {
    caseId: cs.id,
    caseCode: cs.code,
    uploaderPseudonym: auth.pse ?? cs.seudonimo_victima,
    actor: actorOf(auth),
    bytes,
    tipo: h["x-evidence-type"],
    mime,
    sha256Client: h["x-content-sha256"],
    capturedAt: capturedAt ?? null,
    source: h["x-source"] ?? null,
    durationMs: h["x-duration-ms"] ?? null,
  });
  return victimJson(c, EvidenceItem, item, created ? 201 : 200);
});

victimRoutes.post("/cases/:id/submit", rateLimit("submit"), async (c) => {
  const auth = getAuth(c);
  const cs = await getOwnedCase(c.env, c.req.param("id"), auth.sub);
  const body = await readJson(c, SubmitCaseRequest);
  if (cs.estado === "procesando") {
    return victimJson(c, SubmitCaseResponse, { case_id: cs.id, status: "procesando" }, 202);
  }
  const narrative = body.narrative?.trim();
  if (narrative) {
    const bytes = utf8(narrative);
    await storeEvidence(c.env, {
      caseId: cs.id,
      caseCode: cs.code,
      uploaderPseudonym: auth.pse ?? cs.seudonimo_victima,
      actor: actorOf(auth),
      bytes: bytes.buffer,
      tipo: "texto",
      mime: "text/plain",
      sha256Client: await sha256Hex(bytes),
      capturedAt: nowIso(),
      source: "relato",
    });
  }
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM evidence WHERE case_id = ?").bind(cs.id).first<{ n: number }>();
  if (!n?.n) throw new ApiError("bad_request", "Agrega al menos una evidencia o cuéntanos qué pasó");

  const instanceId = `${cs.id}-${Date.now()}`;
  await c.env.PROCESAR_CASO.create({ id: instanceId, params: { case_id: cs.id, requested_by: auth.pse ?? cs.seudonimo_victima } });
  const now = nowIso();
  await c.env.DB.prepare(
    "UPDATE cases SET estado = 'procesando', workflow_id = ?, submitted_at = ?, updated_at = ?, error = NULL WHERE id = ?",
  )
    .bind(instanceId, now, now, cs.id)
    .run();
  await audit(c.env, {
    ...actorOf(auth),
    action: "case.submit",
    target_type: "case",
    target_id: cs.id,
    details: { workflow_instance: instanceId, evidence: n.n, narrative: Boolean(narrative) },
  });
  return victimJson(c, SubmitCaseResponse, { case_id: cs.id, status: "procesando" }, 202);
});

/** Reporte propio: ficha, cronología, hallazgos (también en vivo) y transcripciones de SU caso. */
async function victimReport(env: AppEnv["Bindings"], cs: CaseRow): Promise<VictimReport> {
  return enrichVictimReport(env, await buildVictimReport(env, cs));
}

victimRoutes.get("/cases/:id/report", async (c) => {
  const auth = getAuth(c);
  const cs = await getOwnedCase(c.env, c.req.param("id"), auth.sub);
  return victimJson(c, VictimReport, await victimReport(c.env, cs));
});

victimRoutes.get("/cases/:id/report.pdf", async (c) => {
  const auth = getAuth(c);
  const cs = await getOwnedCase(c.env, c.req.param("id"), auth.sub);
  const report = VictimReport.parse(await victimReport(c.env, cs));
  const ml = getMlClient(c.env);
  const pdf = await ml.pdfRender("denuncia", {
    ...(await denunciaPdfData(c.env, report, { seudonimo: cs.seudonimo_victima, demo: cs.is_demo === 1 })),
    lineas: { denuncias: LINEA_DENUNCIAS, emergencias: LINEA_EMERGENCIAS },
  });
  await audit(c.env, {
    ...actorOf(auth),
    action: "case.report_pdf",
    target_type: "case",
    target_id: cs.id,
    details: { sha256: await sha256Hex(pdf), size_bytes: pdf.byteLength },
  });
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="denuncia-${cs.code}.pdf"`,
      "cache-control": "no-store",
    },
  });
});

victimRoutes.put("/cases/:id/consent", async (c) => {
  const auth = getAuth(c);
  const cs = await getOwnedCase(c.env, c.req.param("id"), auth.sub);
  const body = await readJson(c, ConsentRequest);
  const updated = await setConsent(c.env, cs, body.mode, actorOf(auth));
  return victimJson(c, CaseSummary, await caseSummary(c.env, updated));
});

victimRoutes.delete("/cases/:id", async (c) => {
  const auth = getAuth(c);
  const cs = await getOwnedCase(c.env, c.req.param("id"), auth.sub);
  await deleteCaseFully(c.env, cs, actorOf(auth));
  return c.body(null, 204);
});

const ZonaQuery = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .transform((v, ctx) => {
    const d = districtOfZone(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "No es un distrito de Lima Metropolitana o del Callao" });
      return z.NEVER;
    }
    return d.id;
  });

/**
 * Zona de los avisos de la víctima: el distrito que manda la app (`?zona=`, el que eligió en el
 * celular) o, si no lo manda, el de SU caso más reciente con distrito (o la zona tal cual de un caso
 * antiguo, como clave de zoneKey). Sin ninguno, null: no hay avisos de zona. Nada de otros casos.
 */
async function victimZone(env: AppEnv["Bindings"], deviceId: string, zona: string | undefined): Promise<{ zona: string | null; isDemo: boolean }> {
  const [device, cases] = await env.DB.batch([
    env.DB.prepare("SELECT is_demo FROM devices WHERE id = ?").bind(deviceId),
    env.DB.prepare("SELECT zona_cuadricula, ficha_json FROM cases WHERE device_id = ? ORDER BY created_at DESC").bind(deviceId),
  ]);
  const isDemo = (device!.results[0] as { is_demo: number } | undefined)?.is_demo === 1;
  if (zona) return { zona, isDemo };
  for (const r of cases!.results as Array<{ zona_cuadricula: string | null; ficha_json: string | null }>) {
    const k = zoneKey(r.zona_cuadricula ?? parseJsonColumn<FichaStored>(r.ficha_json)?.zona ?? null);
    if (k) return { zona: k, isDemo };
  }
  return { zona: null, isDemo };
}

/**
 * Avisos de su zona: alertas aprobadas por el equipo central para su distrito (no por su
 * organización). Sin citas internas ni números.
 */
victimRoutes.get("/alerts", async (c) => {
  const auth = getAuth(c);
  const q = parseQuery(c, z.object({ zona: ZonaQuery.optional() }));
  const { zona, isDemo } = await victimZone(c.env, auth.sub, q.zona);
  const alerts = zona
    ? (await approvedAlerts(c.env, { isDemo }))
        .filter((a) => a.key === zona)
        .slice(0, 50)
        .map((a) => ({ id: a.id, titulo: a.titulo, cuerpo: a.cuerpo, zona: a.zona, distrito: a.distrito, que_hacer: a.que_hacer, approved_at: a.approved_at }))
    : [];
  return victimJson(c, z.object({ alerts: z.array(VictimAlert) }), { alerts });
});

/**
 * Recomendaciones de prevención del Asesor que el equipo central aprobó para su distrito (con
 * `sector`, las de su rubro y las de todos los rubros). Agregadas y sin citas internas ni números:
 * nunca dicen nada de otros casos concretos.
 */
victimRoutes.get("/recommendations", async (c) => {
  const auth = getAuth(c);
  const q = parseQuery(c, z.object({ zona: ZonaQuery.optional(), sector: Sector.optional() }));
  const { zona, isDemo } = await victimZone(c.env, auth.sub, q.zona);
  const recommendations = zona ? await approvedRecommendations(c.env, { isDemo, zonas: [zona], sector: q.sector ?? null }) : [];
  return victimJson(c, z.object({ recommendations: z.array(BusinessRecommendationView) }), { recommendations });
});
