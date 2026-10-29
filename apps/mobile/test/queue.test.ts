import { BlindajeApi, type AuthState } from "@/api/client";
import { NetworkError } from "@/api/http";
import { createMockServer } from "@/api/mock";
import { equalBytes, utf8 } from "@/lib/bytes";
import { sha256Hex } from "@/security/hash";
import { randomBytes } from "@/security/random";
import type { EvidenceItem } from "@/shared";
import { EvidenceQueue, type EvidenceUploader, MemoryBlobStore, MemoryQueueRepo, type QueueItem } from "@/sync/queue";

function evidence(item: QueueItem, sha = item.sha256): EvidenceItem {
  return {
    id: `ev_${item.id}`,
    label: "EV-A1",
    tipo: item.tipo,
    mime: item.mime,
    size_bytes: item.size,
    sha256: sha,
    received_utc: new Date().toISOString(),
    captured_at: item.captured_at,
    duration_ms: item.duration_ms,
    status: "recibido",
  };
}

function setup(upload: EvidenceUploader["upload"]) {
  const repo = new MemoryQueueRepo();
  const blobs = new MemoryBlobStore();
  const key = randomBytes(32);
  let t = 1_000_000;
  const q = new EvidenceQueue({ repo, blobs, key: async () => key, uploader: { upload }, now: () => t });
  return { q, repo, blobs, advance: (ms: number) => (t += ms) };
}

const audio = () => ({ bytes: utf8("audio ficticio de prueba ".repeat(50)), tipo: "audio" as const, mime: "audio/mp4", source: "grabacion" as const, durationMs: 42000 });

describe("Cola sin conexión", () => {
  it("guarda cifrado: el archivo en disco no es el original", async () => {
    const { q, blobs } = setup(async (i) => evidence(i));
    const input = audio();
    const item = await q.add(input);
    const stored = await blobs.read(item.blob);
    expect(equalBytes(stored, input.bytes)).toBe(false);
    expect(item.sha256).toBe(sha256Hex(input.bytes));
    expect(item.status).toBe("pendiente");
  });

  it("borra el archivo del celular apenas el servidor confirma el mismo SHA-256", async () => {
    const received: Uint8Array[] = [];
    const { q, repo, blobs } = setup(async (i, body) => {
      received.push(body);
      return evidence(i);
    });
    const input = audio();
    const item = await q.add(input);
    const r = await q.flush();
    expect(r.uploaded).toBe(1);
    expect(equalBytes(received[0]!, input.bytes)).toBe(true);
    expect(await blobs.exists(item.blob)).toBe(false);
    const row = (await repo.get(item.id))!;
    expect(row.status).toBe("subido");
    expect(row.evidence_id).toBe(`ev_${item.id}`);
    // Cuando el reporte ya la incluye, se olvida también la fila.
    await q.forgetUploaded(new Set([`ev_${item.id}`]));
    expect(await repo.get(item.id)).toBeNull();
  });

  it("si el servidor confirma otra huella, no borra nada", async () => {
    const { q, repo, blobs } = setup(async (i) => evidence(i, "0".repeat(64)));
    const item = await q.add(audio());
    await q.flush();
    expect(await blobs.exists(item.blob)).toBe(true);
    expect((await repo.get(item.id))!.status).toBe("error");
  });

  it("sin conexión queda pendiente, con reintento creciente, y se sube al volver la señal", async () => {
    let online = false;
    const { q, repo, blobs, advance } = setup(async (i) => {
      if (!online) throw new NetworkError();
      return evidence(i);
    });
    const item = await q.add(audio());
    await q.flush();
    let row = (await repo.get(item.id))!;
    expect(row.status).toBe("pendiente");
    expect(row.attempts).toBe(1);
    expect(row.next_at).toBeGreaterThan(1_000_000);
    expect(await blobs.exists(item.blob)).toBe(true);

    online = true;
    await q.flush(); // todavía en espera
    expect((await repo.get(item.id))!.status).toBe("pendiente");
    advance(10_000);
    await q.flush();
    row = (await repo.get(item.id))!;
    expect(row.status).toBe("subido");
    expect(await blobs.exists(item.blob)).toBe(false);
  });

  it("los archivos compartidos quedan retenidos hasta que la persona los acepta", async () => {
    const upload = jest.fn(async (i: QueueItem) => evidence(i));
    const { q, repo } = setup(upload);
    const item = await q.add({ ...audio(), source: "compartido", hold: true });
    await q.flush();
    expect(upload).not.toHaveBeenCalled();
    expect((await repo.get(item.id))!.status).toBe("retenido");
    await q.release(item.id);
    await q.flush();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("descartar borra archivo y fila", async () => {
    const { q, repo, blobs } = setup(async (i) => evidence(i));
    const item = await q.add({ ...audio(), hold: true });
    await q.discard(item.id);
    expect(await repo.get(item.id)).toBeNull();
    expect(await blobs.exists(item.blob)).toBe(false);
  });

  it("de punta a punta con el servidor simulado: registra, crea caso, sube y verifica integridad", async () => {
    const server = createMockServer({ processMs: 0 });
    let auth: AuthState | null = null;
    const api = new BlindajeApi({
      baseUrl: "https://mock.local",
      fetcher: server.fetcher,
      auth: { get: async () => auth, set: async (a) => void (auth = a), clear: async () => void (auth = null) },
      sign: async () => "firma",
    });
    await api.registerDevice({ kty: "EC", crv: "P-256", x: "x", y: "y" }, "android");
    const c = await api.createCase({ consent_mode: "solo_denuncia" });
    const { q, blobs } = setup((i, body) =>
      api.uploadEvidence(c.id, body, { tipo: i.tipo, mime: i.mime, sha256: i.sha256, source: i.source, durationMs: i.duration_ms }),
    );
    const item = await q.add(audio());
    expect((await q.flush()).uploaded).toBe(1);
    expect(await blobs.exists(item.blob)).toBe(false);
    const report = await api.getReport(c.id);
    expect(report.evidencia).toHaveLength(1);
    expect(report.evidencia[0]!.sha256).toBe(item.sha256);
  });
});
