import { BlindajeApi, type AuthState } from "@/api/client";
import { ApiError, NetworkError } from "@/api/http";
import { createMockServer, extraerDatos, minimalPdf } from "@/api/mock";
import { fromUtf8, utf8 } from "@/lib/bytes";
import { sha256Hex } from "@/security/hash";
import { CaseSummary, VICTIM_FORBIDDEN_KEYS, VictimAlert, VictimReport } from "@/shared";

function client(opts: Parameters<typeof createMockServer>[0] = {}) {
  const server = createMockServer({ processMs: 0, ...opts });
  let auth: AuthState | null = null;
  const api = new BlindajeApi({
    baseUrl: "https://mock.local",
    fetcher: server.fetcher,
    auth: { get: async () => auth, set: async (a) => void (auth = a), clear: async () => void (auth = null) },
    sign: async () => "firma",
  });
  return { api, server, getAuth: () => auth, setAuth: (a: AuthState) => (auth = a) };
}

function keysDeep(o: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(o)) o.forEach((x) => keysDeep(x, out));
  else if (o && typeof o === "object")
    for (const [k, v] of Object.entries(o)) {
      out.add(k);
      keysDeep(v, out);
    }
  return out;
}

describe("Servidor simulado (respeta el contrato)", () => {
  it("flujo completo con respuestas válidas según los esquemas compartidos", async () => {
    const { api } = client();
    const auth = await api.registerDevice("BODEGA-2026", { kty: "EC", crv: "P-256", x: "x", y: "y" }, "android");
    expect(auth.pseudonym).toMatch(/^V-/);
    const c = CaseSummary.parse(await api.createCase({ consent_mode: "solo_denuncia" }));
    expect(c.consent_mode).toBe("solo_denuncia");

    const texto = utf8("Si no yapeas S/ 2,000 en 48 horas al 987 654 321, somos de Los X. (ficticio)");
    await api.uploadEvidence(c.id, texto, { tipo: "texto", mime: "text/plain", sha256: sha256Hex(texto), source: "pegado" });
    const audio = utf8("audio ficticio");
    await api.uploadEvidence(c.id, audio, { tipo: "audio", mime: "audio/mp4", sha256: sha256Hex(audio), source: "grabacion", durationMs: 42000 });

    let r = VictimReport.parse(await api.getReport(c.id));
    expect(r.hallazgos).toEqual(expect.arrayContaining(["Pide pago por Yape", "Plazo de 48 horas"]));
    expect(r.ficha).toBeNull();

    await api.submitCase(c.id, "Me escribieron el 3 de octubre. (ficticio)");
    await new Promise((res) => setTimeout(res, 1600));
    r = VictimReport.parse(await api.getReport(c.id));
    expect(r.status).toBe("listo");
    expect(r.ficha?.resumen).toBeTruthy();
    expect(r.cronologia.length).toBe(2);

    // La víctima nunca recibe vínculos, redes, coincidencias ni puntajes.
    const keys = keysDeep(r);
    for (const k of VICTIM_FORBIDDEN_KEYS) expect(keys.has(k)).toBe(false);

    const pdf = await api.getReportPdf(c.id);
    expect(fromUtf8(pdf.slice(0, 8))).toBe("%PDF-1.4");

    const updated = await api.setConsent(c.id, "comunitario");
    expect(updated.consent_mode).toBe("comunitario");

    const alerts = await api.alerts();
    alerts.forEach((a) => VictimAlert.parse(a));
    expect(alerts.length).toBeGreaterThan(0);

    await api.uploadVoiceSample(utf8("voz"), "audio/mp4");
  }, 15_000);

  it("rechaza una subida cuya huella no coincide (422 integrity_mismatch)", async () => {
    const { api } = client();
    await api.registerDevice("BODEGA-2026", { kty: "EC", crv: "P-256", x: "x", y: "y" }, "android");
    const c = await api.createCase({});
    await expect(api.uploadEvidence(c.id, utf8("a"), { tipo: "texto", mime: "text/plain", sha256: "0".repeat(64) })).rejects.toMatchObject({
      status: 422,
      code: "integrity_mismatch",
    });
  });

  it("sin conexión lanza NetworkError (la cola lo usa para reintentar)", async () => {
    const { api } = client({ isOnline: () => false });
    await expect(api.registerDevice("BODEGA-2026", { kty: "EC", crv: "P-256", x: "x", y: "y" }, "android")).rejects.toBeInstanceOf(NetworkError);
  });

  it("un caso ajeno responde 404", async () => {
    const { api } = client();
    await api.registerDevice("BODEGA-2026", { kty: "EC", crv: "P-256", x: "x", y: "y" }, "android");
    await expect(api.getReport("case_ajeno")).rejects.toBeInstanceOf(ApiError);
  });

  it("renueva el token vencido con refresh firmado", async () => {
    const { api, getAuth, setAuth } = client();
    await api.registerDevice("BODEGA-2026", { kty: "EC", crv: "P-256", x: "x", y: "y" }, "android");
    const a = getAuth()!;
    setAuth({ ...a, expires_at: 0 });
    await api.createCase({});
    expect(getAuth()!.access_token).not.toBe(a.access_token);
  });

  it("extrae datos simples para el simulador", () => {
    expect(extraerDatos("Yapea S/ 2,000 en 48 horas, somos de los X")).toMatchObject({ canal_pago: "yape", monto_soles: 2000, plazo: "48 horas", grupo: "Los X" });
    expect(fromUtf8(minimalPdf(["hola"])).endsWith("%%EOF\n")).toBe(true);
  });
});
