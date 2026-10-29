import { fetch as expoFetch } from "expo/fetch";
import * as Network from "expo-network";
import { Platform } from "react-native";

import { type AuthState, type AuthStore, BlindajeApi, caseRequestFrom, type DevicePlatform } from "@/api/client";
import type { Fetcher, HttpResponse } from "@/api/http";
import { ApiError } from "@/api/http";
import { createMockServer } from "@/api/mock";
import { API_URL, MOCK_API } from "@/config";
import { getOrCreateDeviceKey, signRefresh } from "@/security/device";
import { getFileKey } from "@/security/keys";
import { deleteSecret, getJson, KEYS, setJson } from "@/security/secureStore";
import { configStore } from "@/state/config";
import { getMeta, setMeta } from "@/storage/db";
import { FileBlobStore, SqliteQueueRepo } from "@/storage/queueStorage";
import { EvidenceQueue, type EvidenceUploader, type QueueItem } from "@/sync/queue";

/** Fetch real (expo/fetch: cuerpos binarios y respuestas en bytes). */
const realFetcher: Fetcher = async (url, req) => {
  const res = await expoFetch(url, { method: req.method, headers: req.headers, body: req.body as never });
  return {
    status: res.status,
    ok: res.ok,
    header: (n) => res.headers.get(n),
    json: () => res.json() as Promise<unknown>,
    text: () => res.text(),
    bytes: async () => new Uint8Array(await res.arrayBuffer()),
  } satisfies HttpResponse;
};

export async function isOnline(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return !!s.isConnected && s.isInternetReachable !== false;
  } catch {
    return true;
  }
}

const secureAuthStore: AuthStore = {
  get: () => getJson<AuthState>(KEYS.auth),
  set: (a) => setJson(KEYS.auth, a),
  clear: () => deleteSecret(KEYS.auth),
};

const mock = MOCK_API ? createMockServer({ isOnline, latencyMs: 350 }) : null;

export const platform: DevicePlatform = Platform.OS === "ios" ? "ios" : Platform.OS === "web" ? "web" : "android";

/**
 * Cliente de la API. Sin código de invitación: si este celular todavía no tiene sesión (por ejemplo,
 * "Empezar" no tuvo internet), la primera llamada con la configuración terminada (la primera subida,
 * los avisos) lo registra con su llave P-256. Durante la configuración se registra a propósito
 * ("Empezar" y la muestra de voz); después de un borrado de emergencia, no.
 */
export const api = new BlindajeApi({
  baseUrl: MOCK_API ? "https://mock.local" : API_URL,
  fetcher: mock ? mock.fetcher : realFetcher,
  auth: secureAuthStore,
  sign: async (deviceId, ts) => {
    const { secret } = await getOrCreateDeviceKey();
    return signRefresh(secret, deviceId, ts);
  },
  device: async () => ({ publicKey: (await getOrCreateDeviceKey()).jwk, platform }),
  autoRegister: () => configStore.get().onboarded,
});

export const authStore = secureAuthStore;

// ---------------------------------------------------------------------------
// Caso activo
// ---------------------------------------------------------------------------

const CASE_KEY = "case_id";

export async function currentCaseId(): Promise<string | null> {
  return getMeta(CASE_KEY);
}

/**
 * Devuelve el caso activo o crea uno nuevo con el consentimiento elegido (por defecto, solo mi
 * denuncia), el rubro y el id del distrito. Cambiar el distrito en Ajustes vale para los casos nuevos.
 */
export async function ensureCase(): Promise<string> {
  const id = await getMeta(CASE_KEY);
  if (id) return id;
  const c = await api.createCase(caseRequestFrom(configStore.get()));
  await setMeta(CASE_KEY, c.id);
  return c.id;
}

export async function forgetCase(): Promise<void> {
  await setMeta(CASE_KEY, null);
}

const uploader: EvidenceUploader = {
  async upload(item: QueueItem, body: Uint8Array) {
    const send = async (caseId: string) =>
      api.uploadEvidence(caseId, body, {
        tipo: item.tipo,
        mime: item.mime,
        sha256: item.sha256,
        capturedAt: item.captured_at,
        source: item.source,
        durationMs: item.duration_ms,
      });
    const caseId = await ensureCase();
    try {
      return await send(caseId);
    } catch (e) {
      // El caso ya no existe o ya no acepta evidencia: se abre uno nuevo y se reintenta una vez.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        await forgetCase();
        return send(await ensureCase());
      }
      throw e;
    }
  },
};

export const queue = new EvidenceQueue({
  repo: new SqliteQueueRepo(),
  blobs: new FileBlobStore(),
  key: getFileKey,
  uploader,
});
