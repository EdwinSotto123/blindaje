import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// Claves de prueba (no son secretos reales): 32 bytes en base64url.
const TEST_AES_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const TEST_HMAC_KEY = "HyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("../../infra/migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: "test",
            DEMO_MODE: "true",
            META_BUDGET_USD: "150",
            ML_URL: "",
            JWT_SECRET: "test-jwt-secret-que-no-es-real-0123456789abcdef",
            EVIDENCE_ENCRYPTION_KEY: TEST_AES_KEY,
            HMAC_ALLIANCE_KEY: TEST_HMAC_KEY,
            DEMO_SECRET: "demo-secret-de-prueba",
            TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
            MODEL_API_KEY: "sin-uso-en-tests",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
      testTimeout: 30_000,
    },
  };
});
