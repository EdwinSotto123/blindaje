import * as S from "@blindaje/shared";
import { describe, expect, it } from "vitest";
import { DEMO_PASSWORD, USERS, approvedAlertR002, initialLinks, profileForR001, profileR002Invalid, vigiaDrafts } from "./fixtures";
import { MockApi } from "./mockApi";

const mock = () => new MockApi({ latency: 0, persist: false });

describe("datos ficticios", () => {
  it("cumplen los esquemas de @blindaje/shared", () => {
    for (const l of initialLinks()) expect(S.LinkView.safeParse(l).success).toBe(true);
    for (const p of [profileForR001("p", "muse-spark-1.3", "2026-10-20T00:00:00Z", 3), profileR002Invalid()]) {
      expect(S.ProfileView.safeParse(p).success).toBe(true);
    }
    for (const a of [approvedAlertR002(), ...vigiaDrafts("2026-10-21T00:00:00Z", 1)]) expect(S.AlertView.safeParse(a).success).toBe(true);
  });

  it("todas las citas de los vínculos tienen formato citable", () => {
    for (const l of initialLinks()) {
      const v = l.vinculador!;
      for (const a of [...v.afirmaciones, ...v.contradicciones]) for (const ref of a.evidencia) expect(S.isCitation(ref)).toBe(true);
    }
  });

  it("cuentan la historia A-B por voz con números distintos y B-C por la misma cuenta", () => {
    const [ab, bc] = [initialLinks().find((l) => l.label === "VIN-1")!, initialLinks().find((l) => l.label === "VIN-2")!];
    expect([ab.case_a.code, ab.case_b.code]).toEqual(["A", "B"]);
    expect(ab.signals.voz?.p).toBeGreaterThan(0.8);
    expect(ab.signals.identificador).toBeUndefined();
    const telA = ab.case_a.ficha!.identificadores.find((i) => i.tipo === "telefono")!.ref;
    const telB = ab.case_b.ficha!.identificadores.find((i) => i.tipo === "telefono")!.ref;
    expect(telA).not.toBe(telB);
    expect(bc.signals.identificador?.compartidos.map((c) => c.ultimos_3)).toEqual(["488"]);
    // El puntaje bruto es la combinación 1 − ∏(1 − pᵢ) de las señales.
    for (const l of [ab, bc]) expect(l.score_raw).toBeCloseTo(S.combineSignals(S.signalProbabilities(l.signals)), 2);
  });
});

describe("MockApi", () => {
  it("rechaza credenciales incorrectas y acepta las ficticias", async () => {
    const api = mock();
    await expect(api.login(USERS[1]!.email, "otra-contraseña")).rejects.toMatchObject({ status: 401 });
    const u = await api.login(USERS[1]!.email, DEMO_PASSWORD);
    expect(u.role).toBe("analyst");
  });

  it("al confirmar VIN-1 y VIN-2 aparece la red R-001 de tres casos", async () => {
    const api = mock();
    await api.login(USERS[1]!.email, DEMO_PASSWORD);
    expect((await api.listNetworks()).map((n) => n.label)).toEqual(["R-002"]);
    await api.decideLink("link-1", { decision: "confirmar", note: "Misma voz" });
    let nets = await api.listNetworks();
    expect(nets.find((n) => n.label === "R-001")?.n_cases).toBe(2);
    await api.decideLink("link-2", { decision: "confirmar" });
    nets = await api.listNetworks();
    const r1 = nets.find((n) => n.label === "R-001")!;
    expect(r1.n_cases).toBe(3);
    const view = await api.getNetwork(r1.id);
    expect(S.NetworkView.safeParse(view).success).toBe(true);
    expect(view.links.map((l) => l.label)).toEqual(["VIN-1", "VIN-2"]);
    expect(view.nodes.filter((n) => n.type === "caso")).toHaveLength(3);
    // El vínculo ya no está en la cola.
    expect((await api.listLinks()).map((l) => l.label)).toEqual(["VIN-3"]);
  });

  it("la cola prioriza los probables", async () => {
    const api = mock();
    await api.login(USERS[0]!.email, DEMO_PASSWORD);
    const q = await api.listLinks();
    expect(q.map((l) => l.status)).toEqual(["probable", "probable", "por_revisar"]);
  });

  it("la auditoría se verifica y detecta una alteración", async () => {
    const api = mock();
    await api.login(USERS[2]!.email, DEMO_PASSWORD);
    const ok = await api.verifyAudit();
    expect(ok.ok).toBe(true);
    expect(ok.checked).toBeGreaterThan(10);
    const seq = await api.tamperAudit();
    const bad = await api.verifyAudit();
    expect(bad).toMatchObject({ ok: false, broken_at_seq: seq });
  });

  it("el expediente queda listo con un SHA-256 que coincide con el PDF descargado", async () => {
    let t = Date.parse("2026-10-28T12:00:00Z");
    const api = new MockApi({ latency: 0, persist: false, now: () => new Date(t) });
    await api.login(USERS[1]!.email, DEMO_PASSWORD);
    const e = await api.createExpediente("net-2");
    expect(e.status).toBe("generando");
    t += 2000;
    const ready = await api.getExpediente(e.id);
    expect(ready.status).toBe("listo");
    const pdf = await api.downloadExpediente(e.id);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(ready.sha256);
  });

  it("respeta los roles: la revisora no ve redes ni costos y solo las alertas de su organización", async () => {
    const api = mock();
    await api.reset("red");
    const reviewer = await api.login(USERS[0]!.email, DEMO_PASSWORD);
    await expect(api.listNetworks()).rejects.toMatchObject({ status: 403 });
    await expect(api.costs()).rejects.toMatchObject({ status: 403 });
    const alerts = await api.listAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => a.org_id === reviewer.org.id)).toBe(true);
  });

  it("no aprueba hipótesis de un perfil que no pasó el validador de citas", async () => {
    const api = mock();
    await api.login(USERS[1]!.email, DEMO_PASSWORD);
    await expect(api.decideHypothesis("prof-r002-1-h1", "aprobar")).rejects.toMatchObject({ status: 409 });
  });
});
