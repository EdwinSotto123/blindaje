import { Directory, File, Paths } from "expo-file-system";

import { api } from "@/services";
import { forgetKeys } from "@/security/keys";
import { ALL_SECRET_KEYS, deleteSecret, KEYS } from "@/security/secureStore";
import { updateConfig } from "@/state/config";
import { lock } from "@/state/session";
import { deletePrivateDb } from "@/storage/db";
import { deleteQueueFiles } from "@/storage/queueStorage";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

/** Borra todo lo que hay en la caché de la app (grabaciones, fotos, archivos compartidos, PDF). */
export function clearCache(): void {
  try {
    for (const entry of Paths.cache.list()) {
      try {
        if (entry instanceof Directory || entry instanceof File) entry.delete();
      } catch {
        // archivo en uso: se ignora
      }
    }
  } catch {
    // sin caché
  }
}

/**
 * Borrado de emergencia:
 * 1. cierra la sesión en el servidor (si hay conexión, con tiempo límite),
 * 2. borra la base cifrada, la cola de archivos y la caché,
 * 3. borra todas las llaves del almacenamiento seguro (PIN, base, archivos, dispositivo, sesión),
 * 4. deja la app como un cuaderno común: no vuelve a mostrar la configuración al abrir.
 * Lo que ya se subió sigue a salvo en la nube.
 */
export async function emergencyWipe(): Promise<void> {
  lock();
  try {
    await withTimeout(api.logout(), 4000);
  } catch {
    // sin conexión: el refresh token vence solo y la llave del dispositivo se borra igual
  }
  await deletePrivateDb();
  try {
    deleteQueueFiles();
  } catch {
    // nada que borrar
  }
  clearCache();
  for (const k of ALL_SECRET_KEYS) {
    if (k === KEYS.config) continue;
    try {
      await deleteSecret(k);
    } catch {
      // ya no existía
    }
  }
  forgetKeys();
  await updateConfig({ onboarded: false, wiped: true, sector: null, zona: null, consent: "solo_denuncia" });
}
