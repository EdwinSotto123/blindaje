import { ApiError, isNetworkError } from "@/api/http";
import { utf8 } from "@/lib/bytes";
import { open, seal } from "@/security/aead";
import { sha256Hex } from "@/security/hash";
import type { EvidenceItem, EvidenceType } from "@/shared";

/**
 * Cola de evidencia (decisión D1: todo vive en la nube).
 *
 * 1. Al capturar, el archivo se cifra con AES-256-GCM (llave en el almacenamiento seguro) y se
 *    guarda en el sandbox de la app; el original en claro se borra de inmediato.
 * 2. `flush()` lo descifra en memoria, lo sube y compara el SHA-256 que confirma el servidor.
 * 3. Si coincide, se borra el archivo cifrado del celular. Si no hay conexión, queda en la cola
 *    y se reintenta con espera creciente.
 *
 * Los archivos compartidos desde otra app entran como "retenido" y no se suben hasta que la
 * persona los acepte con el PIN.
 */
export type QueueStatus = "retenido" | "pendiente" | "subiendo" | "subido" | "error";
export type QueueSource = "grabacion" | "compartido" | "camara" | "galeria" | "pegado" | "llamada";

export type QueueItem = {
  id: string;
  tipo: EvidenceType;
  mime: string;
  source: QueueSource;
  captured_at: string | null;
  duration_ms: number | null;
  size: number;
  sha256: string;
  blob: string;
  status: QueueStatus;
  attempts: number;
  next_at: number;
  last_error: string | null;
  evidence_id: string | null;
  label: string | null;
  preview: string | null;
  created_at: number;
};

export interface QueueRepo {
  insert(item: QueueItem): Promise<void>;
  all(): Promise<QueueItem[]>;
  get(id: string): Promise<QueueItem | null>;
  update(id: string, patch: Partial<QueueItem>): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface BlobStore {
  write(name: string, data: Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array>;
  remove(name: string): Promise<void>;
  exists(name: string): Promise<boolean>;
}

export interface EvidenceUploader {
  upload(item: QueueItem, body: Uint8Array): Promise<EvidenceItem>;
}

export type NewEvidence = {
  bytes: Uint8Array;
  tipo: EvidenceType;
  mime: string;
  source: QueueSource;
  capturedAt?: string | null;
  durationMs?: number | null;
  preview?: string | null;
  /** true: queda retenido hasta que la persona lo acepte. */
  hold?: boolean;
};

export type FlushResult = { uploaded: number; pending: number; failed: number };

type Deps = {
  repo: QueueRepo;
  blobs: BlobStore;
  key: () => Promise<Uint8Array>;
  uploader: EvidenceUploader;
  now?: () => number;
  newId?: () => string;
};

/** Espera entre reintentos: 5 s, 15 s, 45 s… hasta 10 minutos. */
export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 3 ** Math.max(0, attempts - 1), 600_000);
}

let idSeq = 0;
function defaultId(): string {
  idSeq += 1;
  return `q${Date.now().toString(36)}${idSeq.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export class EvidenceQueue {
  private running: Promise<FlushResult> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly d: Deps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Cifra y guarda. El llamador debe borrar el archivo original en claro. */
  async add(input: NewEvidence): Promise<QueueItem> {
    const id = (this.d.newId ?? defaultId)();
    const sha256 = sha256Hex(input.bytes);
    const key = await this.d.key();
    const blob = `${id}.bin`;
    await this.d.blobs.write(blob, seal(key, input.bytes, utf8(id)));
    const item: QueueItem = {
      id,
      tipo: input.tipo,
      mime: input.mime,
      source: input.source,
      captured_at: input.capturedAt ?? new Date(this.now()).toISOString(),
      duration_ms: input.durationMs ?? null,
      size: input.bytes.length,
      sha256,
      blob,
      status: input.hold ? "retenido" : "pendiente",
      attempts: 0,
      next_at: 0,
      last_error: null,
      evidence_id: null,
      label: null,
      preview: input.preview ?? null,
      created_at: this.now(),
    };
    await this.d.repo.insert(item);
    this.emit();
    return item;
  }

  async list(): Promise<QueueItem[]> {
    return this.d.repo.all();
  }

  /** Acepta un archivo retenido (compartido desde otra app) para subirlo. */
  async release(id: string): Promise<void> {
    await this.d.repo.update(id, { status: "pendiente", next_at: 0 });
    this.emit();
  }

  /** Descarta un elemento que no se subió: borra el archivo cifrado y la fila. */
  async discard(id: string): Promise<void> {
    const item = await this.d.repo.get(id);
    if (item) await this.d.blobs.remove(item.blob).catch(() => undefined);
    await this.d.repo.remove(id);
    this.emit();
  }

  /** Quita las filas ya confirmadas que el reporte del servidor ya incluye. */
  async forgetUploaded(serverIds: Set<string>): Promise<void> {
    for (const it of await this.d.repo.all()) {
      if (it.status === "subido" && it.evidence_id && serverIds.has(it.evidence_id)) await this.d.repo.remove(it.id);
    }
  }

  /** Lee y descifra (para revisar un pendiente antes de aceptarlo). */
  async readPlain(id: string): Promise<Uint8Array | null> {
    const item = await this.d.repo.get(id);
    if (!item) return null;
    return open(await this.d.key(), await this.d.blobs.read(item.blob), utf8(item.id));
  }

  /** Sube lo pendiente. Una sola ejecución a la vez. */
  flush(force = false): Promise<FlushResult> {
    if (!this.running) {
      this.running = this.doFlush(force).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async doFlush(force: boolean): Promise<FlushResult> {
    const res: FlushResult = { uploaded: 0, pending: 0, failed: 0 };
    const items = (await this.d.repo.all()).filter((i) => i.status === "pendiente" || i.status === "subiendo" || (force && i.status === "error"));
    let offline = false;
    for (const item of items) {
      if (offline || (!force && item.next_at > this.now())) {
        res.pending += 1;
        continue;
      }
      await this.d.repo.update(item.id, { status: "subiendo" });
      this.emit();
      try {
        const key = await this.d.key();
        const plain = open(key, await this.d.blobs.read(item.blob), utf8(item.id));
        if (sha256Hex(plain) !== item.sha256) throw new Error("La copia local no coincide con su huella");
        const ev = await this.d.uploader.upload(item, plain);
        if (ev.sha256 !== item.sha256) {
          // El servidor guardó algo distinto: no se borra nada del celular.
          await this.d.repo.update(item.id, { status: "error", last_error: "integrity_mismatch", attempts: item.attempts + 1 });
          res.failed += 1;
        } else {
          // Confirmado: el celular ya no guarda la evidencia.
          await this.d.blobs.remove(item.blob);
          await this.d.repo.update(item.id, { status: "subido", evidence_id: ev.id, label: ev.label, last_error: null, preview: null });
          res.uploaded += 1;
        }
      } catch (e) {
        const attempts = item.attempts + 1;
        if (isNetworkError(e) || (e instanceof ApiError && (e.status >= 500 || e.status === 429 || e.status === 401))) {
          offline = isNetworkError(e);
          await this.d.repo.update(item.id, {
            status: "pendiente",
            attempts,
            next_at: this.now() + backoffMs(attempts),
            last_error: e instanceof Error ? e.message : "error",
          });
          res.pending += 1;
        } else {
          await this.d.repo.update(item.id, {
            status: "error",
            attempts,
            last_error: e instanceof ApiError ? e.code : e instanceof Error ? e.message : "error",
          });
          res.failed += 1;
        }
      }
      this.emit();
    }
    return res;
  }
}

// ---------------------------------------------------------------------------
// Implementaciones en memoria (tests y modo señuelo)
// ---------------------------------------------------------------------------

export class MemoryQueueRepo implements QueueRepo {
  rows = new Map<string, QueueItem>();
  async insert(item: QueueItem) {
    this.rows.set(item.id, { ...item });
  }
  async all() {
    return Array.from(this.rows.values()).sort((a, b) => a.created_at - b.created_at);
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async update(id: string, patch: Partial<QueueItem>) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...patch });
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
}

export class MemoryBlobStore implements BlobStore {
  files = new Map<string, Uint8Array>();
  async write(name: string, data: Uint8Array) {
    this.files.set(name, data);
  }
  async read(name: string) {
    const f = this.files.get(name);
    if (!f) throw new Error(`No existe ${name}`);
    return f;
  }
  async remove(name: string) {
    this.files.delete(name);
  }
  async exists(name: string) {
    return this.files.has(name);
  }
}
