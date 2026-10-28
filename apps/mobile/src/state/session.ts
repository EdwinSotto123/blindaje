import { createStore, useStore } from "@/state/store";

/**
 * Sesión de las notas privadas.
 * - locked: solo se ve el disfraz.
 * - real: se ingresó el PIN.
 * - decoy: se ingresó el PIN señuelo (notas vacías y creíbles; nada se sube).
 */
export type SessionMode = "locked" | "real" | "decoy";

type SessionState = {
  mode: SessionMode;
  /** Hasta cuándo un paso a segundo plano es esperado (selector de fotos, compartir). */
  externalUntil: number;
};

export const sessionStore = createStore<SessionState>({ mode: "locked", externalUntil: 0 });

const lockListeners = new Set<() => void>();

/** Se llama al bloquear: limpia datos en memoria (reportes, borradores). */
export function onLock(fn: () => void): () => void {
  lockListeners.add(fn);
  return () => lockListeners.delete(fn);
}

export function lock(): void {
  const was = sessionStore.get().mode;
  sessionStore.set({ mode: "locked", externalUntil: 0 });
  if (was !== "locked") lockListeners.forEach((l) => l());
}

export function unlock(mode: Exclude<SessionMode, "locked">): void {
  sessionStore.set({ mode });
}

export function isUnlocked(): boolean {
  return sessionStore.get().mode !== "locked";
}

export function isDecoy(): boolean {
  return sessionStore.get().mode === "decoy";
}

/**
 * Marca que la app va a abrir algo del sistema (selector de fotos, hoja de compartir) y que el
 * paso a segundo plano que viene no debe bloquear. Vence solo.
 */
export function expectExternal(ms = 120_000): void {
  sessionStore.set({ externalUntil: Date.now() + ms });
}

export function endExternal(): void {
  sessionStore.set({ externalUntil: 0 });
}

/** Decide si un paso a segundo plano debe bloquear. */
export function shouldLockOnBackground(now = Date.now()): boolean {
  const s = sessionStore.get();
  return s.mode !== "locked" && now > s.externalUntil;
}

export function useSessionMode(): SessionMode {
  return useStore(sessionStore, (s) => s.mode);
}
