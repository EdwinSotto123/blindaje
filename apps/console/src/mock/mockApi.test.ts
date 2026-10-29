import * as S from "@blindaje/shared";
import { describe, expect, it } from "vitest";
import { DEMO_PASSWORD, ORGS, USERS, approvedAlertR002, demoUser, initialLinks, profileForR001, profileR002Invalid, vigiaDrafts } from "./fixtures";
import { MockApi } from "./mockApi";

const mock = () => new MockApi({ latency: 0, persist: false });

async function as(role: "reviewer" | "analyst" | "admin", api = mock()) {
  await api.login(demoUser(role).email, DEMO_PASSWORD);
  return api;
}

describe("datos ficticios", () => {
  it("cumplen los esquemas de @blindaje/shared", () => {
    for (const l of initialLinks()) expect(S.LinkView.safeParse(l).success).toBe(true);
    for (const p of [profileForR001("p", "muse-spark-1.3", "2026-10-20T00:00:00Z", 3), profileR002Invalid()]) {
      expect(S.ProfileView.safeParse(p).success).toBe(true);
    }
    for (const a of [approvedAlertR002(), ...vigiaDrafts("2026-10-21T00:00:00Z", 1)]) expect(S.AlertView.safeParse(a).success).toBe(true);
  });

  it("el equipo es de la organización central y las demás organizaciones son canales de difusión", () => {
    expect(USERS.map((u) => u.role)).toEqual(["reviewer", "analyst", "admin"]);
    expect(USERS.every((u) => u.org.id === S.CENTRAL_ORG_ID)).toBe(true);
    expect(ORGS.find((o) => o.id === S.CENTRAL_ORG_ID)?.kind).toBe("alianza");
    expect(ORGS.filter((o) => o.id !== S.CENTRAL_ORG_ID).every((o) => (o.users ?? 0) === 0)).toBe(true);
    expect(JSON.stringify([USERS, ORGS])).not.toMatch(/Alianza Blindaje|org-alianza/);
  });

  it("una alerta por distrito, en la organización central y con la zona en su distrito", () => {
    const drafts = vigiaDrafts("2026-10-21T00:00:00Z", 1);
    const zonas = drafts.map((a) => a.borrador.zona);
    expect(new Set(zonas).size).toBe(drafts.length);
    for (const a of [approvedAlertR002(), ...drafts]) {
      expect(a.org_id).toBe(S.CENTRAL_ORG_ID);
      expect(S.districtOfZone(a.borrador.zona)).not.toBeNull();
      expect(a.borrador.titulo).not.toMatch(/asociad|gremio/i);
    }
    expect(approvedAlertR002().approved_by).toBe(demoUser("reviewer").display_name);
  });

  it("los casos están en un distrito de la lista (con su celda interna)", () => {
    for (const l of initialLinks()) for (const c of [l.case_a, l.case_b]) expect(S.districtOfZone(c.zona)).not.toBeNull();
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
    const api = await as("reviewer");
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

  it("respeta los roles: la revisora no ve redes ni costos, pero sí las alertas de todos los distritos", async () => {
    const api = mock();
    await api.reset("red");
    await as("reviewer", api);
    await expect(api.listNetworks()).rejects.toMatchObject({ status: 403 });
    await expect(api.costs()).rejects.toMatchObject({ status: 403 });
    const alerts = await api.listAlerts();
    expect(alerts.map((a) => a.borrador.zona).sort()).toEqual(["Ate", "Comas", "San Juan de Lurigancho"]);
  });

  it("aprueba el equipo: revisión y análisis deciden alertas de cualquier distrito", async () => {
    const api = mock();
    await api.reset("red");
    await as("reviewer", api);
    const [sjl, ate] = await api.listAlerts("borrador");
    const approved = await api.decideAlert(sjl!.id, { decision: "aprobar", titulo: "Aviso para tu zona" });
    expect(approved).toMatchObject({ status: "aprobada", approved_by: "Revisora Demo", borrador: { titulo: "Aviso para tu zona" } });
    await expect(api.decideAlert(sjl!.id, { decision: "rechazar" })).rejects.toMatchObject({ status: 409 });
    await api.logout();
    await as("analyst", api);
    expect(await api.decideAlert(ate!.id, { decision: "rechazar" })).toMatchObject({ status: "rechazada", approved_by: "Analista Demo" });
    await expect(api.runVigia()).resolves.toEqual([]);
  });

  it("el Vigía redacta un borrador por distrito donde la red pasa el umbral", async () => {
    const api = mock();
    await api.reset("red");
    await as("analyst", api);
    for (const a of await api.listAlerts("borrador")) await api.decideAlert(a.id, { decision: "rechazar" });
    const created = await api.runVigia();
    expect(created.map((a) => a.borrador.zona)).toEqual(["San Juan de Lurigancho", "Ate"]);
    expect(new Set(created.map((a) => a.id)).size).toBe(2);
  });

  it("solo la administración genera códigos de un canal y crea cuentas del equipo central", async () => {
    await expect((await as("reviewer")).createInvites({ count: 2 })).rejects.toMatchObject({ status: 403 });
    const admin = await as("admin");
    expect(await admin.createInvites({ org_id: "org-bodegas", count: 2 })).toHaveLength(2);
    const u = await admin.createUser({ email: "nueva@demo.blindaje.pe", display_name: "Nueva", role: "reviewer", org_id: S.CENTRAL_ORG_ID, password: "x".repeat(12) });
    expect(u.org.id).toBe(S.CENTRAL_ORG_ID);
  });

  it("no aprueba hipótesis de un perfil que no pasó el validador de citas", async () => {
    const api = mock();
    await api.login(USERS[1]!.email, DEMO_PASSWORD);
    await expect(api.decideHypothesis("prof-r002-1-h1", "aprobar")).rejects.toMatchObject({ status: 409 });
  });
});

describe("zonas simuladas", () => {
  it("cumplen el contrato de shared, con distritos sobre y bajo el umbral", async () => {
    const api = await as("reviewer");
    for (const dias of [14, 28, 90]) {
      const z = await api.zones(dias);
      expect(S.ConsoleZones.safeParse(z).success).toBe(true);
      expect(z.periodo_dias).toBe(dias);
      expect(z.filas.some((f) => f.sobre_umbral)).toBe(true);
      expect(z.filas.some((f) => !f.sobre_umbral)).toBe(true);
      for (const f of z.filas) {
        expect(S.districtById(f.distrito)).not.toBeNull();
        expect(f.sobre_umbral).toBe(S.canShowTerritorialStats(f.casos, f.victimas));
        // Bajo el umbral no viajan redes ni modalidades.
        if (!f.sobre_umbral) expect([f.redes, f.modalidades]).toEqual([[], []]);
      }
    }
  });

  it("una red aparece en su distrito solo cuando existe", async () => {
    const api = await as("analyst");
    const sjl = async () => (await api.zones(28)).filas.find((f) => f.distrito === "san-juan-de-lurigancho")!;
    expect((await sjl()).redes).toEqual([]);
    expect((await api.zones(28)).filas.find((f) => f.distrito === "comas")!.redes).toEqual(["R-002"]);
    await api.decideLink("link-1", { decision: "confirmar" });
    expect((await sjl()).redes).toEqual(["R-001"]);
  });
});
