/* Mocks de módulos nativos para jest-expo. */
jest.mock("expo-secure-store", () => {
  const mem = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    getItemAsync: jest.fn(async (k: string) => mem.get(k) ?? null),
    getItem: jest.fn((k: string) => mem.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void mem.set(k, v)),
    setItem: jest.fn((k: string, v: string) => void mem.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void mem.delete(k)),
    __mem: mem,
  };
});

jest.mock("expo-crypto", () => {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return {
    getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
    getRandomValues: <T extends Uint8Array>(a: T) => {
      a.set(randomBytes(a.length));
      return a;
    },
  };
});

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("expo-screen-capture", () => ({
  usePreventScreenCapture: jest.fn(),
  preventScreenCaptureAsync: jest.fn(async () => undefined),
  allowScreenCaptureAsync: jest.fn(async () => undefined),
}));
