import * as S from "@blindaje/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HttpAdvisorApi, type AdvisorActor } from "../api/advisor";
import { HttpClient, MemoryTokenStore } from "../api/client";
import { businessAccountProblem } from "../components/BusinessAccounts";
import { losXContent, MockAdvisorApi } from "../mock/advisorMock";
import { BusinessPreview, ruleChecks, sectorPhrase, unsafeAdvice, visibleTexts } from "./RecommendationsView";

const BASE = "https://api.blindaje.test";

const actor = (role: AdvisorActor["role"], org = "org-bodegas"): AdvisorActor => ({
  id: `u-${role}`,
  role,
  display_name: `${role} demo`,
  org: { id: org, name: org },
});

const mock = (role: AdvisorActor["role"], org?: string) => new MockAdvisorApi(actor(role, org), { latency: 0, persist: false });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HttpAdvisorApi (rutas de docs/API.md)", () => {
  it("lista, corre el Asesor, decide y crea cuentas con el token de la consola", async () => {
    const calls: { method: string; path: string; search: string; body: unknown; auth: string | null }[] = [];
    const draft = { id: "rec-1", org_id: "org-bodegas", status: "borrador", contenido: losXContent("Lima Este", "bodega"), citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] }, model: "muse-spark-1.3", created_at: "2026-10-28T10:00:00Z", approved_by: null, approved_at: null };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ method: init?.method ?? "GET", path: url.pathname, search: url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get("authorization") });
      if (url.pathname === "/v1/console/business-accounts") {
        return json(201, { id: "biz-9", email: "a@b.pe", business_name: "Bodega (ficticia)", sector: "bodega", zona: "Lima Este", org: { id: "org-bodegas", name: "Gremio" } });
      }
      if (url.pathname.endsWith("/decision")) return json(200, { ...draft, status: "aprobada", approved_by: "u1", approved_at: "2026-10-28T11:00:00Z" });
      return json(200, { recommendations: [draft] });
    });
    const client = new HttpClient({ baseUrl: BASE, store: new MemoryTokenStore({ accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 600_000 }), fetch: fetchImpl });
    const api = new HttpAdvisorApi(client);

    expect((await api.listRecommendations("borrador"))[0]!.id).toBe("rec-1");
    await api.runAsesor({ zona: "Lima Este", sector: "", org_id: "org-bodegas" });
    const decided = await api.decideRecommendation("rec-1", "aprobar");
    const account = await api.createBusinessAccount({ email: " A@B.pe ", password: "x".repeat(12), business_name: " Bodega ", sector: "bodega", zona: "Lima Este" });

    expect(calls.map((c) => `${c.method} ${c.path}${c.search}`)).toEqual([
      "GET /v1/console/recommendations?status=borrador",
      "POST /v1/console/asesor/run",
      "POST /v1/console/recommendations/rec-1/decision",
      "POST /v1/console/business-accounts",
    ]);
    // Un rubro vacío no se manda: la API corre para todos los rubros de la organización.
    expect(calls[1]!.body).toEqual({ zona: "Lima Este", org_id: "org-bodegas" });
    expect(calls[2]!.body).toEqual({ decision: "aprobar" });
    expect(calls[3]!.body).toMatchObject({ email: "a@b.pe", business_name: "Bodega" });
    expect(calls.every((c) => c.auth === "Bearer t")).toBe(true);
    expect(decided.status).toBe("aprobada");
    expect(account.id).toBe("biz-9");
  });
});

describe("Asesor simulado", () => {
  it("sus recomendaciones cumplen el contrato de shared", async () => {
    for (const r of await mock("admin").listRecommendations()) expect(S.ConsoleRecommendationView.safeParse(r).success).toBe(true);
    for (const r of await mock("admin").runAsesor({ zona: "Lima Sur", sector: "transporte", org_id: "org-mototaxi" })) {
      expect(S.ConsoleRecommendationView.safeParse(r).success).toBe(true);
      expect(r.contenido.nivel_riesgo).toBe("sin_datos");
    }
  });

  it("aplica los permisos de la API: corre analista o administración; decide revisor o administración", async () => {
    await expect(mock("reviewer").runAsesor({ zona: "Lima Este", sector: "bodega" })).rejects.toMatchObject({ status: 403 });
    await expect(mock("analyst").decideRecommendation("rec-003", "aprobar")).rejects.toMatchObject({ status: 403 });
    const drafts = await mock("analyst").runAsesor({ zona: "Lima Este", sector: "bodega" });
    expect(drafts.every((d) => d.status === "borrador")).toBe(true);
  });

  it("el revisor solo ve y decide lo de su gremio", async () => {
    const recs = await mock("reviewer").listRecommendations();
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.org_id === "org-bodegas")).toBe(true);
    await expect(mock("reviewer").decideRecommendation("rec-004", "rechazar")).rejects.toMatchObject({ status: 404 });
  });

  it("no deja aprobar lo que no pasó el validador de citas (409), igual que la API", async () => {
    const admin = mock("admin");
    await expect(admin.decideRecommendation("rec-004", "aprobar")).rejects.toMatchObject({ status: 409 });
    expect((await admin.decideRecommendation("rec-004", "rechazar")).status).toBe("rechazada");
    const ok = await admin.decideRecommendation("rec-003", "aprobar");
    expect(ok).toMatchObject({ status: "aprobada", approved_by: "admin demo" });
  });

  it("sin zona ni rubro redacta uno por cada zona y rubro de las cuentas de negocio, o dice qué falta", async () => {
    const admin = mock("admin");
    expect((await admin.runAsesor({ org_id: "org-bodegas" })).map((r) => [r.contenido.zona, r.contenido.sector])).toEqual([["Lima Este", "bodega"]]);
    await expect(admin.runAsesor({ org_id: "org-mercado" })).rejects.toMatchObject({ status: 400 });
  });

  it("crea cuentas de negocio: correo único y el revisor solo para su gremio", async () => {
    const admin = mock("admin");
    const a = await admin.createBusinessAccount({ email: "Nuevo@Negocio.pe", password: "x".repeat(12), business_name: "Bodega Nueva (ficticia)", sector: "bodega", zona: "Lima Este", org_id: "org-bodegas" });
    expect(S.BusinessMe.safeParse(a).success).toBe(true);
    expect(a.email).toBe("nuevo@negocio.pe");
    await expect(admin.createBusinessAccount({ email: "nuevo@negocio.pe", password: "x".repeat(12), business_name: "Otra", sector: "bodega", zona: "Lima Este" })).rejects.toMatchObject({ status: 409 });
    await expect(mock("reviewer").createBusinessAccount({ email: "b@c.pe", password: "x".repeat(12), business_name: "Otra", sector: "bodega", zona: "Lima Este", org_id: "org-mototaxi" })).rejects.toMatchObject({ status: 403 });
    await expect(mock("analyst").createBusinessAccount({ email: "b@c.pe", password: "x".repeat(12), business_name: "Otra", sector: "bodega", zona: "Lima Este" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("revisión antes de aprobar", () => {
  it("las recomendaciones del demo pasan todas las reglas de producto", () => {
    const rec = { id: "x", org_id: "o", status: "borrador" as const, contenido: losXContent("Lima Este", "bodega"), citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] }, model: "m", created_at: "", approved_by: null, approved_at: null };
    expect(ruleChecks(rec).filter((c) => !c.ok)).toEqual([]);
  });

  it("marca un consejo de pagar o negociar, un número completo y la falta de sesgo", () => {
    const contenido = losXContent("Lima Este", "bodega");
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

describe("vista previa del negocio", () => {
  it("muestra lo que verá el negocio, por prioridad y sin citas internas", () => {
    const c = losXContent("Lima Este", "bodega");
    const html = renderToStaticMarkup(<BusinessPreview content={c} />);
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).toContain("Para bodegas de Lima Este");
    expect(text.indexOf("Haz esto primero")).toBeLessThan(text.indexOf("Después"));
    expect(text).toContain("“Habla con el jefe”");
    expect(text).toContain("105");
    expect(text).toContain("1818");
    for (const ref of c.modalidades.flatMap((m) => m.evidencia)) expect(text).not.toContain(ref);
    expect(visibleTexts(c).join(" ")).not.toMatch(/FICHA-|R-0/);
  });

  it("valida el formulario de cuenta de negocio antes de llamar a la API", () => {
    const ok = { email: "a@b.pe", password: "x".repeat(12), business_name: "Bodega", sector: "bodega", zona: "Lima Este" };
    expect(businessAccountProblem(ok)).toBeNull();
    expect(businessAccountProblem({ ...ok, email: "a@b" })).toMatch(/correo/);
    expect(businessAccountProblem({ ...ok, password: "corta" })).toMatch(/12 caracteres/);
    expect(businessAccountProblem({ ...ok, zona: "" })).toMatch(/zona/);
  });
});
