import { BlindajeApi, type AuthState, caseRequestFrom, VictimReportConConsejos } from "@/api/client";
import { ApiError, type Fetcher, NetworkError } from "@/api/http";
import { createMockServer, extraerDatos, minimalPdf } from "@/api/mock";
import { fromUtf8, utf8 } from "@/lib/bytes";
import { sha256Hex } from "@/security/hash";
import { capitalizar, consejosDe, nombreDeZona, porPrioridad, riesgoEnPalabras } from "@/private/recomendaciones";
import {
  BusinessRecommendationView,
  CaseSummary,
  CENTRAL_ORG_ID,
  textoAutenticidadVictima,
  VICTIM_FORBIDDEN_KEYS,
  VictimAlert,
  VictimReport,
} from "@/shared";

const JWK = { kty: "EC", crv: "P-256", x: "x", y: "y" } as const;

/**
 * Cliente real contra el servidor simulado. `wrap` permite cambiar respuestas puntuales; `device`
 * activa el registro sin código (como en la app) y `autoRegister` decide si una llamada sin sesión
 * registra por su cuenta.
 */
function client(
  opts: Parameters<typeof createMockServer>[0] = {},
  wrap?: (f: Fetcher) => Fetcher,
  { device = false, autoRegister }: { device?: boolean; autoRegister?: () => boolean } = {},
) {
  const server = createMockServer({ processMs: 0, ...opts });
  let auth: AuthState | null = null;
  const api = new BlindajeApi({
    baseUrl: "https://mock.local",
    fetcher: wrap ? wrap(server.fetcher) : server.fetcher,
    auth: { get: async () => auth, set: async (a) => void (auth = a), clear: async () => void (auth = null) },
    sign: async () => "firma",
    ...(device ? { device: async () => ({ publicKey: JWK, platform: "android" as const }) } : {}),
    ...(autoRegister ? { autoRegister } : {}),
  });
  return { api, server, getAuth: () => auth, setAuth: (a: AuthState) => (auth = a) };
}

/** Anota cada petición (URL y cuerpo JSON) antes de pasarla al servidor simulado. */
function spy(log: { url: string; method: string; body: Record<string, unknown> | null }[]) {
  return (f: Fetcher): Fetcher =>
    async (url, req) => {
      const body = typeof req.body === "string" ? (JSON.parse(req.body) as Record<string, unknown>) : null;
      log.push({ url, method: req.method, body });
      return f(url, req);
    };
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
    const auth = await api.registerDevice(JWK, "android");
    expect(auth.pseudonym).toMatch(/^V-/);
    const c = CaseSummary.parse(await api.createCase({ consent_mode: "solo_denuncia" }));
    expect(c.consent_mode).toBe("solo_denuncia");

    const texto = utf8("Si no yapeas S/ 2,000 en 48 horas al 987 654 321, somos de Los X. (ficticio)");
    await api.uploadEvidence(c.id, texto, { tipo: "texto", mime: "text/plain", sha256: sha256Hex(texto), source: "pegado" });
    const audio = utf8("audio ficticio");
    await api.uploadEvidence(c.id, audio, { tipo: "audio", mime: "audio/mp4", sha256: sha256Hex(audio), source: "grabacion", durationMs: 42000 });

    let r = VictimReportConConsejos.parse(await api.getReport(c.id));
    expect(r.hallazgos).toEqual(expect.arrayContaining(["Pide pago por Yape", "Plazo de 48 horas"]));
    expect(r.ficha).toBeNull();
    // Mientras se prepara no hay consejos todavía.
    expect(consejosDe(r)).toEqual([]);

    await api.submitCase(c.id, "Me escribieron el 3 de octubre. (ficticio)");
    await new Promise((res) => setTimeout(res, 1600));
    r = VictimReportConConsejos.parse(await api.getReport(c.id));
    expect(r.status).toBe("listo");
    expect(r.ficha?.resumen).toBeTruthy();
    expect(r.cronologia.length).toBe(2);
    // Consejos de prevención según su propio caso: Yape y el plazo de 48 horas.
    expect(r.consejos).toEqual(expect.arrayContaining([expect.stringMatching(/Yape/), expect.stringMatching(/48 horas/)]));
    // Autenticidad: el texto corto para audio, imagen y video procesados; null para un texto pegado.
    const porTipo = new Map(r.evidencia.map((e) => [e.tipo, e.autenticidad]));
    expect(porTipo.get("audio")).toBe(textoAutenticidadVictima("sin_senales"));
    expect(porTipo.get("texto")).toBeNull();

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
    await api.registerDevice(JWK, "android");
    const c = await api.createCase({});
    await expect(api.uploadEvidence(c.id, utf8("a"), { tipo: "texto", mime: "text/plain", sha256: "0".repeat(64) })).rejects.toMatchObject({
      status: 422,
      code: "integrity_mismatch",
    });
  });

  it("sin conexión lanza NetworkError (la cola lo usa para reintentar)", async () => {
    const { api } = client({ isOnline: () => false });
    await expect(api.registerDevice(JWK, "android")).rejects.toBeInstanceOf(NetworkError);
  });

  it("un caso ajeno responde 404", async () => {
    const { api } = client();
    await api.registerDevice(JWK, "android");
    await expect(api.getReport("case_ajeno")).rejects.toBeInstanceOf(ApiError);
  });

  it("renueva el token vencido con refresh firmado", async () => {
    const { api, getAuth, setAuth } = client();
    await api.registerDevice(JWK, "android");
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

describe("Registro sin código (rediseño del 28/10)", () => {
  it("registra sin código: no manda invite_code y el celular queda en la organización central", async () => {
    const log: Parameters<typeof spy>[0] = [];
    const { api, server } = client({}, spy(log));
    const auth = await api.registerDevice(JWK, "android");
    expect(auth.pseudonym).toMatch(/^V-[0-9A-F]{4}$/);
    const reg = log.find((r) => r.url.endsWith("/v1/auth/device/register"))!;
    expect(reg.body).toEqual({ public_key: JWK, platform: "android" });
    expect(server.debug.devices.get(auth.device_id)?.org).toBe(CENTRAL_ORG_ID);
    // La sesión guardada ya no depende de la organización.
    expect(auth).not.toHaveProperty("org");
  });

  it("un código de un APK antiguo sigue funcionando y uno vencido da 400 bad_request", async () => {
    const server = createMockServer({ processMs: 0 });
    const ok = await server.fetcher("https://mock.local/v1/auth/device/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite_code: "BODEGA-2026", public_key: JWK, platform: "android" }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { org: { id: string } }).org.id).toBe("org_demo");
    const vencido = await server.fetcher("https://mock.local/v1/auth/device/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite_code: "NOVALE-1", public_key: JWK, platform: "android" }),
    });
    expect(vencido.status).toBe(400);
    expect(((await vencido.json()) as { error: { code: string } }).error.code).toBe("bad_request");
  });

  it("acepta una respuesta de registro sin org (el API la va a quitar)", async () => {
    const sinOrg = (f: Fetcher): Fetcher => async (url, req) => {
      const res = await f(url, req);
      if (!url.endsWith("/auth/device/register")) return res;
      const { org: _org, ...rest } = (await res.json()) as Record<string, unknown>;
      return fake(res.status, rest);
    };
    const { api } = client({}, sinOrg);
    await expect(api.registerDevice(JWK, "android")).resolves.toMatchObject({ pseudonym: expect.stringMatching(/^V-/) });
  });

  it("sin sesión, la primera llamada registra el celular una sola vez", async () => {
    const { api, server, getAuth } = client({}, undefined, { device: true });
    expect(getAuth()).toBeNull();
    const [c] = await Promise.all([api.createCase({}), api.alerts(), api.ensureRegistered()]);
    expect(CaseSummary.parse(c).id).toBeTruthy();
    expect(server.debug.devices.size).toBe(1);
    expect(getAuth()?.pseudonym).toMatch(/^V-/);
    // Con sesión, no vuelve a registrar.
    await api.ensureRegistered();
    expect(server.debug.devices.size).toBe(1);
  });

  it("sin internet el registro falla con NetworkError (la cola reintenta) y después funciona", async () => {
    let online = false;
    const { api, server, getAuth } = client({ isOnline: () => online }, undefined, { device: true });
    await expect(api.createCase({})).rejects.toBeInstanceOf(NetworkError);
    expect(getAuth()).toBeNull();
    online = true;
    await expect(api.createCase({})).resolves.toMatchObject({ status: "borrador" });
    expect(server.debug.devices.size).toBe(1);
  });

  it("si no se permite registrar solo (por ejemplo, tras un borrado), no registra; a propósito, sí", async () => {
    let permitido = false;
    const { api, server, getAuth } = client({}, undefined, { device: true, autoRegister: () => permitido });
    await expect(api.createCase({})).rejects.toMatchObject({ status: 401 });
    expect(server.debug.devices.size).toBe(0);
    // "Empezar" y la muestra de voz registran a propósito.
    await api.ensureRegistered();
    expect(getAuth()?.pseudonym).toMatch(/^V-/);
    permitido = true;
    await expect(api.createCase({})).resolves.toMatchObject({ status: "borrador" });
    expect(server.debug.devices.size).toBe(1);
  });

  it("sin forma de registrar, una llamada sin sesión responde 401", async () => {
    const { api } = client();
    await expect(api.ensureRegistered()).rejects.toMatchObject({ status: 401 });
    await expect(api.createCase({})).rejects.toMatchObject({ status: 401 });
  });
});

describe("Distrito", () => {
  it("el pedido del caso lleva el id del distrito, nunca texto libre", () => {
    expect(caseRequestFrom({ consent: "solo_denuncia", sector: "bodega", zona: "san-juan-de-lurigancho" })).toEqual({
      consent_mode: "solo_denuncia",
      sector: "bodega",
      zona: "san-juan-de-lurigancho",
    });
    // Texto libre de una versión anterior: se traduce si es un distrito.
    expect(caseRequestFrom({ consent: "comunitario", sector: null, zona: "Rímac" })).toEqual({ consent_mode: "comunitario", zona: "rimac" });
    // Si no es un distrito (por ejemplo, una dirección), no se manda.
    expect(caseRequestFrom({ consent: "solo_denuncia", sector: null, zona: "Av. Los Olivos 123" })).toEqual({ consent_mode: "solo_denuncia" });
    expect(caseRequestFrom({ consent: "solo_denuncia", sector: null, zona: null })).toEqual({ consent_mode: "solo_denuncia" });
  });

  it("crear el caso manda la zona como id y el simulador la guarda así", async () => {
    const log: Parameters<typeof spy>[0] = [];
    const { api, server } = client({}, spy(log), { device: true });
    const c = await api.createCase(caseRequestFrom({ consent: "solo_denuncia", sector: null, zona: "ate" }));
    expect(log.find((r) => r.method === "POST" && r.url.endsWith("/v1/cases"))!.body).toEqual({ consent_mode: "solo_denuncia", zona: "ate" });
    expect(server.debug.cases.get(c.id)?.zona).toBe("ate");
  });

  it("avisos y recomendaciones de su distrito: ?zona= o, si no viene, el de su último caso", async () => {
    const log: Parameters<typeof spy>[0] = [];
    const { api } = client({}, spy(log), { device: true });
    // Sin distrito ni caso: todos los avisos.
    expect((await api.alerts()).length).toBe(2);
    const sjl = await api.alerts("san-juan-de-lurigancho");
    expect(sjl.map((a) => a.distrito)).toEqual(["san-juan-de-lurigancho"]);
    expect(log.at(-1)!.url).toBe("https://mock.local/v1/alerts?zona=san-juan-de-lurigancho");
    expect(await api.alerts("ate")).toEqual([]);
    expect((await api.recommendations({ zona: "san-juan-de-lurigancho", sector: "bodega" })).length).toBe(1);
    expect(log.at(-1)!.url).toBe("https://mock.local/v1/recommendations?zona=san-juan-de-lurigancho&sector=bodega");
    expect(await api.recommendations({ zona: "ate" })).toEqual([]);
    // Sin ?zona=, el distrito de su último caso.
    await api.createCase({ zona: "san-juan-de-miraflores" });
    expect((await api.alerts()).map((a) => a.distrito)).toEqual(["san-juan-de-miraflores"]);
    // Cada aviso del simulador trae el nombre para mostrar y el id del distrito.
    for (const a of await api.alerts()) expect(VictimAlert.parse(a)).toMatchObject({ zona: "San Juan de Miraflores", distrito: "san-juan-de-miraflores" });
  });
});

/** Respuesta JSON armada a mano para simular lo que todavía no hace el API real. */
function fake(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    header: () => "application/json",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    bytes: async () => utf8(text),
  };
}

/** Reemplaza solo GET /v1/recommendations (con o sin ?zona=); el resto va al servidor simulado. */
const onRecommendations =
  (status: number, body: unknown) =>
  (f: Fetcher): Fetcher =>
  async (url, req) =>
    url.split("?")[0]!.endsWith("/v1/recommendations") ? fake(status, body) : f(url, req);

const TELEFONO_COMPLETO = /\b9\d{2}\s?\d{3}\s?\d{3}\b/;

describe("Recomendaciones aprobadas de la zona (GET /v1/recommendations)", () => {
  const registrar = (api: BlindajeApi) => api.registerDevice(JWK, "android");

  it("el simulador responde { recommendations } válidas, ficticias y sin datos internos", async () => {
    const { api } = client();
    await registrar(api);
    const recs = await api.recommendations();
    expect(recs.length).toBeGreaterThan(0);
    recs.forEach((r) => BusinessRecommendationView.parse(r));
    const r = recs[0]!;
    expect(r).toMatchObject({ zona: "San Juan de Lurigancho", distrito: "san-juan-de-lurigancho" });
    expect(r.sector).toBe("bodegas");
    expect(r.advertencias).toEqual(
      expect.arrayContaining(["Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa.", expect.stringMatching(/ficticios/)]),
    );
    const texto = JSON.stringify(recs);
    // Nunca números completos, nunca aconseja pagar ni negociar, y "habla con el jefe" está para reconocerla.
    expect(texto).not.toMatch(TELEFONO_COMPLETO);
    expect(texto).toMatch(/habla con el jefe/);
    const consejos = [...r.recomendaciones.map((x) => `${x.titulo}. ${x.detalle}`), ...r.que_hacer_si_te_pasa];
    for (const c of consejos.filter((x) => /\b(pag(a|ar|ues)|negoci(a|ar|es))\b/i.test(x))) expect(c).toMatch(/\b(no|ni|nadie|nunca)\b/i);
    // Sin citas internas ni claves prohibidas para la víctima.
    const keys = keysDeep(recs);
    for (const k of VICTIM_FORBIDDEN_KEYS) expect(keys.has(k)).toBe(false);
    expect(keys.has("evidencia")).toBe(false);
  });

  it("exige la sesión del dispositivo, igual que /alerts", async () => {
    const { api } = client();
    await expect(api.recommendations()).rejects.toMatchObject({ status: 401 });
  });

  it("si el API real todavía no tiene la ruta (404), devuelve una lista vacía", async () => {
    const { api } = client({}, onRecommendations(404, { error: { code: "not_found", message: "Ruta desconocida" } }));
    await registrar(api);
    await expect(api.recommendations()).resolves.toEqual([]);
  });

  it("también acepta un arreglo directo", async () => {
    const { api: base } = client();
    await registrar(base);
    const recs = await base.recommendations();
    const { api } = client({}, onRecommendations(200, recs));
    await registrar(api);
    await expect(api.recommendations()).resolves.toEqual(recs);
  });

  it("valida con el esquema de shared y no esconde otros errores", async () => {
    const malo = client({}, onRecommendations(200, { recommendations: [{ id: "rec_1", resumen: "sin el resto" }] }));
    await registrar(malo.api);
    await expect(malo.api.recommendations()).rejects.toThrow();

    const caido = client({}, onRecommendations(500, { error: { code: "internal", message: "falló" } }));
    await registrar(caido.api);
    await expect(caido.api.recommendations()).rejects.toBeInstanceOf(ApiError);

    let online = true;
    const offline = client({ isOnline: () => online });
    await registrar(offline.api);
    online = false;
    await expect(offline.api.recommendations()).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("Consejos del reporte (aditivos: el API real todavía no los manda)", () => {
  const base = {
    case_id: "case_1",
    code: "C-0001",
    status: "listo",
    consent_mode: "solo_denuncia",
    hallazgos: [],
    ficha: null,
    cronologia: [],
    evidencia: [],
    updated_at: "2026-10-28T10:00:00-05:00",
  };

  it("el cliente no descarta el reporte por traer consejos", () => {
    const r = VictimReportConConsejos.parse({ ...base, consejos: ["No respondas ni pagues."] });
    expect(r.consejos).toEqual(["No respondas ni pagues."]);
    expect(consejosDe(r)).toEqual(["No respondas ni pagues."]);
  });

  it("un reporte sin consejos (API actual) se lee igual, con la lista vacía", () => {
    const r = VictimReportConConsejos.parse(base);
    expect(VictimReport.parse(base).case_id).toBe("case_1");
    expect(r.consejos).toEqual([]);
    expect(consejosDe(r)).toEqual([]);
  });

  it("si los consejos vienen mal formados, se ignoran sin romper el reporte", () => {
    expect(VictimReportConConsejos.parse({ ...base, consejos: null }).consejos).toEqual([]);
    expect(VictimReportConConsejos.parse({ ...base, consejos: "no es lista" }).consejos).toEqual([]);
    expect(consejosDe({ ...base, consejos: ["  ", 3, " Guarda todo aquí. "] } as never)).toEqual(["Guarda todo aquí."]);
    expect(consejosDe(null)).toEqual([]);
  });
});

describe("Ayudas de las recomendaciones", () => {
  it("ordena por prioridad alta, media y baja, y respeta el orden del equipo en empates", () => {
    const recs = [
      { titulo: "b1", detalle: "", prioridad: "baja" as const },
      { titulo: "a1", detalle: "", prioridad: "alta" as const },
      { titulo: "m1", detalle: "", prioridad: "media" as const },
      { titulo: "a2", detalle: "", prioridad: "alta" as const },
    ];
    expect(porPrioridad(recs).map((r) => r.titulo)).toEqual(["a1", "a2", "m1", "b1"]);
    expect(recs[0]!.titulo).toBe("b1");
  });

  it("el riesgo va en palabras, sin alarma", () => {
    expect(riesgoEnPalabras("medio")).toBe("Riesgo en tu zona: medio");
    expect(riesgoEnPalabras("sin_datos")).toMatch(/aún no hay suficientes casos/);
    expect(capitalizar("bodegas")).toBe("Bodegas");
  });

  it("la zona se muestra con el nombre del distrito, venga como id o como texto", () => {
    expect(nombreDeZona({ zona: "San Juan de Lurigancho", distrito: "san-juan-de-lurigancho" })).toBe("San Juan de Lurigancho");
    expect(nombreDeZona({ zona: "san-juan-de-miraflores" })).toBe("San Juan de Miraflores");
    expect(nombreDeZona({ zona: "Rimac", distrito: null })).toBe("Rímac");
    expect(nombreDeZona({ zona: "Lima Este" })).toBe("Lima Este");
  });
});
