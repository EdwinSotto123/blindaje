import { File } from "expo-file-system";

import { ApiError, isNetworkError } from "@/api/http";
import { api, currentCaseId, isOnline, queue } from "@/services";
import type { EvidenceType, VictimAlert, VictimReport } from "@/shared";
import { configStore } from "@/state/config";
import { isDecoy, onLock } from "@/state/session";
import { createStore, useStore } from "@/state/store";
import { privateDb } from "@/storage/db";
import type { QueueItem, QueueSource } from "@/sync/queue";

/**
 * Datos de las notas privadas EN MEMORIA. El reporte del servidor (transcripciones, hallazgos)
 * no se guarda en el celular: se pide al desbloquear y se olvida al bloquear.
 */
export type DecoyItem = { id: number; tipo: EvidenceType; preview: string | null; duration_ms: number | null; created_at: number };

type PrivateState = {
  report: VictimReport | null;
  reportState: "idle" | "loading" | "ok" | "offline" | "error";
  queue: QueueItem[];
  online: boolean;
  alerts: VictimAlert[] | null;
  alertsState: "idle" | "loading" | "ok" | "offline" | "error";
  decoy: DecoyItem[];
};

const INITIAL: PrivateState = {
  report: null,
  reportState: "idle",
  queue: [],
  online: true,
  alerts: null,
  alertsState: "idle",
  decoy: [],
};

export const privateStore = createStore<PrivateState>(INITIAL);

export function usePrivate<T>(sel: (s: PrivateState) => T): T {
  return useStore(privateStore, sel);
}

onLock(() => privateStore.reset({ ...INITIAL, queue: privateStore.get().queue }));

queue.subscribe(() => {
  void refreshQueue();
});

export async function refreshQueue(): Promise<void> {
  try {
    privateStore.set({ queue: await queue.list() });
  } catch {
    // base todavía no disponible
  }
}

export async function refreshOnline(): Promise<boolean> {
  const online = await isOnline();
  privateStore.set({ online });
  return online;
}

export async function refreshReport(): Promise<void> {
  if (isDecoy()) return;
  const caseId = await currentCaseId();
  if (!caseId) {
    privateStore.set({ report: null, reportState: "ok" });
    return;
  }
  privateStore.set({ reportState: privateStore.get().report ? "ok" : "loading" });
  try {
    const report = await api.getReport(caseId);
    privateStore.set({ report, reportState: "ok", online: true });
    await queue.forgetUploaded(new Set(report.evidencia.map((e) => e.id)));
  } catch (e) {
    privateStore.set({ reportState: isNetworkError(e) ? "offline" : "error", online: !isNetworkError(e) });
  }
}

/** Sube lo pendiente y actualiza el reporte. Se llama al capturar, al volver la conexión y cada cierto tiempo. */
let syncing: Promise<void> | null = null;
export function syncNow(force = false): Promise<void> {
  if (!syncing) {
    syncing = (async () => {
      if (!configStore.get().onboarded) return;
      const online = await refreshOnline();
      if (online) await queue.flush(force);
      await refreshQueue();
      if (online && !isDecoy() && privateStore.get().report !== null) await refreshReport();
    })()
      .catch(() => undefined)
      .finally(() => {
        syncing = null;
      });
  }
  return syncing;
}

export async function refreshAlerts(): Promise<void> {
  if (isDecoy()) {
    privateStore.set({ alerts: [], alertsState: "ok" });
    return;
  }
  privateStore.set({ alertsState: "loading" });
  try {
    privateStore.set({ alerts: await api.alerts(), alertsState: "ok" });
  } catch (e) {
    privateStore.set({ alertsState: isNetworkError(e) ? "offline" : "error" });
  }
}

// ---------------------------------------------------------------------------
// Captura
// ---------------------------------------------------------------------------

export type CaptureInput = {
  tipo: EvidenceType;
  mime: string;
  source: QueueSource;
  durationMs?: number | null;
  capturedAt?: string | null;
  preview?: string | null;
  hold?: boolean;
};

/**
 * Guarda una captura: la cifra en la cola y borra el original en claro. En modo señuelo solo
 * anota que existe (para que las notas se vean creíbles) y descarta el contenido.
 */
export async function saveBytes(bytes: Uint8Array, input: CaptureInput): Promise<QueueItem | null> {
  if (isDecoy() && !input.hold) {
    await addDecoy(input.tipo, input.preview ?? null, input.durationMs ?? null);
    return null;
  }
  const item = await queue.add({
    bytes,
    tipo: input.tipo,
    mime: input.mime,
    source: input.source,
    capturedAt: input.capturedAt,
    durationMs: input.durationMs,
    preview: input.preview,
    hold: input.hold,
  });
  await refreshQueue();
  if (!input.hold) void syncNow();
  return item;
}

export async function saveFile(uri: string, input: CaptureInput): Promise<QueueItem | null> {
  const f = new File(uri);
  try {
    const bytes = await f.bytes();
    return await saveBytes(bytes, input);
  } finally {
    try {
      if (f.exists) f.delete();
    } catch {
      // ya no existía
    }
  }
}

export function deleteFileQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // nada
  }
}

// ---------------------------------------------------------------------------
// Señuelo
// ---------------------------------------------------------------------------

export async function loadDecoy(): Promise<void> {
  const db = await privateDb();
  privateStore.set({ decoy: await db.getAllAsync<DecoyItem>("SELECT * FROM senuelo ORDER BY created_at DESC") });
}

async function addDecoy(tipo: EvidenceType, preview: string | null, durationMs: number | null): Promise<void> {
  const db = await privateDb();
  await db.runAsync("INSERT INTO senuelo (tipo, preview, duration_ms, created_at) VALUES (?, ?, ?, ?)", tipo, preview, durationMs, Date.now());
  await loadDecoy();
}

export function errorMessage(e: unknown): string {
  if (isNetworkError(e)) return "Sin conexión. Inténtalo cuando tengas internet.";
  if (e instanceof ApiError) {
    if (e.status === 404) return "No encontramos ese código. Revísalo con tu asociación.";
    if (e.status === 429) return "Demasiados intentos. Espera un momento.";
    if (e.status === 401) return "Tu sesión venció. Vuelve a intentarlo.";
  }
  return "Algo salió mal. Inténtalo de nuevo.";
}
