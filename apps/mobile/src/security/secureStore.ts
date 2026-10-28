import * as SecureStore from "expo-secure-store";

/**
 * Envoltorio de expo-secure-store (Android Keystore / iOS Keychain).
 * Solo en este dispositivo y solo con el celular desbloqueado.
 */
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const KEYS = {
  config: "cfg",
  pin: "pin",
  dbKey: "k_db",
  fileKey: "k_files",
  deviceKey: "k_device",
  auth: "auth",
} as const;

export type SecretKeyName = (typeof KEYS)[keyof typeof KEYS];

export const ALL_SECRET_KEYS: SecretKeyName[] = Object.values(KEYS);

export async function getSecret(name: SecretKeyName): Promise<string | null> {
  return SecureStore.getItemAsync(name, OPTS);
}

export function getSecretSync(name: SecretKeyName): string | null {
  return SecureStore.getItem(name, OPTS);
}

export async function setSecret(name: SecretKeyName, value: string): Promise<void> {
  await SecureStore.setItemAsync(name, value, OPTS);
}

export async function deleteSecret(name: SecretKeyName): Promise<void> {
  await SecureStore.deleteItemAsync(name, OPTS);
}

export async function getJson<T>(name: SecretKeyName): Promise<T | null> {
  const v = await getSecret(name);
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export async function setJson(name: SecretKeyName, value: unknown): Promise<void> {
  await setSecret(name, JSON.stringify(value));
}
