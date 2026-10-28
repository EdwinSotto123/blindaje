import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { LEAK_TAG_MIN_DISTANCE, LeakTraceResult } from "@blindaje/shared";
import { ensureUserTag, insertTagIfFar, resetLeaksForTests, TagSpaceExhaustedError } from "../src/leaks";
import { bitAccuracy, bitsToInt16, hamming16, hexToBits, matchAudio, matchImage, pickTag, RESERVED_TAGS } from "../src/leaks/match";
import { utf8 } from "../src/lib/encoding";
import { newId, nowIso } from "../src/lib/ids";
import { makeWav } from "../src/lib/wav";
import { setMlClientForTests } from "../src/ml/client";
import { fakeImage, FakeMl, insertEvidence } from "./fakes";
import { api, apiJson, createCase, createUser, loginAs, registerDevice, seedOrg } from "./helpers";

function latin1(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return s;
}

/** Generador determinista para las pruebas de asignación. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

function softFromInt(n: number): number[] {
  return Array.from({ length: 16 }, (_, i) => ((n >> (15 - i)) & 1 ? 0.95 : 0.05));
}

describe("marcas de audio por cuenta (16 bits)", () => {
  it("cada marca nueva queda a distancia >= 5 de todas las demás y de las reservadas", () => {
    const taken: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t = pickTag(taken);
      expect(t).not.toBeNull();
      taken.push(t!);
    }
    for (let i = 0; i < taken.length; i++) {
      for (const r of RESERVED_TAGS) expect(hamming16(taken[i]!, r)).toBeGreaterThanOrEqual(LEAK_TAG_MIN_DISTANCE);
      for (let j = i + 1; j < taken.length; j++) expect(hamming16(taken[i]!, taken[j]!)).toBeGreaterThanOrEqual(LEAK_TAG_MIN_DISTANCE);
    }
  });

  it("si el azar no encuentra lugar, recorre el espacio; si no queda ninguno, devuelve null (nunca una marca cercana)", () => {
    // El azar siempre propone 0x0001 (a distancia 1 de la reservada 0x0000): debe recorrer y encontrar otra.
    const t = pickTag([], seq([0x0001]));
    expect(t).not.toBeNull();
    expect(hamming16(t!, 0)).toBeGreaterThanOrEqual(5);
    // Con distancia 9 no hay ninguna marca lejos a la vez de 0x0000 y 0xFFFF (suman 16 bits).
    expect(pickTag([], seq([0x1234]), 9)).toBeNull();
  });

  it("en D1: la misma cuenta conserva su marca y las cuentas nuevas respetan la distancia", async () => {
    const { orgId } = await seedOrg();
    const users = [];
    for (let i = 0; i < 12; i++) users.push(await createUser("reviewer", orgId));
    const tags = [];
    for (const u of users) tags.push(await ensureUserTag(env, u.id));
    expect(await ensureUserTag(env, users[0]!.id)).toBe(tags[0]);
    const { results } = await env.DB.prepare("SELECT audio_tag FROM user_leak_tags").all<{ audio_tag: number }>();
    const all = results.map((r) => r.audio_tag);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(hamming16(all[i]!, all[j]!)).toBeGreaterThanOrEqual(5);
  });

  it("D1 rechaza en la misma sentencia una marca demasiado cercana (dos cuentas nuevas a la vez)", async () => {
    const { orgId } = await seedOrg();
    const a = await createUser("analyst", orgId);
    const b = await createUser("analyst", orgId);
    const tagA = await ensureUserTag(env, a.id);
    // Como si b hubiera elegido su marca antes de ver la de a: a 4 bits, la sentencia la rechaza.
    expect(await insertTagIfFar(env, b.id, tagA ^ 0b1111)).toBe(false);
    expect(await env.DB.prepare("SELECT 1 FROM user_leak_tags WHERE user_id = ?").bind(b.id).first()).toBeNull();
    const far = pickTag((await env.DB.prepare("SELECT audio_tag FROM user_leak_tags").all<{ audio_tag: number }>()).results.map((r) => r.audio_tag))!;
    expect(await insertTagIfFar(env, b.id, far)).toBe(true);
    expect(await ensureUserTag(env, b.id)).toBe(far);
  });
});

describe("atribución de un audio", () => {
  const tags = [
    { user_id: "u-a", audio_tag: 0b1010_1100_0011_0101 },
    { user_id: "u-b", audio_tag: 0b0101_0011_1100_1010 },
    { user_id: "u-c", audio_tag: 0b1111_0000_1010_0101 },
  ];

  it("lee los bits con el más significativo primero", () => {
    expect(bitsToInt16(softFromInt(0x8001))).toBe(0x8001);
    expect(bitsToInt16([1, ...Array(15).fill(0)])).toBe(0x8000);
  });

  it("exacta: una sola cuenta, sin ambigüedad", () => {
    const m = matchAudio(softFromInt(tags[1]!.audio_tag), tags);
    expect(m.matches.map((x) => [x.user_id, x.distance, x.bit_accuracy])).toEqual([["u-b", 0, 1]]);
    expect(m.ambiguo).toBe(false);
  });

  it("con bits errados: hasta 2 todavía atribuye; con 3 ya no", () => {
    const two = matchAudio(softFromInt(tags[0]!.audio_tag ^ 0b1000_0000_0000_0001), tags);
    expect(two.matches.map((x) => [x.user_id, x.distance])).toEqual([["u-a", 2]]);
    expect(two.matches[0]!.bit_accuracy).toBeCloseTo(14 / 16);
    const three = matchAudio(softFromInt(tags[0]!.audio_tag ^ 0b1000_0001_0000_0001), tags);
    expect(three.matches).toEqual([]);
  });

  it("ambigua: dos cuentas dentro del radio, o bits dudosos que acercan otra cuenta", () => {
    // Marcas que no respetan la distancia (por ejemplo, asignadas a mano): las dos caen en el radio.
    const close = [
      { user_id: "x", audio_tag: 0x00f0 },
      { user_id: "y", audio_tag: 0x00f3 },
    ];
    const both = matchAudio(softFromInt(0x00f1), close);
    expect(both.matches.map((x) => x.user_id).sort()).toEqual(["x", "y"]);
    expect(both.ambiguo).toBe(true);

    // Lectura igual a u-a, pero 4 de los 6 bits en que u-a y u-c difieren salen dudosos (cerca de 0.5):
    // leídos al revés, u-c quedaría a 2 bits. Se atribuye a u-a, pero se avisa la ambigüedad.
    const read = softFromInt(tags[0]!.audio_tag);
    const diff = tags[0]!.audio_tag ^ tags[2]!.audio_tag;
    const positions = Array.from({ length: 16 }, (_, i) => i).filter((i) => (diff >> (15 - i)) & 1);
    expect(positions).toHaveLength(6);
    for (const i of positions.slice(0, 4)) read[i] = read[i]! > 0.5 ? 0.55 : 0.45;
    const m = matchAudio(read, tags);
    expect(m.matches.map((x) => x.user_id)).toEqual(["u-a"]);
    expect(m.ambiguo).toBe(true);
    expect(m.otras_posibles).toBe(1);
  });

  it("sin coincidencia: ninguna cuenta cerca", () => {
    expect(matchAudio(softFromInt(0x6996), tags).matches).toEqual([]);
  });
});

describe("atribución de una imagen", () => {
  const rand = (seed: number) => {
    let a = seed;
    return Array.from({ length: 64 }, () => {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      return (a >> 16).toString(16).slice(-1);
    }).join("");
  };
  const issues = [
    { id: "i1", message: rand(1) },
    { id: "i2", message: rand(2) },
    { id: "i3", message: rand(3) },
  ];

  it("hex a bits con el más significativo primero en cada dígito", () => {
    expect(hexToBits("a1")).toEqual([1, 0, 1, 0, 0, 0, 0, 1]);
    expect(bitAccuracy([0.9, 0.1, 0.8, 0.2, 0.1, 0.1, 0.1, 0.9], hexToBits("a1"))).toBe(1);
  });

  it("exacta y con ruido (exactitud >= 0.85 y ventaja clara)", () => {
    const bits = hexToBits(issues[1]!.message).map((b) => (b ? 0.9 : 0.1));
    const exact = matchImage(bits, issues);
    expect(exact.matches.map((x) => [x.id, x.bit_accuracy])).toEqual([["i2", 1]]);
    expect(exact.ambiguo).toBe(false);
    const noisy = bits.map((b, i) => (i % 9 === 0 ? 1 - b : b)); // ~11 % de bits errados
    const m = matchImage(noisy, issues);
    expect(m.matches.map((x) => x.id)).toEqual(["i2"]);
    expect(m.matches[0]!.bit_accuracy).toBeGreaterThanOrEqual(0.85);
    expect(m.matches[0]!.bit_accuracy).toBeLessThan(1);
  });

  it("ambigua: dos entregas casi iguales", () => {
    const base = issues[0]!.message;
    const twin = { id: "gemela", message: base.slice(0, 60) + "0000" };
    const m = matchImage(hexToBits(base).map((b) => (b ? 0.9 : 0.1)), [...issues, twin]);
    expect(m.ambiguo).toBe(true);
    expect(m.matches.map((x) => x.id).sort()).toEqual(["gemela", "i1"]);
  });

  it("sin coincidencia: una lectura al azar no llega a 0.85", () => {
    const m = matchImage(hexToBits(rand(99)).map((b) => (b ? 0.9 : 0.1)), issues);
    expect(m.matches).toEqual([]);
    expect(m.mejor!).toBeLessThan(0.85);
  });

  it("no compara entregas con otra cantidad de bits", () => {
    expect(matchImage([1, 0, 1, 0], issues).comparadas).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

describe("copias marcadas y rastreo", () => {
  let ml: FakeMl;
  let org: Awaited<ReturnType<typeof seedOrg>>;
  let caseId: string;
  let audioEv: { id: string; label: string };
  let imageEv: { id: string; label: string };
  let videoEv: { id: string; label: string };

  beforeAll(async () => {
    ml = new FakeMl();
    setMlClientForTests(ml);
    org = await seedOrg();
    const d = await registerDevice(org.invite);
    const c = await createCase(d.access_token, "comunitario");
    caseId = c.id;
    audioEv = await insertEvidence(c, 1, "audio", new Uint8Array(makeWav(12_000)), { mime: "audio/wav" });
    imageEv = await insertEvidence(c, 2, "imagen", fakeImage("foto-filtrable"), { mime: "image/jpeg" });
    videoEv = await insertEvidence(c, 3, "video", utf8("video-ficticio"), { mime: "video/mp4" });
  });

  afterEach(() => {
    ml.watermarkMode = "ok";
    ml.bitFlips = [];
    ml.uncertainBits = [];
    resetLeaksForTests();
    setMlClientForTests(ml);
  });

  afterAll(() => setMlClientForTests(null));

  const lastAudit = async (action: string) => {
    const row = await env.DB.prepare("SELECT actor_id, details_json FROM audit_log WHERE action = ? ORDER BY seq DESC LIMIT 1")
      .bind(action)
      .first<{ actor_id: string; details_json: string }>();
    return { actor: row!.actor_id, details: JSON.parse(row!.details_json) as Record<string, unknown> };
  };

  it("el audio recortado sale con la marca de la cuenta, queda registrado y auditado; repetir sale de la caché", async () => {
    const reviewer = await loginAs("reviewer", org.orgId);
    const path = `/v1/console/evidence/${audioEv.id}/media?start_ms=1000&end_ms=4000`;
    const res = await api(path, { token: reviewer.token });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-blindaje-marca")).toBe("aplicada");
    expect(res.headers.get("x-blindaje-marca-motivo")).toBeNull();
    expect(res.headers.get("x-blindaje-variant")).toBe("original_recortado");
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const tag = (await env.DB.prepare("SELECT audio_tag FROM user_leak_tags WHERE user_id = ?").bind(reviewer.id).first<{ audio_tag: number }>())!.audio_tag;
    const body = latin1(await res.arrayBuffer());
    expect(body.startsWith("RIFF")).toBe(true);
    expect(body).toContain(`|wm-audio=${tag}|`);

    const issue = await env.DB.prepare("SELECT * FROM watermark_issues WHERE evidence_id = ? AND user_id = ?")
      .bind(audioEv.id, reviewer.id)
      .first<{ id: string; kind: string; message: string; nbits: number; variant: string; r2_key: string }>();
    expect(issue).toMatchObject({ kind: "audio", message: tag.toString(16).padStart(4, "0"), nbits: 16, variant: "original_recortado:1000-4000" });
    expect(issue!.r2_key).toBe(`cases/${caseId}/marked/${issue!.id}`);
    // La copia guardada está cifrada: no se lee la marca en claro.
    const raw = await env.EVIDENCE.get(issue!.r2_key);
    expect(latin1(await raw!.arrayBuffer())).not.toContain("wm-audio");

    const a1 = await lastAudit("evidence.media");
    expect(a1.actor).toBe(reviewer.id);
    expect(a1.details).toMatchObject({ marca: "aplicada", marca_tipo: "audio", marca_entrega: issue!.id, marca_cache: "miss", marca_modelo: "audioseal-falso" });

    const embeds = ml.calls.filter((c) => c === "watermark:audio:embed").length;
    const again = await api(path, { token: reviewer.token });
    expect(again.headers.get("x-blindaje-marca")).toBe("aplicada");
    expect(latin1(await again.arrayBuffer())).toContain(`|wm-audio=${tag}|`);
    expect(ml.calls.filter((c) => c === "watermark:audio:embed").length).toBe(embeds);
    expect((await lastAudit("evidence.media")).details).toMatchObject({ marca_cache: "hit", marca_entrega: issue!.id });
  });

  it("la imagen sale con un mensaje nuevo por entrega (nbits del contenedor)", async () => {
    const analyst = await loginAs("analyst", org.orgId);
    const res = await api(`/v1/console/evidence/${imageEv.id}/media`, { token: analyst.token });
    expect(res.headers.get("x-blindaje-marca")).toBe("aplicada");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const hex = /\|wm-img=([0-9a-f]+)\|/.exec(latin1(await res.arrayBuffer()))![1]!;
    expect(hex).toHaveLength(64);
    const issue = await env.DB.prepare("SELECT kind, message, nbits, model FROM watermark_issues WHERE evidence_id = ? AND user_id = ?")
      .bind(imageEv.id, analyst.id)
      .first();
    expect(issue).toEqual({ kind: "imagen", message: hex, nbits: 256, model: "videoseal-falso" });
    // Otra persona recibe otro mensaje.
    const other = await loginAs("reviewer", org.orgId);
    const res2 = await api(`/v1/console/evidence/${imageEv.id}/media`, { token: other.token });
    expect(/\|wm-img=([0-9a-f]+)\|/.exec(latin1(await res2.arrayBuffer()))![1]).not.toBe(hex);
  });

  it("falla abierta: sin contenedor, con error o sin respuesta a tiempo se sirve sin marca y se audita", async () => {
    const reviewer = await loginAs("reviewer", org.orgId);
    const path = `/v1/console/evidence/${imageEv.id}/media`;

    ml.watermarkMode = "falla";
    const failed = await api(path, { token: reviewer.token });
    expect(failed.status).toBe(200);
    expect(failed.headers.get("x-blindaje-marca")).toBe("no_aplicada");
    expect(failed.headers.get("x-blindaje-marca-motivo")).toBe("servicio_no_disponible");
    expect(latin1(await failed.arrayBuffer())).not.toContain("wm-img");
    expect((await lastAudit("evidence.media")).details).toMatchObject({ marca: "no_aplicada", marca_motivo: "servicio_no_disponible", marca_error: "MlUnavailableError" });

    ml.watermarkMode = "cuelga";
    resetLeaksForTests(150);
    const started = Date.now();
    const slow = await api(path, { token: reviewer.token });
    expect(slow.headers.get("x-blindaje-marca")).toBe("no_aplicada");
    expect(Date.now() - started).toBeLessThan(10_000);

    setMlClientForTests("not_configured");
    const none = await api(path, { token: reviewer.token });
    expect(none.headers.get("x-blindaje-marca")).toBe("no_aplicada");
    expect((await lastAudit("evidence.media")).details).toMatchObject({ marca: "no_aplicada", marca_error: "not_configured" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watermark_issues WHERE user_id = ?").bind(reviewer.id).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("los videos todavía no se marcan (y lo dice)", async () => {
    const reviewer = await loginAs("reviewer", org.orgId);
    const res = await api(`/v1/console/evidence/${videoEv.id}/media`, { token: reviewer.token });
    expect(res.headers.get("x-blindaje-marca")).toBe("no_aplicada");
    expect(res.headers.get("x-blindaje-marca-motivo")).toBe("tipo_no_soportado");
  });

  it("la consola puede leer el header por CORS", async () => {
    const reviewer = await loginAs("reviewer", org.orgId);
    const res = await api(`/v1/console/evidence/${imageEv.id}/media`, { token: reviewer.token, headers: { origin: "http://localhost:5174" } });
    const exposed = (res.headers.get("access-control-expose-headers") ?? "").toLowerCase();
    expect(exposed).toContain("x-blindaje-marca");
    expect(exposed).toContain("x-blindaje-marca-motivo");
  });

  it("rastrear: solo admin", async () => {
    const reviewer = await loginAs("reviewer", org.orgId);
    const analyst = await loginAs("analyst", org.orgId);
    const victim = await registerDevice(org.invite);
    const body = fakeImage("cualquiera");
    for (const token of [reviewer.token, analyst.token, victim.access_token]) {
      expect((await api("/v1/console/leaks/trace", { token, body, headers: { "content-type": "image/jpeg" } })).status).toBe(403);
    }
    expect((await api("/v1/console/leaks/trace", { body, headers: { "content-type": "image/jpeg" } })).status).toBe(401);
  });

  it("rastrear un audio filtrado: encuentra la cuenta aunque la copia tenga 2 bits dañados; el archivo no se guarda", async () => {
    const reviewer = await loginAs("reviewer", org.orgId);
    const admin = await loginAs("admin", org.orgId);
    const leaked = await (await api(`/v1/console/evidence/${audioEv.id}/media?start_ms=0&end_ms=3000`, { token: reviewer.token })).arrayBuffer();
    const before = (await env.EVIDENCE.list()).objects.length;

    ml.bitFlips = [2, 11];
    const res = await apiJson<LeakTraceResult>("/v1/console/leaks/trace", { token: admin.token, body: leaked, headers: { "content-type": "audio/wav" } });
    expect(res.status).toBe(200);
    expect(LeakTraceResult.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ detected: true, kind: "audio", ambiguo: false });
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0]).toMatchObject({ user_id: reviewer.id, email_or_name: reviewer.email, role: "reviewer", evidence_label: null, case_id: null });
    expect(res.body.candidates[0]!.bit_accuracy).toBeCloseTo(14 / 16);
    expect(res.body.candidates[0]!.issued_at).toBeTruthy();
    expect(res.body.nota).toMatch(/indicios, no prueba/);

    expect((await env.EVIDENCE.list()).objects.length).toBe(before);
    const a = await lastAudit("leak.trace");
    expect(a.actor).toBe(admin.id);
    expect(a.details).toMatchObject({ kind: "audio", detected: true, candidates: [reviewer.id], ambiguo: false, size_bytes: leaked.byteLength });
    expect(a.details.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rastrear una imagen filtrada: cuenta, evidencia y hora de la entrega; una imagen sin marca no acusa a nadie", async () => {
    const analyst = await loginAs("analyst", org.orgId);
    const admin = await loginAs("admin", org.orgId);
    const leaked = await (await api(`/v1/console/evidence/${imageEv.id}/media`, { token: analyst.token })).arrayBuffer();

    ml.bitFlips = Array.from({ length: 20 }, (_, i) => i * 12); // ~8 % de bits dañados por la recompresión
    const res = await apiJson<LeakTraceResult>("/v1/console/leaks/trace", { token: admin.token, body: leaked });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("imagen");
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0]).toMatchObject({ user_id: analyst.id, role: "analyst", evidence_label: imageEv.label, case_id: caseId });
    expect(res.body.candidates[0]!.bit_accuracy).toBeCloseTo(236 / 256, 3);

    ml.bitFlips = [];
    const clean = await apiJson<LeakTraceResult>("/v1/console/leaks/trace", { token: admin.token, body: fakeImage("sin-marca"), headers: { "content-type": "image/jpeg" } });
    expect(clean.body).toMatchObject({ detected: false, kind: "imagen", candidates: [] });
    expect(clean.body.nota).toMatch(/no prueba/);
  });

  it("rastrear: tipo de archivo, videos y contenedor caído", async () => {
    const admin = await loginAs("admin", org.orgId);
    const unknown = await apiJson<{ error: { code: string } }>("/v1/console/leaks/trace", { token: admin.token, body: utf8("hola"), headers: { "content-type": "application/octet-stream" } });
    expect(unknown.status).toBe(400);
    const video = await api("/v1/console/leaks/trace", { token: admin.token, body: utf8("x"), headers: { "content-type": "video/mp4" } });
    expect(video.status).toBe(400);
    expect((await api("/v1/console/leaks/trace", { token: admin.token, body: new Uint8Array(0), headers: { "content-type": "image/jpeg" } })).status).toBe(400);
    setMlClientForTests("not_configured");
    const down = await api("/v1/console/leaks/trace?kind=audio", { token: admin.token, body: new Uint8Array(makeWav(500)) });
    expect(down.status).toBe(503);
  });

  it("si se acaba el espacio de marcas, falla fuerte al asignar y la copia sale sin marca (marcas_agotadas)", async () => {
    const { orgId } = await seedOrg();
    // Llena el espacio con un código voraz (en orden) hasta que no quepa ninguna marca más.
    const { results } = await env.DB.prepare("SELECT audio_tag FROM user_leak_tags").all<{ audio_tag: number }>();
    const taken = results.map((r) => r.audio_tag);
    const fill: number[] = [];
    for (let t = 0; t < 0x10000; t++) {
      if ([...taken, ...fill, ...RESERVED_TAGS].every((x) => hamming16(t, x) >= LEAK_TAG_MIN_DISTANCE)) fill.push(t);
    }
    const ids = fill.map(() => `relleno-${newId()}`);
    const stmts: D1PreparedStatement[] = [];
    fill.forEach((t, i) => {
      stmts.push(
        env.DB.prepare("INSERT INTO users (id, org_id, email, display_name, password_hash, role, disabled, is_demo, created_at) VALUES (?, ?, ?, 'Relleno (ficticio)', 'x', 'reviewer', 1, 0, ?)").bind(
          ids[i],
          orgId,
          `${ids[i]}@prueba.blindaje.test`,
          nowIso(),
        ),
        env.DB.prepare("INSERT INTO user_leak_tags (user_id, audio_tag, created_at) VALUES (?, ?, ?)").bind(ids[i], t, nowIso()),
      );
    });
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    try {
      const reviewer = await loginAs("reviewer", org.orgId);
      await expect(ensureUserTag(env, reviewer.id)).rejects.toBeInstanceOf(TagSpaceExhaustedError);
      const res = await api(`/v1/console/evidence/${audioEv.id}/media?start_ms=0&end_ms=2000`, { token: reviewer.token });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-blindaje-marca")).toBe("no_aplicada");
      expect(res.headers.get("x-blindaje-marca-motivo")).toBe("marcas_agotadas");
    } finally {
      // Borrar las cuentas de relleno borra sus marcas (ON DELETE CASCADE).
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        await env.DB.prepare(`DELETE FROM users WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).run();
      }
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM user_leak_tags WHERE user_id LIKE 'relleno-%'").first<{ n: number }>()).toEqual({ n: 0 });
  });
});

