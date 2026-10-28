import type { ConsentMode, Sector } from "@/shared";
import { DEFAULT_SECRET_CENTS, type DisguiseKind, updateConfig } from "@/state/config";
import { savePins } from "@/security/access";
import { createStore, useStore } from "@/state/store";

/** Borrador del onboarding, solo en memoria hasta el último paso. */
type Draft = {
  registered: boolean;
  pseudonym: string | null;
  orgName: string | null;
  pin: string | null;
  decoy: string | null;
  disguise: DisguiseKind;
  secretAmountCents: number | null;
  holdTitle: boolean;
  voiceDone: boolean;
  sector: Sector | null;
  zona: string;
  consent: ConsentMode;
};

const INITIAL: Draft = {
  registered: false,
  pseudonym: null,
  orgName: null,
  pin: null,
  decoy: null,
  disguise: "cuaderno",
  secretAmountCents: DEFAULT_SECRET_CENTS,
  holdTitle: true,
  voiceDone: false,
  sector: null,
  zona: "",
  consent: "solo_denuncia",
};

export const draftStore = createStore<Draft>(INITIAL);

export function useDraft<T>(sel: (d: Draft) => T): T {
  return useStore(draftStore, sel);
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
    zona: d.zona.trim() || null,
    consent: d.consent,
  });
  draftStore.reset(INITIAL);
}
