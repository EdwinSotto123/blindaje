const mockLogout = jest.fn(async () => undefined);
const mockDeleteDb = jest.fn(async () => undefined);
const mockDeleteQueue = jest.fn();

jest.mock("@/services", () => ({ api: { logout: () => mockLogout() } }));
jest.mock("@/storage/db", () => ({ deletePrivateDb: () => mockDeleteDb() }));
jest.mock("@/storage/queueStorage", () => ({ deleteQueueFiles: () => mockDeleteQueue() }));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { list: () => [] } },
  Directory: class {},
  File: class {},
}));

import * as SecureStore from "expo-secure-store";

import { getDbKey, getFileKey } from "@/security/keys";
import { KEYS, setSecret } from "@/security/secureStore";
import { emergencyWipe } from "@/security/wipe";
import { configStore, DEFAULT_CONFIG } from "@/state/config";
import { sessionStore, unlock } from "@/state/session";

const mem = (SecureStore as unknown as { __mem: Map<string, string> }).__mem;

describe("Borrado de emergencia", () => {
  it("cierra sesión, borra base, archivos y llaves, y deja un cuaderno común", async () => {
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: true, disguise: "lista", sector: "bodega" });
    await setSecret(KEYS.pin, "{}");
    await setSecret(KEYS.auth, "{}");
    await setSecret(KEYS.deviceKey, "ab");
    const k1 = await getDbKey();
    await getFileKey();
    unlock("real");

    await emergencyWipe();

    expect(sessionStore.get().mode).toBe("locked");
    expect(mockLogout).toHaveBeenCalled();
    expect(mockDeleteDb).toHaveBeenCalled();
    expect(mockDeleteQueue).toHaveBeenCalled();
    for (const k of [KEYS.pin, KEYS.auth, KEYS.deviceKey, KEYS.dbKey, KEYS.fileKey]) expect(mem.has(k)).toBe(false);
    // La llave en memoria quedó en ceros y la próxima es otra.
    expect(k1.every((b) => b === 0)).toBe(true);
    const cfg = configStore.get();
    expect(cfg.onboarded).toBe(false);
    expect(cfg.wiped).toBe(true);
    expect(cfg.sector).toBeNull();
    // El disfraz elegido se mantiene: la app sigue viéndose igual.
    expect(cfg.disguise).toBe("lista");
  });

  it("sin conexión igual borra todo", async () => {
    mockLogout.mockRejectedValueOnce(new Error("Sin conexión"));
    await setSecret(KEYS.pin, "{}");
    await emergencyWipe();
    expect(mem.has(KEYS.pin)).toBe(false);
  });
});
