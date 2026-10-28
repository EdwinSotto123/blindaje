import type { ConsentMode, Sector } from "@/shared";
import { getSecretSync, KEYS, setJson } from "@/security/secureStore";
import { createStore, useStore } from "@/state/store";

/**
 * Configuración de la app. Vive en el almacenamiento seguro del sistema (no en archivos
 * legibles), porque incluye cuál es la entrada secreta.
 */
export type DisguiseKind = "cuaderno" | "lista" | "vueltos";

export const DEFAULT_SECRET_CENTS = 1818;

export type AppConfig = {
  v: 1;
  /** Terminó el onboarding privado. */
  onboarded: boolean;
  /** Hubo un borrado de emergencia: no se vuelve a mostrar el onboarding al abrir. */
  wiped: boolean;
  disguise: DisguiseKind;
  /** Entrada secreta 1: mantener presionado el título 2 segundos. */
  holdTitle: boolean;
  /** Entrada secreta 2: anotar una venta con este monto (en céntimos). null = apagada. */
  secretAmountCents: number | null;
  sector: Sector | null;
  zona: string | null;
  /** Consentimiento con el que se crean los casos. Siempre arranca en "solo_denuncia". */
  consent: ConsentMode;
};

export const DEFAULT_CONFIG: AppConfig = {
  v: 1,
  onboarded: false,
  wiped: false,
  disguise: "cuaderno",
  holdTitle: true,
  secretAmountCents: DEFAULT_SECRET_CENTS,
  sector: null,
  zona: null,
  consent: "solo_denuncia",
};

function load(): AppConfig {
  try {
    const raw = getSecretSync(KEYS.config);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export const configStore = createStore<AppConfig>(DEFAULT_CONFIG);
let loaded = false;

export function loadConfig(): AppConfig {
  if (!loaded) {
    configStore.reset(load());
    loaded = true;
  }
  return configStore.get();
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  configStore.set(patch);
  await setJson(KEYS.config, configStore.get());
  return configStore.get();
}

export function useConfig<T>(selector: (c: AppConfig) => T): T {
  return useStore(configStore, selector);
}
