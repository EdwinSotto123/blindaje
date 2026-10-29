import { savePins } from "@/security/access";
import { api } from "@/services";
import type { ConsentMode, Sector } from "@/shared";
import { DEFAULT_SECRET_CENTS, type DisguiseKind, updateConfig } from "@/state/config";
import { createStore, useStore } from "@/state/store";

/** Borrador del onboarding, solo en memoria hasta el último paso. */
type Draft = {
  registered: boolean;
  pseudonym: string | null;
  pin: string | null;
  decoy: string | null;
  disguise: DisguiseKind;
  secretAmountCents: number | null;
  holdTitle: boolean;
  voiceDone: boolean;
  sector: Sector | null;
  /** Id del distrito (DISTRICTS) o null: sin elegir o "Prefiero no decirlo". */
  zona: string | null;
  consent: ConsentMode;
};

const INITIAL: Draft = {
  registered: false,
  pseudonym: null,
  pin: null,
  decoy: null,
  disguise: "cuaderno",
  secretAmountCents: DEFAULT_SECRET_CENTS,
  holdTitle: true,
  voiceDone: false,
  sector: null,
  zona: null,
  consent: "solo_denuncia",
};

export const draftStore = createStore<Draft>(INITIAL);

export function useDraft<T>(sel: (d: Draft) => T): T {
  return useStore(draftStore, sel);
}

/** Tiempo máximo que "Empezar" espera al registro antes de seguir sin él. */
export const REGISTER_WAIT_MS = 8000;

/**
 * Registra este celular sin código: la víctima reporta directo al equipo central. Nunca detiene la
 * configuración: sin internet (o si tarda más de `ms`) sigue igual, y el registro se vuelve a
 * intentar solo en la muestra de voz o en la primera subida. Devuelve si quedó registrado.
 */
export async function registerQuietly(ms = REGISTER_WAIT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), ms);
  });
  try {
    const auth = await Promise.race([api.ensureRegistered(), timeout]);
    if (auth) draftStore.set({ registered: true, pseudonym: auth.pseudonym });
    return !!auth;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Último paso: guarda el PIN (hash en el almacenamiento seguro) y la configuración. */
export async function finishOnboarding(): Promise<void> {
  const d = draftStore.get();
  if (!d.pin) throw new Error("Falta el PIN");
  await savePins(d.pin, d.decoy);
  await updateConfig({
    onboarded: true,
    wiped: false,
    disguise: d.disguise,
    holdTitle: d.holdTitle,
    secretAmountCents: d.secretAmountCents,
    sector: d.sector,
    zona: d.zona,
    consent: d.consent,
  });
  draftStore.reset(INITIAL);
}
