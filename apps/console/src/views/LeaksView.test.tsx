import * as S from "@blindaje/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HttpClient, MemoryTokenStore } from "../api/client";
import { HttpLeaksApi } from "../api/leaks";
import { CopyMark } from "../components/Media";
import { PromptGuardBadge, PromptGuardPanel } from "../components/PromptGuard";
import { copyMarkText } from "../lib/leaks";
import { can } from "../lib/permissions";
import { CASES, DEMO_PASSWORD, demoUser, initialLinks, PROMPT_GUARD } from "../mock/fixtures";
import { MockLeaksApi } from "../mock/leaksMock";
import { MockApi } from "../mock/mockApi";
import { LeakResult } from "./LeaksView";
import { injectedInLink, InjectionChip } from "./LinksView";

const BASE = "https://api.blindaje.test";
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');
// Las cuentas del equipo central, por rol (no por posición en USERS).
const user = demoUser;

async function mockAs(role: "reviewer" | "analyst" | "admin") {
  const api = new MockApi({ latency: 0, persist: false });
  await api.login(user(role).email, DEMO_PASSWORD);
  return api;
}

describe("copia marcada para quien la abre", () => {
  it("dice que la copia lleva tu marca, o por qué salió sin ella", () => {
    expect(copyMarkText("aplicada", null)).toEqual({
      label: "Copia marcada para ti",
      tone: "marcada",
      detail: "Este archivo lleva una marca invisible con tu identidad. Si se filtra, se puede saber desde qué cuenta salió.",
    });
    const down = copyMarkText("no_aplicada", "servicio_no_disponible")!;
    expect(down.label).toBe("Copia sin marca");
    expect(down.detail).toMatch(/no respondió a tiempo/);
    expect(down.detail).toMatch(/auditoría con tu cuenta/);
    expect(copyMarkText("no_aplicada", "tipo_no_soportado")!.detail).toMatch(/videos todavía no/);
    expect(copyMarkText(null, null)).toBeNull();
  });

  it("se ve antes de abrir y después, con su estado", () => {
    expect(text(renderToStaticMarkup(<CopyMark state={{ status: "idle" }} />))).toMatch(/Cada copia que abres lleva una marca invisible con tu identidad/);
    const marked = text(renderToStaticMarkup(<CopyMark state={{ status: "ready", marca: "aplicada", motivo: null }} />));
    expect(marked).toContain("Copia marcada para ti");
    expect(marked).toContain("Si se filtra, se puede saber desde qué cuenta salió.");
    const unmarked = renderToStaticMarkup(<CopyMark state={{ status: "ready", marca: "no_aplicada", motivo: "servicio_no_disponible" }} />);
    expect(unmarked).toContain('data-tone="sin_marca"');
    expect(text(unmarked)).toContain("Copia sin marca");
  });

  it("el modo simulado marca audios e imágenes con la cuenta y deja los videos sin marca", async () => {
    const api = await mockAs("reviewer");
    const audio = await api.fetchMedia("/v1/console/evidence/ev-a1/media?start_ms=0&end_ms=4000");
    expect(audio).toMatchObject({ marca: "aplicada", motivo: null });
    expect(audio.blob.type).toBe("audio/wav");
    const video = await api.fetchMedia("/v1/console/evidence/ev-d2/media");
    expect(video).toMatchObject({ marca: "no_aplicada", motivo: "tipo_no_soportado" });
  });
});

describe("rastrear filtración", () => {
  it("solo la administración rastrea (en la consola y en el modo simulado)", async () => {
    expect(can("admin", "leaks.trace")).toBe(true);
    expect(can("analyst", "leaks.trace")).toBe(false);
    expect(can("reviewer", "leaks.trace")).toBe(false);
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
    for (const role of ["reviewer", "analyst"] as const) {
      await expect(new MockLeaksApi({ id: user(role).id, role }, { latency: 0 }).trace(file)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("encuentra la cuenta de una copia simulada filtrada; un archivo sin marca no acusa a nadie", async () => {
    const reviewer = await mockAs("reviewer");
    const analyst = await mockAs("analyst");
    const admin = new MockLeaksApi({ id: user("admin").id, role: "admin" }, { latency: 0 });

    const audio = await reviewer.fetchMedia("/v1/console/evidence/ev-b1/media?start_ms=0&end_ms=3000");
    const r1 = await admin.trace(audio.blob);
    expect(S.LeakTraceResult.safeParse(r1).success).toBe(true);
    expect(r1).toMatchObject({ detected: true, kind: "audio", ambiguo: false });
    expect(r1.candidates[0]).toMatchObject({ user_id: user("reviewer").id, role: "reviewer", evidence_label: null, case_id: null });

    const image = await analyst.fetchMedia("/v1/console/evidence/ev-a4/media");
    const r2 = await admin.trace(image.blob);
    expect(r2.candidates[0]).toMatchObject({ user_id: user("analyst").id, evidence_label: "EV-A4", case_id: CASES.A!.id });

    const clean = await admin.trace(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], { type: "image/jpeg" }));
    expect(clean).toMatchObject({ detected: false, kind: "imagen", candidates: [] });
    expect(clean.nota).toMatch(/no prueba/);
    await expect(admin.trace(new Blob([new Uint8Array([1])], { type: "video/mp4" }))).rejects.toMatchObject({ status: 400 });
  });

  it("con la API real sube el archivo crudo, con su tipo y el token", async () => {
    const calls: { url: string; method: string; type: string | null; auth: string | null; size: number }[] = [];
    const result: S.LeakTraceResult = {
      detected: true,
      kind: "imagen",
      score: 0.91,
      candidates: [{ user_id: "u1", email_or_name: "a@b.pe", display_name: "A", role: "analyst", evidence_label: "EV-A4", case_id: "c1", issued_at: "2026-10-28T10:00:00Z", bit_accuracy: 0.93 }],
      ambiguo: false,
      nota: "Son indicios, no prueba.",
      model: "videoseal",
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ url: String(input), method: init?.method ?? "GET", type: h.get("content-type"), auth: h.get("authorization"), size: (init?.body as Blob).size });
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new HttpClient({ baseUrl: BASE, store: new MemoryTokenStore({ accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 600_000 }), fetch: fetchImpl });
    const out = await new HttpLeaksApi(client).trace(new Blob([new Uint8Array(10)], { type: "image/jpeg" }), "imagen");
    expect(out.candidates[0]!.evidence_label).toBe("EV-A4");
    expect(calls).toEqual([{ url: `${BASE}/v1/console/leaks/trace?kind=imagen`, method: "POST", type: "image/jpeg", auth: "Bearer t", size: 10 }]);
  });

  it("muestra indicios, no culpables: ambigüedad, nota y advertencia", () => {
    const base: S.LeakTraceResult = {
      detected: true,
      kind: "audio",
      score: 0.97,
      candidates: [{ user_id: "u1", email_or_name: "revisora@demo.blindaje.pe", display_name: "Revisora Demo", role: "reviewer", evidence_label: null, case_id: null, issued_at: null, bit_accuracy: 0.875 }],
      ambiguo: false,
      nota: `La marca de audio identifica la cuenta. ${S.NOTA_RASTREO}`,
    };
    const ok = text(renderToStaticMarkup(<LeakResult name="filtrado.wav" result={base} />));
    expect(ok).toContain("Indicios de origen");
    expect(ok).toContain("Revisora Demo");
    expect(ok).toContain("88 % de bits");
    expect(ok).toContain("Esta cuenta no recibió audios marcados");
    expect(ok).toContain("Son indicios, no prueba");
    expect(ok).toContain("no basta para señalar a nadie");
    expect(ok).not.toMatch(/culpable|responsable de la filtración/i);
    const amb = text(renderToStaticMarkup(<LeakResult name="x.wav" result={{ ...base, ambiguo: true }} />));
    expect(amb).toContain("Más de una cuenta podría explicar esta marca");
    const none = text(renderToStaticMarkup(<LeakResult name="x.jpg" result={{ ...base, kind: "imagen", detected: false, candidates: [] }} />));
    expect(none).toContain("No encontramos una marca de Blindaje");
  });
});

describe("posible inyección de instrucciones (Prompt Guard)", () => {
  it("los datos simulados cumplen el contrato y marcan EV-C1", () => {
    for (const r of Object.values(PROMPT_GUARD)) expect(S.PromptGuardResult.safeParse(r).success).toBe(true);
    for (const l of initialLinks()) expect(S.LinkView.safeParse(l).success).toBe(true);
    const vin2 = initialLinks().find((l) => l.label === "VIN-2")!;
    expect(injectedInLink(vin2)).toEqual(["EV-C1"]);
    expect(injectedInLink(initialLinks().find((l) => l.label === "VIN-1")!)).toEqual([]);
    expect(text(renderToStaticMarkup(<InjectionChip labels={["EV-C1"]} />))).toBe("EV-C1: posible inyección");
  });

  it("el indicador sale solo si está marcada, con su puntaje; el panel explica que sigue siendo evidencia", () => {
    expect(text(renderToStaticMarkup(<PromptGuardBadge result={PROMPT_GUARD["EV-C1"]} />))).toBe("Posible inyección de instrucciones · 0.98");
    expect(renderToStaticMarkup(<PromptGuardBadge result={PROMPT_GUARD["EV-A3"]} />)).toBe("");
    expect(renderToStaticMarkup(<PromptGuardBadge result={PROMPT_GUARD["EV-D1"]} />)).toBe("");
    const panel = text(renderToStaticMarkup(<PromptGuardPanel result={PROMPT_GUARD["EV-C1"]} />));
    expect(panel).toContain("Sigue siendo evidencia");
    expect(text(renderToStaticMarkup(<PromptGuardPanel result={PROMPT_GUARD["EV-D1"]} />))).toMatch(/Sin revisar/);
    expect(renderToStaticMarkup(<PromptGuardPanel result={null} />)).toBe("");
  });
});
