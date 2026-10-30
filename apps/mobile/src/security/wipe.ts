import { Directory, File, Paths } from "expo-file-system";

import { cuadernoNativo } from "@/native/cuaderno";
import { api } from "@/services";
import { forgetKeys } from "@/security/keys";
import { ALL_SECRET_KEYS, deleteSecret, KEYS } from "@/security/secureStore";
import { updateConfig } from "@/state/config";
import { lock } from "@/state/session";
import { deletePrivateDb } from "@/storage/db";
import { deleteQueueFiles } from "@/storage/queueStorage";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((r) => {
    t = setTimeout(() => r(undefined), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
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

/** Borra los PDF temporales de la denuncia que quedaron en la caché. */
export function cleanupTempFiles(): void {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && /^denuncia-.*\.pdf$/.test(entry.name)) entry.delete();
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
 * 4. apaga el filtro de llamadas y borra las llamadas anotadas, los números marcados y su llave,
 * 5. deja la app como un cuaderno común: no vuelve a mostrar la configuración al abrir.
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
  try {
    cuadernoNativo()?.borrarTodo();
  } catch {
    // sin módulo nativo
  }
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
