import { defineConfig } from "vitest/config";

/**
 * Tests contra la Meta Model API real. Cuestan dinero (menos de 0.05 USD por corrida completa):
 * se corren a mano con `pnpm --filter @blindaje/meta-client test:live`.
 */
export default defineConfig({
  test: {
    include: ["test/live/**/*.live.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
