import { checkPin, createPinRecord, isValidPin, type PinRecord } from "@/security/pin";
import { getJson, KEYS, setJson } from "@/security/secureStore";
import { configStore } from "@/state/config";

/**
 * Resultado de probar unos dígitos en la calculadora:
 * - real / decoy: abre las notas privadas (verdaderas o señuelo).
 * - onboarding: la app todavía no está configurada (o se borró): abre la configuración.
 * - null: no pasa nada visible.
 */
export type AccessResult = "real" | "decoy" | "onboarding" | null;

export async function tryAccess(digits: string): Promise<AccessResult> {
  if (!isValidPin(digits)) return null;
  if (!configStore.get().onboarded) return "onboarding";
  const rec = await getJson<PinRecord>(KEYS.pin);
  return checkPin(rec, digits);
}

export async function savePins(real: string, decoy: string | null): Promise<void> {
  await setJson(KEYS.pin, await createPinRecord(real, decoy));
}

export async function hasDecoyPin(): Promise<boolean> {
  const rec = await getJson<PinRecord>(KEYS.pin);
  return !!rec?.decoy;
}

/** Cambia el PIN o el señuelo verificando primero el PIN actual. */
export async function changePins(current: string, real: string, decoy: string | null): Promise<boolean> {
  const rec = await getJson<PinRecord>(KEYS.pin);
  if ((await checkPin(rec, current)) !== "real") return false;
  await savePins(real, decoy);
  return true;
}
