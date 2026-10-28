import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { setMlClientForTests } from "../src/ml/client";
import { FakeMl } from "./fakes";
import { api, apiJson, createCase, newDeviceKeys, registerDevice, seedOrg, upload } from "./helpers";

afterEach(() => setMlClientForTests(null));

describe("pedidos de la app móvil", () => {
  it("los mensajes de texto vuelven en el reporte como un solo turno", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token);
    const text = "Yapea al 900 000 202. Habla con el jefe. (ficticio)";
    expect((await upload(d.access_token, c.id, new TextEncoder().encode(text), { tipo: "texto", mime: "text/plain" })).status).toBe(201);
    const report = await apiJson<{ evidencia: Array<{ tipo: string; transcripcion: unknown }> }>(`/v1/cases/${c.id}/report`, { token: d.access_token });
    expect(report.status).toBe(200);
    expect(report.body.evidencia[0]!.transcripcion).toEqual([{ speaker: null, start_ms: 0, end_ms: 0, text, es_victima: false }]);
  });

  it("acepta audio/mp4 (M4A de expo-audio) en la evidencia y en la muestra de voz", async () => {
    setMlClientForTests(new FakeMl());
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token);
    const res = await upload(d.access_token, c.id, new TextEncoder().encode("m4a ficticio"), { mime: "audio/mp4" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { mime: string; tipo: string })).toMatchObject({ mime: "audio/mp4", tipo: "audio" });
    const sample = await api("/v1/me/voice-sample", { token: d.access_token, body: new TextEncoder().encode("VOZ|persona9|"), headers: { "content-type": "audio/mp4" } });
    expect(sample.status).toBe(200);
    const row = await env.DB.prepare("SELECT model FROM victim_voice_samples WHERE device_id = ?").bind(d.device_id).first();
    expect(row).toEqual({ model: "ecapa-falso" });
  });

  it("un caso ya enviado responde 409 a evidencia nueva y sigue siendo idempotente con la misma", async () => {
    const { invite } = await seedOrg();
    const d = await registerDevice(invite);
    const c = await createCase(d.access_token);
    const first = new TextEncoder().encode("Primer mensaje (ficticio)");
    const created = (await (await upload(d.access_token, c.id, first, { tipo: "texto", mime: "text/plain" })).json()) as { id: string };

    await using wf = await introspectWorkflow(env.PROCESAR_CASO);
    expect((await apiJson(`/v1/cases/${c.id}/submit`, { token: d.access_token, json: {} })).status).toBe(202);

    // Mientras se procesa.
    const late = await apiJson<{ error: { code: string; message: string } }>(`/v1/cases/${c.id}/evidence`, {
      token: d.access_token,
      body: new TextEncoder().encode("Llegó tarde (ficticio)"),
      headers: {
        "content-type": "text/plain",
        "x-evidence-type": "texto",
        "x-content-sha256": [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("Llegó tarde (ficticio)")))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      },
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("conflict");
    expect(late.body.error.message).toMatch(/caso nuevo/);
    const retry = await upload(d.access_token, c.id, first, { tipo: "texto", mime: "text/plain" });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { id: string }).id).toBe(created.id);

    // Y cuando ya está listo.
    for (const inst of await wf.get()) await inst.waitForStatus("complete");
    const st = await env.DB.prepare("SELECT estado FROM cases WHERE id = ?").bind(c.id).first<{ estado: string }>();
    expect(st!.estado).toBe("listo");
    expect((await upload(d.access_token, c.id, new TextEncoder().encode("Otra más (ficticio)"), { tipo: "texto", mime: "text/plain" })).status).toBe(409);
    expect((await upload(d.access_token, c.id, first, { tipo: "texto", mime: "text/plain" })).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM evidence WHERE case_id = ?").bind(c.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
    // Un caso en borrador sigue aceptando evidencia.
    const other = await createCase(d.access_token);
    expect((await upload(d.access_token, other.id, new TextEncoder().encode("Otra más (ficticio)"), { tipo: "texto", mime: "text/plain" })).status).toBe(201);
  });
});

describe("registro de dispositivos del demo", () => {
  it("con x-demo-secret válido no consume el cupo por IP; sin él, el límite sigue", async () => {
    const { invite } = await seedOrg({ maxUses: 50 });
    const ip = "10.250.0.7";
    const register = async (headers: Record<string, string> = {}) => {
      const { jwk } = await newDeviceKeys();
      return api("/v1/auth/device/register", { ip, headers, json: { invite_code: invite, public_key: jwk, platform: "android" } });
    };
    for (let i = 0; i < 12; i++) expect((await register({ "x-demo-secret": "demo-secret-de-prueba" })).status, `demo ${i}`).toBe(201);
    // Un secreto inválido no exime.
    expect((await register({ "x-demo-secret": "otro" })).status).toBe(201);
    for (let i = 0; i < 9; i++) expect((await register()).status, `normal ${i}`).toBe(201);
    const limited = await register();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
