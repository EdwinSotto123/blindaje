/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Emite `_headers` para Workers Static Assets con una CSP que permite conectarse solo a la API
 * configurada en VITE_API_URL (o a ninguna, en modo simulado).
 */
function securityHeaders(apiUrl: string | undefined): Plugin {
  let apiOrigin = "";
  if (apiUrl) {
    try {
      apiOrigin = new URL(apiUrl).origin;
    } catch {
      apiOrigin = "";
    }
  }
  const csp = [
    "default-src 'self'",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
    "img-src 'self' data:",
    "media-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  return {
    name: "blindaje-security-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: [
          "/*",
          `  Content-Security-Policy: ${csp}`,
          "  X-Frame-Options: DENY",
          "  X-Content-Type-Options: nosniff",
          "  Referrer-Policy: no-referrer",
          "  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()",
          "",
        ].join("\n"),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), securityHeaders(env.VITE_API_URL)],
    server: { port: 5175 },
    preview: { port: 4175 },
    build: { sourcemap: false, chunkSizeWarningLimit: 600 },
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
