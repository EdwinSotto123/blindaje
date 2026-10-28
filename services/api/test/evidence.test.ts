import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { decryptSealed, sha256Hex } from "../src/lib/crypto";
import { fromUtf8 } from "../src/lib/encoding";
import { setMlClientForTests, type MlClient } from "../src/ml/client";
import { makeWav, parseWav, trimWav, wavDurationMs } from "../src/lib/wav";
import { api, apiJson, createCase, loginAs, markIndexed, registerDevice, seedOrg, upload } from "./helpers";

afterEach(() => setMlClientForTests(null));

describe("subida de evidencia", () => {
  it("cifra en R2, registra custodia y etiqueta EV-…", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token);
    const plain = new TextEncoder().encode("Audio ficticio: habla con el jefe, tienes 48 horas.");
    const res = await upload(d.access_token, c.id, plain, { capturedAt: "2026-10-03T19:40:00-05:00" });
    expect(res.status).toBe(201);
    const item = (await res.json()) as { id: string; label: string; sha256: string; size_bytes: number; status: string };
    expect(item.label).toBe(`EV-${c.code}-1`);
    expect(item.sha256).toBe(await sha256Hex(plain));
    expect(item.size_bytes).toBe(plain.byteLength);
    expect(item.status).toBe("recibido");

    const row = await env.DB.prepare("SELECT * FROM evidence WHERE id = ?").bind(item.id).first<{ r2_key: string; uploader_pseudonym: string }>();
    expect(row!.uploader_pseudonym).toBe(d.pseudonym);
    const obj = await env.EVIDENCE.get(row!.r2_key);
    const stored = await obj!.arrayBuffer();
    expect(stored.byteLength).toBe(12 + plain.byteLength + 16);
    expect(fromUtf8(stored).includes("habla con el jefe")).toBe(false);
    const decrypted = await decryptSealed(env.EVIDENCE_ENCRYPTION_KEY, stored, item.id);
    expect(fromUtf8(decrypted)).toBe(fromUtf8(plain));
    // El AAD ata el objeto a su evidencia: con otro id no descifra.
    await expect(decryptSealed(env.EVIDENCE_ENCRYPTION_KEY, stored, "otro-id")).rejects.toThrow();

    const audit = await env.DB.prepare("SELECT details_json FROM audit_log WHERE action = 'evidence.upload' AND target_id = ?")
      .bind(item.id)
      .first<{ details_json: string }>();
    expect(JSON.parse(audit!.details_json)).toMatchObject({ sha256: item.sha256, label: item.label, uploader: d.pseudonym });

    const second = await upload(d.access_token, c.id, new TextEncoder().encode("segunda pieza"), { tipo: "texto", mime: "text/plain" });
    expect(((await second.json()) as { label: string }).label).toBe(`EV-${c.code}-2`);
  });

  it("responde 422 integrity_mismatch si el SHA-256 no coincide y no guarda nada", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token);
    const res = await upload(d.access_token, c.id, new TextEncoder().encode("contenido"), { sha: "0".repeat(64) });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("integrity_mismatch");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM evidence WHERE case_id = ?").bind(c.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
    const listed = await env.EVIDENCE.list({ prefix: `cases/${c.id}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it("es idempotente por SHA-256 y valida los headers", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token);
    const bytes = new TextEncoder().encode("misma pieza dos veces");
    const a = await upload(d.access_token, c.id, bytes);
    const b = await upload(d.access_token, c.id, bytes);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(((await a.json()) as { id: string }).id).toBe(((await b.json()) as { id: string }).id);

    const noType = await api(`/v1/cases/${c.id}/evidence`, {
      token: d.access_token,
      body: bytes,
      headers: { "x-content-sha256": await sha256Hex(bytes) },
    });
    expect(noType.status).toBe(400);
    const empty = await upload(d.access_token, c.id, new Uint8Array(0));
    expect(empty.status).toBe(400);
  });

  it("rechaza cuerpos por encima del límite con 413", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const res = await api("/v1/me/voice-sample", { token: d.access_token, body: big, headers: { "content-type": "audio/wav" } });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
  });
});

describe("Preparar mi denuncia", () => {
  it("guarda el relato como evidencia texto/relato, corre el Workflow y deja el caso listo", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token);
    const empty = await apiJson("/v1/cases/" + c.id + "/submit", { token: d.access_token, json: {} });
    expect(empty.status).toBe(400);

    await using wf = await introspectWorkflow(env.PROCESAR_CASO);
    const res = await apiJson<{ case_id: string; status: string }>(`/v1/cases/${c.id}/submit`, {
      token: d.access_token,
      json: { narrative: "Me escribieron por WhatsApp pidiendo 2000 soles (ficticio)." },
    });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("procesando");
    const instances = await wf.get();
    expect(instances).toHaveLength(1);
    await instances[0]!.waitForStatus("complete");
    const out = (await instances[0]!.getOutput()) as { pending_steps: string[] };
    expect(out.pending_steps).toContain("ficha");

    const relato = await env.DB.prepare("SELECT tipo, source, mime FROM evidence WHERE case_id = ?").bind(c.id).first<{ tipo: string; source: string }>();
    expect(relato).toMatchObject({ tipo: "texto", source: "relato" });
    const report = await apiJson<{ status: string; ficha: unknown; evidencia: unknown[] }>(`/v1/cases/${c.id}/report`, { token: d.access_token });
    expect(report.body.status).toBe("listo");
    expect(report.body.ficha).toBeNull();
    expect(report.body.evidencia).toHaveLength(1);
  });

  it("report.pdf responde 503 claro sin ML y entrega el PDF con ML", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token);
    const noMl = await apiJson<{ error: { code: string; message: string } }>(`/v1/cases/${c.id}/report.pdf`, { token: d.access_token });
    expect(noMl.status).toBe(503);
    expect(noMl.body.error.code).toBe("upstream_error");

    let template = "";
    setMlClientForTests({
      kind: "http",
      pdfRender: async (t: string) => {
        template = t;
        return new TextEncoder().encode("%PDF-1.7 ficticio").buffer;
      },
    } as unknown as MlClient);
    const res = await api(`/v1/cases/${c.id}/report.pdf`, { token: d.access_token });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(template).toBe("denuncia");
    expect((await res.text()).startsWith("%PDF")).toBe(true);
  });
});

describe("medios para la consola", () => {
  it("recorta WAV PCM16 por rango y audita el acceso", async () => {
    const wav = makeWav(4000);
    const info = parseWav(wav)!;
    expect(wavDurationMs(info)).toBe(4000);
    const cut = trimWav(wav, 1000, 2500)!;
    expect(wavDurationMs(parseWav(cut)!)).toBe(1500);

    const { invite, orgId } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token, "comunitario");
    const up = await upload(d.access_token, c.id, new Uint8Array(wav), { mime: "audio/wav" });
    const ev = (await up.json()) as { id: string };
    const reviewer = await loginAs("reviewer", orgId);
    const res = await api(`/v1/console/evidence/${ev.id}/media?start_ms=500&end_ms=1500`, { token: reviewer.token });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(wavDurationMs(parseWav(await res.arrayBuffer())!)).toBe(1000);
    const full = await api(`/v1/console/evidence/${ev.id}/media`, { token: reviewer.token });
    expect((await full.arrayBuffer()).byteLength).toBe(wav.byteLength);
    const audited = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'evidence.media' AND target_id = ?")
      .bind(ev.id)
      .first<{ n: number }>();
    expect(audited!.n).toBe(2);

    // Un caso "solo mi denuncia" no se ve desde la consola; otra organización tampoco.
    const solo = await createCase(d.access_token, "solo_denuncia");
    const soloEv = (await (await upload(d.access_token, solo.id, new Uint8Array(makeWav(500)), { mime: "audio/wav" })).json()) as { id: string };
    expect((await api(`/v1/console/evidence/${soloEv.id}/media`, { token: reviewer.token })).status).toBe(404);
    const other = await seedOrg();
    const otherReviewer = await loginAs("reviewer", other.orgId);
    expect((await api(`/v1/console/evidence/${ev.id}/media`, { token: otherReviewer.token })).status).toBe(404);
    const analyst = await loginAs("analyst", other.orgId);
    await markIndexed(c.id);
    expect((await api(`/v1/console/evidence/${ev.id}/media`, { token: analyst.token })).status).toBe(200);
  });
});
