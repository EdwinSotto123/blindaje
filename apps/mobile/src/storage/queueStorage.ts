import { Directory, File, Paths } from "expo-file-system";

import { privateDb } from "@/storage/db";
import type { BlobStore, QueueItem, QueueRepo } from "@/sync/queue";

/** Archivos cifrados de la cola: sandbox privado de la app (no galería, no archivos recientes). */
export const QUEUE_DIR = "cola";

function dir(): Directory {
  const d = new Directory(Paths.document, QUEUE_DIR);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export class FileBlobStore implements BlobStore {
  async write(name: string, data: Uint8Array) {
    const f = new File(dir(), name);
    if (f.exists) f.delete();
    f.create();
    f.write(data);
  }
  async read(name: string) {
    return new File(dir(), name).bytes();
  }
  async remove(name: string) {
    const f = new File(dir(), name);
    if (f.exists) f.delete();
  }
  async exists(name: string) {
    return new File(dir(), name).exists;
  }
}

/** Borra todos los archivos de la cola (borrado de emergencia). */
export function deleteQueueFiles(): void {
  const d = new Directory(Paths.document, QUEUE_DIR);
  if (d.exists) d.delete();
}

const COLS =
  "id, tipo, mime, source, captured_at, duration_ms, size, sha256, blob, status, attempts, next_at, last_error, evidence_id, label, preview, created_at";

export class SqliteQueueRepo implements QueueRepo {
  async insert(i: QueueItem) {
    const db = await privateDb();
    await db.runAsync(
      `INSERT INTO cola (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.id,
      i.tipo,
      i.mime,
      i.source,
      i.captured_at,
      i.duration_ms,
      i.size,
      i.sha256,
      i.blob,
      i.status,
      i.attempts,
      i.next_at,
      i.last_error,
      i.evidence_id,
      i.label,
      i.preview,
      i.created_at,
    );
  }
  async all() {
    const db = await privateDb();
    return db.getAllAsync<QueueItem>(`SELECT ${COLS} FROM cola ORDER BY created_at ASC`);
  }
  async get(id: string) {
    const db = await privateDb();
    return db.getFirstAsync<QueueItem>(`SELECT ${COLS} FROM cola WHERE id = ?`, id);
  }
  async update(id: string, patch: Partial<QueueItem>) {
    const keys = Object.keys(patch).filter((k) => COLS.includes(k)) as (keyof QueueItem)[];
    if (!keys.length) return;
    const db = await privateDb();
    const values = keys.map((k) => patch[k] ?? null) as (string | number | null)[];
    await db.runAsync(`UPDATE cola SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...values, id);
  }
  async remove(id: string) {
    const db = await privateDb();
    await db.runAsync("DELETE FROM cola WHERE id = ?", id);
  }
}
