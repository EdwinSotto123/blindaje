import * as S from "@blindaje/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HttpAdvisorApi, type AdvisorActor } from "../api/advisor";
import { HttpClient, MemoryTokenStore } from "../api/client";
import { losXContent, MockAdvisorApi } from "../mock/advisorMock";
import { asesorProblem, BusinessPreview, ruleChecks, sectorPhrase, unsafeAdvice, visibleTexts } from "./RecommendationsView";

const BASE = "https://api.blindaje.test";

/** Todo el equipo es de la organización central desde el rediseño del 28/10. */
const actor = (role: AdvisorActor["role"]): AdvisorActor => ({
  id: `u-${role}`,
  role,
  display_name: `${role} demo`,
  org: { id: S.CENTRAL_ORG_ID, name: "Equipo de análisis de Blindaje" },
});

const mock = (role: AdvisorActor["role"]) => new MockAdvisorApi(actor(role), { latency: 0, persist: false });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HttpAdvisorApi (rutas de docs/API.md)", () => {
  it("lista, corre el Asesor para un distrito y decide con el token de la consola", async () => {
    const calls: { method: string; path: string; search: string; body: unknown; auth: string | null }[] = [];
    const draft = { id: "rec-1", org_id: S.CENTRAL_ORG_ID, status: "borrador", contenido: losXContent("San Juan de Lurigancho", "bodega"), citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] }, model: "muse-spark-1.3", created_at: "2026-10-28T10:00:00Z", approved_by: null, approved_at: null };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ method: init?.method ?? "GET", path: url.pathname, search: url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get("authorization") });
      if (url.pathname.endsWith("/decision")) return json(200, { ...draft, status: "aprobada", approved_by: "u1", approved_at: "2026-10-28T11:00:00Z" });
      return json(200, { recommendations: [draft] });
    });
    const client = new HttpClient({ baseUrl: BASE, store: new MemoryTokenStore({ accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 600_000 }), fetch: fetchImpl });
    const api = new HttpAdvisorApi(client);

    expect((await api.listRecommendations("borrador"))[0]!.id).toBe("rec-1");
    await api.runAsesor({ zona: "san-juan-de-lurigancho", sector: "bodega" });
    await api.runAsesor({ zona: "ate", sector: "" });
    const decided = await api.decideRecommendation("rec-1", "aprobar");

    expect(calls.map((c) => `${c.method} ${c.path}${c.search}`)).toEqual([
      "GET /v1/console/recommendations?status=borrador",
      "POST /v1/console/asesor/run",
      "POST /v1/console/asesor/run",
      "POST /v1/console/recommendations/rec-1/decision",
    ]);
    // El destino es un distrito y un rubro, nunca una organización ni sus cuentas de negocio.
    expect(calls[1]!.body).toEqual({ zona: "san-juan-de-lurigancho", sector: "bodega" });
    expect(calls[2]!.body).toEqual({ zona: "ate" });
    expect(calls[3]!.body).toEqual({ decision: "aprobar" });
    expect(calls.every((c) => c.auth === "Bearer t")).toBe(true);
    expect(decided.status).toBe("aprobada");
  });
});

describe("Asesor simulado", () => {
  it("sus recomendaciones cumplen el contrato de shared y son de la organización central", async () => {
    for (const r of await mock("admin").listRecommendations()) {
      expect(S.ConsoleRecommendationView.safeParse(r).success).toBe(true);
      expect(r.org_id).toBe(S.CENTRAL_ORG_ID);
    }
    for (const r of await mock("admin").runAsesor({ zona: "villa-maria-del-triunfo", sector: "transporte" })) {
      expect(S.ConsoleRecommendationView.safeParse(r).success).toBe(true);
      expect(r.contenido).toMatchObject({ zona: "Villa María del Triunfo", nivel_riesgo: "sin_datos" });
    }
  });

  it("aplica los permisos de la API: corre análisis o administración; aprueba cualquiera del equipo", async () => {
    await expect(mock("reviewer").runAsesor({ zona: "ate", sector: "bodega" })).rejects.toMatchObject({ status: 403 });
    const drafts = await mock("analyst").runAsesor({ zona: "ate", sector: "bodega" });
    expect(drafts.every((d) => d.status === "borrador")).toBe(true);
    expect(await mock("analyst").decideRecommendation("rec-003", "aprobar")).toMatchObject({ status: "aprobada", approved_by: "analyst demo" });
    expect(await mock("reviewer").decideRecommendation("rec-003", "aprobar")).toMatchObject({ status: "aprobada", approved_by: "reviewer demo" });
  });

  it("el equipo central ve y decide recomendaciones de cualquier distrito", async () => {
    const reviewer = mock("reviewer");
    const recs = await reviewer.listRecommendations();
    expect(recs.map((r) => r.contenido.zona).sort()).toEqual(["Ate", "Comas", "San Juan de Lurigancho"]);
    expect((await reviewer.decideRecommendation("rec-004", "rechazar")).status).toBe("rechazada");
  });

  it("no deja aprobar lo que no pasó el validador de citas (409), igual que la API", async () => {
    const admin = mock("admin");
    await expect(admin.decideRecommendation("rec-004", "aprobar")).rejects.toMatchObject({ status: 409 });
    expect((await admin.decideRecommendation("rec-004", "rechazar")).status).toBe("rechazada");
    const ok = await admin.decideRecommendation("rec-003", "aprobar");
    expect(ok).toMatchObject({ status: "aprobada", approved_by: "admin demo" });
  });

  it("pide un distrito de la lista y un rubro; la modalidad de “Los X” solo donde está activa", async () => {
    const admin = mock("admin");
    await expect(admin.runAsesor({ zona: "", sector: "bodega" })).rejects.toMatchObject({ status: 400 });
    await expect(admin.runAsesor({ zona: "Lima Este", sector: "bodega" })).rejects.toMatchObject({ status: 400 });
    await expect(admin.runAsesor({ zona: "ate", sector: "" })).rejects.toMatchObject({ status: 400 });
    const [ate] = await admin.runAsesor({ zona: "ate", sector: "mototaxi" });
    expect(ate!.contenido).toMatchObject({ zona: "Ate", sector: "mototaxi", nivel_riesgo: "medio" });
    const [mira] = await admin.runAsesor({ zona: "Miraflores", sector: "bodega" });
    expect(mira!.contenido.nivel_riesgo).toBe("sin_datos");
  });

  it("el formulario dice qué falta antes de llamar a la API", () => {
    expect(asesorProblem("", "bodega")).toBe("Elige el distrito.");
    expect(asesorProblem("san-juan-de-lurigancho", "")).toBe("Elige el rubro.");
    expect(asesorProblem("san-juan-de-lurigancho", "bodega")).toBeNull();
  });
});

describe("revisión antes de aprobar", () => {
  it("las recomendaciones del demo pasan todas las reglas de producto y no mencionan gremios", async () => {
    const rec = { id: "x", org_id: "o", status: "borrador" as const, contenido: losXContent("San Juan de Lurigancho", "bodega"), citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] }, model: "m", created_at: "", approved_by: null, approved_at: null };
    expect(ruleChecks(rec).filter((c) => !c.ok)).toEqual([]);
    for (const r of await mock("admin").listRecommendations()) {
      const texts = visibleTexts(r.contenido).join(" ");
      expect(texts).not.toMatch(/gremio|asociaci[oó]n|dirigente/i);
      expect(texts).toContain("No pagues ni negocies");
      expect(texts).toMatch(/\b105\b/);
      expect(texts).toContain("Línea 1818");
    }
  });

  it("marca un consejo de pagar o negociar, un número completo y la falta de sesgo", () => {
    const contenido = losXContent("Ate", "bodega");
    contenido.recomendaciones = [{ titulo: "Negocia el monto", detalle: "Paga por Yape al 987 654 321 si insisten.", prioridad: "alta" }];
    contenido.advertencias = [];
    const rec = { id: "x", org_id: "o", status: "borrador" as const, contenido, citation_check: { ok: false, sin_cita: ["Algo"], citas_inexistentes: [] }, model: "m", created_at: "", approved_by: null, approved_at: null };
    const failing = ruleChecks(rec).filter((c) => !c.ok).map((c) => c.label);
    expect(failing).toEqual([
      "El validador de citas encontró problemas",
      "Sin números, cuentas ni identificadores completos",
      "No aconseja pagar ni negociar",
      "Advierte el sesgo (más casos puede ser más denuncia)",
    ]);
  });

  it("lo negado no cuenta como consejo de pagar", () => {
    expect(unsafeAdvice(["No pagues ni negocies.", "Que nadie paga ni negocia.", "Nunca pagues."])).toEqual([]);
    expect(unsafeAdvice(["Mejor paga una parte."])).toEqual(["Mejor paga una parte."]);
  });

  it("el rubro de la API se lee en plural", () => {
    expect(sectorPhrase("bodega")).toBe("bodegas");
    expect(sectorPhrase("mototaxis")).toBe("mototaxis");
  });
});

describe("vista previa del portal", () => {
  it("muestra lo que verá quien elija el distrito y el rubro, por prioridad y sin citas internas", () => {
    const c = losXContent("San Juan de Lurigancho", "bodega");
    const html = renderToStaticMarkup(<BusinessPreview content={c} />);
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).toContain("Para bodegas de San Juan de Lurigancho");
    expect(text.indexOf("Haz esto primero")).toBeLessThan(text.indexOf("Después"));
    expect(text).toContain("“Habla con el jefe”");
    expect(text).toContain("105");
    expect(text).toContain("1818");
    for (const ref of c.modalidades.flatMap((m) => m.evidencia)) expect(text).not.toContain(ref);
    expect(visibleTexts(c).join(" ")).not.toMatch(/FICHA-|R-0/);
  });

  it("si la zona llega como id de distrito, muestra su nombre", () => {
    const text = renderToStaticMarkup(<BusinessPreview content={losXContent("san-juan-de-lurigancho", "bodega")} />).replace(/<[^>]+>/g, " ");
    expect(text).toContain("Para bodegas de San Juan de Lurigancho");
  });
});
