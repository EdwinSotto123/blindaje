import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { evidenceLabel, VICTIM_FORBIDDEN_KEYS, type FichaExtraction, type FichaStored } from "@blindaje/shared";
import { setMetaFetchForTests } from "../src/agents/common";
import { identifiersAad } from "../src/cases";
import { readDerivativePlain } from "../src/evidence";
import { openString } from "../src/lib/crypto";
import { fromUtf8 } from "../src/lib/encoding";
import { setMlClientForTests } from "../src/ml/client";
import { buildFicha, processEvidence, storeIdentifiers } from "../src/pipeline/steps";
import type { SegmentacionContent, TranscripcionContent } from "../src/pipeline/types";
import { emptyMetaLog, fakeAudio, fakeImage, FakeMl, fakeMetaFetch, insertEvidence, metaNoSimulada, type FakeMetaConfig } from "./fakes";
import { api, apiJson, createCase, registerDevice, seedOrg, upload } from "./helpers";

const log = emptyMetaLog();
const cfg: FakeMetaConfig = {
  guiones: {
    A1: [
      { speaker: "A", startMs: 0, endMs: 9000, transcript: "Oye, escúchame bien. Somos de Los X. Habla con el jefe y no llames a la policía." },
      { speaker: "B", startMs: 9000, endMs: 12000, transcript: "Mi DNI es 45678912 y mi número es 987 654 321, no tengo esa plata." },
    ],
    E1: [{ speaker: "A", startMs: 0, endMs: 12000, transcript: "Yapea dos mil soles en 48 horas. Habla con el jefe." }],
  },
  fichas: {},
  sam: {
    foto1: {
      "handwritten note": [{ x1: 806, y1: 828, x2: 1161, y2: 1021, c: 0.72 }],
      "bullet casing": [{ x1: 695, y1: 880, x2: 786, y2: 932, c: 0.57 }],
      face: [{ x1: 100, y1: 100, x2: 200, y2: 220, c: 0.9 }],
    },
  },
  lecturas: { foto1: { notas: ["LOS X. 48 HORAS"], placas: ["ABC-123"] } },
  vinculador: "echo",
};

function ficha(over: Partial<FichaExtraction>): FichaExtraction {
  return {
    sector: "bodega",
    primer_contacto: null,
    tipo_amenaza: "dano_local",
    amenaza: "Daño al local",
    monto_soles: 2000,
    periodicidad: "unico",
    plazo: "48 horas",
    plazo_horas: 48,
    canal_pago: "yape",
    identificadores: [],
    grupo_que_dice_ser: "Los X",
    frases_firma: ["habla con el jefe", "no llames a la policía"],
    escalamiento: [],
    resumen_mo: "Audios de voz masculina que dicen ser de Los X y exigen pago por Yape en 48 horas.",
    fuentes: [],
    ...over,
  };
}

let ml: FakeMl;
let org: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ml = new FakeMl();
  setMlClientForTests(ml);
  setMetaFetchForTests(fakeMetaFetch(cfg, log));
  org = await seedOrg({ maxUses: 50 });
});

afterAll(() => {
  setMlClientForTests(null);
  setMetaFetchForTests(metaNoSimulada);
});

async function derivative(evidenceId: string, tipo: string) {
  return env.DB.prepare("SELECT id, r2_key, content_json FROM derivatives WHERE evidence_id = ? AND tipo = ?")
    .bind(evidenceId, tipo)
    .first<{ id: string; r2_key: string | null; content_json: string | null }>();
}

describe("pipeline por evidencia", () => {
  let audioCase: { id: string; code: string };
  let audioEv: { id: string; label: string };

  it("audio: WAV cifrado, transcripción con la víctima marcada y huella solo del extorsionador", async () => {
    const d = await registerDevice(org.invite);
    // Muestra de voz de la víctima en M4A (lo que graba expo-audio).
    const sample = await api("/v1/me/voice-sample", { token: d.access_token, body: new TextEncoder().encode("VOZ|persona3|"), headers: { "content-type": "audio/mp4" } });
    expect(sample.status).toBe(200);

    // Otro caso indexado con un grupo propio: su nombre entra al vocabulario de Transcribe.
    const other = await registerDevice(org.invite);
    const otherCase = await createCase(other.access_token, "comunitario");
    await env.DB.prepare("UPDATE cases SET indexed = 1, ficha_json = ? WHERE id = ?")
      .bind(JSON.stringify({ grupo_que_dice_ser: "Los Pulpos de Prueba" }), otherCase.id)
      .run();

    audioCase = await createCase(d.access_token, "comunitario");
    audioEv = await insertEvidence(audioCase, 1, "audio", fakeAudio("A1", { A: "persona1", B: "persona3" }), { mime: "audio/ogg" });
    expect(await processEvidence(env, audioEv.id)).toEqual({ status: "processed" });

    const ev = await env.DB.prepare("SELECT status, duration_ms FROM evidence WHERE id = ?").bind(audioEv.id).first<{ status: string; duration_ms: number }>();
    expect(ev).toEqual({ status: "procesado", duration_ms: 12000 });
    const wav = await derivative(audioEv.id, "wav");
    expect(fromUtf8((await readDerivativePlain(env, wav!))!.slice(0, 4))).toBe("RIFF");
    expect(JSON.parse(wav!.content_json!)).toMatchObject({ sample_rate: 16000, channels: 1, duration_ms: 12000 });

    const tr = JSON.parse((await derivative(audioEv.id, "transcripcion"))!.content_json!) as TranscripcionContent;
    expect(tr.turns.map((t) => [t.speaker, t.es_victima])).toEqual([
      ["A", false],
      ["B", true],
    ]);
    expect(tr.nota).toMatch(/separamos tu voz/i);

    const prints = await env.DB.prepare("SELECT num, speaker, segmentos FROM voice_prints WHERE case_id = ?").bind(audioCase.id).all<{ num: number; speaker: string; segmentos: number }>();
    expect(prints.results).toHaveLength(1);
    expect(prints.results[0]).toMatchObject({ speaker: "A", segmentos: 3 });
    expect(tr.huellas).toEqual({ A: `V-${prints.results[0]!.num}` });
    const emb = await env.DB.prepare("SELECT index_name, COUNT(*) AS n FROM embeddings WHERE case_id = ? GROUP BY index_name ORDER BY index_name")
      .bind(audioCase.id)
      .all<{ index_name: string; n: number }>();
    // Centroide + 3 segmentos del extorsionador; el segmento de la víctima nunca se guarda.
    expect(emb.results).toEqual([
      { index_name: "voz", n: 1 },
      { index_name: "voz_segmento", n: 3 },
    ]);

    // Transcribe con hablantes, sesgo por idioma y vocabulario base + grupos de otros casos.
    const t = log.transcribe.at(-1)!;
    expect(t.guion).toBe("A1");
    expect(t.keywords).toEqual(expect.arrayContaining(["Yape", "cupo", "derecho de piso", "Los Pulpos de Prueba"]));
    const cost = await env.DB.prepare("SELECT status, case_id, audio_seconds FROM api_costs WHERE operation = 'transcribe' AND status = 'ok'").first();
    expect(cost).toMatchObject({ status: "ok", case_id: audioCase.id, audio_seconds: 12 });
  });

  it("reprocesar no vuelve a pagar (caché por SHA-256) ni duplica filas", async () => {
    const before = log.transcribe.length;
    const beforeAuth = log.autenticidad.length;
    await env.DB.prepare("UPDATE evidence SET status = 'error' WHERE id = ?").bind(audioEv.id).run();
    expect(await processEvidence(env, audioEv.id)).toEqual({ status: "processed" });
    expect(log.transcribe.length).toBe(before);
    expect(log.autenticidad.length).toBe(beforeAuth);
    const cached = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_costs WHERE operation = 'transcribe' AND status = 'cached'").first<{ n: number }>();
    expect(cached!.n).toBe(1);
    const authCached = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_costs WHERE operation = 'autenticidad' AND status = 'cached'").first<{ n: number }>();
    expect(authCached!.n).toBe(1);
    const n = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM voice_prints WHERE case_id = ?1) AS prints, (SELECT COUNT(*) FROM embeddings WHERE case_id = ?1) AS emb, (SELECT COUNT(*) FROM derivatives WHERE evidence_id = ?2) AS ders",
    )
      .bind(audioCase.id, audioEv.id)
      .first<{ prints: number; emb: number; ders: number }>();
    // wav, transcripción, prompt_guard y autenticidad (una sola de cada una).
    expect(n).toEqual({ prints: 1, emb: 4, ders: 4 });
  });

  it("imagen: SAM con conceptos en inglés etiquetados en español, rostros tapados, recortes y lectura de placa", async () => {
    const d = await registerDevice(org.invite);
    const c = await createCase(d.access_token, "comunitario");
    const ev = await insertEvidence(c, 1, "imagen", fakeImage("foto1"), { mime: "image/jpeg" });
    log.sam.length = 0;
    expect(await processEvidence(env, ev.id)).toEqual({ status: "processed" });

    // Un concepto por petición, en inglés (SAM 3.1 no encontró nada con los conceptos en español).
    expect([...log.sam].sort()).toEqual(["bullet", "bullet casing", "child", "face", "firearm", "handwritten note", "license plate", "storefront"]);
    const seg = JSON.parse((await derivative(ev.id, "segmentacion"))!.content_json!) as SegmentacionContent;
    expect(seg.lang).toBe("en");
    expect(seg.objetos.map((o) => o.concepto).sort()).toEqual(["bala", "nota escrita a mano", "rostro"]);
    expect(seg.nota).toBe("Encontramos: bala, nota escrita a mano");

    const red = await derivative(ev.id, "redactada");
    expect(JSON.parse(red!.content_json!)).toMatchObject({ regiones: 1 });
    expect(fromUtf8((await readDerivativePlain(env, red!))!)).toContain("|tapada");

    const crops = await env.DB.prepare("SELECT concept, phash FROM image_crops WHERE evidence_id = ? ORDER BY num").bind(ev.id).all<{ concept: string; phash: string }>();
    expect(crops.results.map((r) => r.concept)).toEqual(["imagen completa", "bala", "nota escrita a mano"]);
    for (const r of crops.results) expect(r.phash).toMatch(/^[0-9a-f]{16}$/);
    const imgEmb = await env.DB.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE case_id = ? AND index_name = 'imagen'").bind(c.id).first<{ n: number }>();
    expect(imgEmb!.n).toBe(3);

    const lectura = JSON.parse((await derivative(ev.id, "lectura"))!.content_json!);
    expect(lectura).toMatchObject({ texto: "LOS X. 48 HORAS", placas: ["ABC-123"] });

    // La placa leída pasa a la ficha y a los identificadores aunque el modelo no la liste.
    cfg.fichas[c.code] = ficha({ fuentes: [ev.label] });
    const f = await buildFicha(env, c.id);
    expect(log.ficha.at(-1)).toContain(`[${ev.label}] Lectura de imagen`);
    expect(log.ficha.at(-1)).toContain("Placa de vehículo: ABC-123.");
    expect(f!.identificadores).toEqual([expect.objectContaining({ tipo: "placa", rol: "vehiculo", ultimos_3: "123", evidencia: [ev.label] })]);
    await env.DB.prepare("UPDATE cases SET ficha_json = ? WHERE id = ?").bind(JSON.stringify(f), c.id).run();
    expect(await storeIdentifiers(env, c.id)).toEqual({ count: 1, stub: false });
    const ci = await env.DB.prepare("SELECT rol, indexed FROM case_identifiers WHERE case_id = ?").bind(c.id).first();
    expect(ci).toEqual({ rol: "vehiculo", indexed: 1 });
  });

  it("texto: mensajes y relato quedan como derivado de texto plano cifrado", async () => {
    const d = await registerDevice(org.invite);
    const c = await createCase(d.access_token);
    const msg = await insertEvidence(c, 1, "texto", new TextEncoder().encode("Yapea al 900 000 202.\r\nHabla con el jefe.  \r\n"), { source: "pegado", mime: "text/plain" });
    expect(await processEvidence(env, msg.id)).toEqual({ status: "processed" });
    const der = await derivative(msg.id, "texto");
    expect(JSON.parse(der!.content_json!)).toEqual({ source: "pegado", chars: 40 });
    const stored = await env.EVIDENCE.get(der!.r2_key!);
    expect(fromUtf8(await stored!.arrayBuffer()).includes("Habla con el jefe")).toBe(false);
    expect(fromUtf8((await readDerivativePlain(env, der!))!)).toBe("Yapea al 900 000 202.\nHabla con el jefe.");
  });
});

describe("ficha", () => {
  it("nunca guarda datos de la víctima", async () => {
    const d = await registerDevice(org.invite);
    await api("/v1/me/voice-sample", { token: d.access_token, body: new TextEncoder().encode("VOZ|persona3|"), headers: { "content-type": "audio/ogg" } });
    const c = await createCase(d.access_token, "comunitario");
    const audio = await insertEvidence(c, 1, "audio", fakeAudio("A1", { A: "persona1", B: "persona3" }));
    const relato = await insertEvidence(c, 2, "texto", new TextEncoder().encode("Me llegaron audios desde el +51 900 000 111 pidiendo plata por Yape."), { source: "relato" });
    await processEvidence(env, audio.id);
    await processEvidence(env, relato.id);

    // Lo que "devuelve" el modelo trae datos de la víctima: la ficha guardada no puede tenerlos.
    cfg.fichas[c.code] = ficha({
      identificadores: [
        { tipo: "cuenta_yape", valor: "900 000 101", rol: "cobro", evidencia: [audio.label] },
        { tipo: "telefono", valor: "+51 900 000 111", rol: "contacto", evidencia: [relato.label] },
        { tipo: "telefono", valor: "45678912", rol: "contacto", evidencia: [audio.label] },
        { tipo: "telefono", valor: "987 654 321", rol: "contacto", evidencia: [audio.label, "EV-NO-EXISTE"] },
      ],
      resumen_mo: "Voz masculina de Los X; la víctima (DNI 45678912, celular 987654321, rosa@correo.pe) recibe audios.",
      fuentes: [audio.label, relato.label, "EV-INVENTADA-9"],
    });
    const f = await buildFicha(env, c.id);

    // 1. Los turnos de la víctima nunca llegan al modelo.
    const input = log.ficha.at(-1)!;
    expect(input).toContain(`[${audio.label}] Transcripción de audio`);
    expect(input).toContain("Habla con el jefe");
    expect(input).not.toContain("45678912");
    expect(input).not.toContain("987 654 321");
    expect(input).not.toContain("no tengo esa plata");

    // 2. Solo quedan los identificadores de quien extorsiona (el DNI y el número que dijo la víctima se descartan).
    expect(f!.identificadores.map((i) => [i.tipo, i.ultimos_3])).toEqual([
      ["cuenta_yape", "101"],
      ["telefono", "111"],
    ]);
    expect(f!.resumen_mo).toBe("Voz masculina de Los X; la víctima (DNI [número], celular [número], [correo]) recibe audios.");
    expect(f!.fuentes).toEqual([audio.label, relato.label]);
    const json = JSON.stringify(f);
    for (const dato of ["45678912", "987654321", "987 654 321", "rosa@correo.pe", "valor"]) expect(json.includes(dato), dato).toBe(false);

    // 3. Los valores en claro solo existen cifrados, para la denuncia de la propia víctima.
    const row = await env.DB.prepare("SELECT identifiers_enc FROM cases WHERE id = ?").bind(c.id).first<{ identifiers_enc: string }>();
    const plain = JSON.parse(await openString(env.EVIDENCE_ENCRYPTION_KEY, row!.identifiers_enc, identifiersAad(c.id)));
    expect(plain.identificadores.map((i: { normalizado: string }) => i.normalizado)).toEqual(["+51900000101", "+51900000111"]);

    // 4. Ejecución registrada en agent_runs (las citas inventadas la marcan inválida, pero se limpian).
    const run = await env.DB.prepare("SELECT agent, status, attempts FROM agent_runs WHERE agent = 'ficha' AND target_id = ?").bind(c.id).first();
    expect(run).toEqual({ agent: "ficha", status: "invalido", attempts: 2 });
    // 5. Vector del resumen_mo en el índice de texto.
    const txt = await env.DB.prepare("SELECT ref_type, dim FROM embeddings WHERE case_id = ? AND index_name = 'texto'").bind(c.id).first();
    expect(txt).toEqual({ ref_type: "ficha", dim: 384 });
  });
});

describe("Workflow completo y reporte de la víctima", () => {
  it("submit: procesa, arma la ficha, indexa, encola la vinculación y el reporte trae todo lo propio", async () => {
    const d = await registerDevice(org.invite);
    const c = await createCase(d.access_token, "comunitario");
    cfg.fichas[c.code] = ficha({
      identificadores: [{ tipo: "cuenta_yape", valor: "900000101", rol: "cobro", evidencia: [evidenceLabel(c.code, 2)] }],
      fuentes: [evidenceLabel(c.code, 1), evidenceLabel(c.code, 2)],
      primer_contacto: "2026-10-15T19:40:00-05:00",
    });
    expect((await upload(d.access_token, c.id, fakeAudio("E1", { A: "persona1" }), { mime: "audio/mp4", capturedAt: "2026-10-15T19:40:00-05:00" })).status).toBe(201);
    const msg = new TextEncoder().encode("Si no yapeas S/ 2,000 en 48 horas al 900 000 101 ya sabes. Los X.");
    expect((await upload(d.access_token, c.id, msg, { tipo: "texto", mime: "text/plain" })).status).toBe(201);

    await using wf = await introspectWorkflow(env.PROCESAR_CASO);
    const res = await apiJson(`/v1/cases/${c.id}/submit`, { token: d.access_token, json: { narrative: "Tengo una bodega y me mandaron audios (ficticio)." } });
    expect(res.status).toBe(202);
    const [inst] = await wf.get();
    await inst!.waitForStatus("complete");
    expect(await inst!.getOutput()).toEqual({ case_id: c.id, ficha: true, indexed: true, queued_linking: true, pending_steps: [] });

    const report = await apiJson<Record<string, unknown> & { ficha: Record<string, unknown>; hallazgos: string[]; evidencia: Array<{ tipo: string; transcripcion: unknown[] | null }>; cronologia: unknown[] }>(
      `/v1/cases/${c.id}/report`,
      { token: d.access_token },
    );
    expect(report.status).toBe(200);
    expect(report.body.status).toBe("listo");
    expect(report.body.ficha).toMatchObject({ canal_pago: "yape", monto_soles: 2000, identificadores: [{ tipo: "cuenta_yape", valor: "900000101" }] });
    expect(report.body.hallazgos).toEqual(expect.arrayContaining(["Pide pago por Yape", "Transcribimos 1 audio"]));
    expect(report.body.cronologia.length).toBeGreaterThan(0);
    const [audio, texto, relato] = report.body.evidencia;
    expect(audio!.transcripcion).toHaveLength(1);
    expect(texto!.transcripcion).toEqual([{ speaker: null, start_ms: 0, end_ms: 0, text: "Si no yapeas S/ 2,000 en 48 horas al 900 000 101 ya sabes. Los X.", es_victima: false }]);
    expect(relato!.transcripcion).toEqual([expect.objectContaining({ text: "Tengo una bodega y me mandaron audios (ficticio)." })]);
    const text = JSON.stringify(report.body);
    for (const k of VICTIM_FORBIDDEN_KEYS) expect(text.includes(`"${k}"`), k).toBe(false);

    const pdf = await api(`/v1/cases/${c.id}/report.pdf`, { token: d.access_token });
    expect(pdf.status).toBe(200);
    expect(ml.pdfData).toMatchObject({
      caso: c.code,
      narrativa: "Tengo una bodega y me mandaron audios (ficticio).",
      transcripciones: [expect.objectContaining({ titulo: "Audio" }), expect.objectContaining({ titulo: "Mensaje" })],
    });
    expect(JSON.stringify(ml.pdfData).includes("VIN-")).toBe(false);

    const stored = await env.DB.prepare("SELECT ficha_json, indexed FROM cases WHERE id = ?").bind(c.id).first<{ ficha_json: string; indexed: number }>();
    expect(stored!.indexed).toBe(1);
    expect((JSON.parse(stored!.ficha_json) as FichaStored).caso).toBe(c.code);
  });
});
