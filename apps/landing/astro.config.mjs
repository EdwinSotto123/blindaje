// Landing de Blindaje: Astro estático servido por Workers Static Assets (ver wrangler.jsonc).
// Variables de build:
//   SITE_URL         URL pública de la landing (canónicas, hreflang y sitemap).
//   PUBLIC_API_URL   Base de la API (el formulario hace POST a {PUBLIC_API_URL}/v1/public/pilot-requests).
//   PUBLIC_TURNSTILE_SITEKEY  Sitekey de Turnstile (por defecto, la de prueba que siempre pasa).
import { defineConfig, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.SITE_URL ?? "https://blindaje-landing.workers.dev";

// Fuentes autoalojadas desde los paquetes @fontsource instalados (OFL). Se usa el proveedor `local`
// con las rutas de los archivos: el proveedor `npm` de Astro 7.4 falla en Windows al leer file://.
const fontsource = (pkg, file, weights) =>
  weights.map((weight) => ({
    weight,
    style: "normal",
    src: [`./node_modules/@fontsource/${pkg}/files/${file}-latin-${weight}-normal.woff2`],
  }));

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "ignore",
  build: { inlineStylesheets: "always", format: "directory" },
  i18n: {
    defaultLocale: "es",
    locales: ["es", "en"],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: "es", locales: { es: "es-PE", en: "en" } },
      filter: (page) => !page.includes("/404"),
    }),
  ],
  fonts: [
    {
      name: "Atkinson Hyperlegible",
      cssVariable: "--font-atkinson",
      provider: fontProviders.local(),
      options: { variants: fontsource("atkinson-hyperlegible", "atkinson-hyperlegible", [400, 700]) },
      fallbacks: ["sans-serif"],
      display: "swap",
    },
    {
      name: "Kalam",
      cssVariable: "--font-kalam",
      provider: fontProviders.local(),
      options: { variants: fontsource("kalam", "kalam", [400, 700]) },
      // Fallback métrico sobre una sans del sistema: evita el salto de diseño al cambiar de fuente.
      fallbacks: ["sans-serif"],
      display: "swap",
    },
  ],
  vite: {
    // eval/report.json y docs/screenshots viven fuera de apps/landing.
    server: { fs: { allow: ["../.."] } },
  },
});
