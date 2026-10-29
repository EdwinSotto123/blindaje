// Landing de Blindaje: Astro estático servido por Workers Static Assets (ver wrangler.jsonc).
// Variables de build:
//   SITE_URL         URL pública de la landing (canónicas, hreflang y sitemap).
//   PUBLIC_API_URL   Base de la API (el formulario hace POST a {PUBLIC_API_URL}/v1/public/pilot-requests).
//   PUBLIC_TURNSTILE_SITEKEY  Sitekey de Turnstile (por defecto, la de prueba que siempre pasa).
import { defineConfig, envField, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.SITE_URL ?? "https://blindaje-landing.vigiaperu.workers.dev";

// Fuentes autoalojadas desde los paquetes @fontsource instalados (OFL). Se usa el proveedor `local`
// con las rutas de los archivos: el proveedor `npm` de Astro 7.4 falla en Windows al leer file://.
const fontsource = (pkg, variants) =>
  variants.map(([weight, style]) => ({
    weight,
    style,
    src: [`./node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-${style}.woff2`],
  }));

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "ignore",
  build: { inlineStylesheets: "always", format: "directory" },
  env: {
    schema: {
      PUBLIC_API_URL: envField.string({
        context: "client",
        access: "public",
        default: "https://blindaje-api.vigiaperu.workers.dev",
      }),
      // Sitekey pública del widget "Blindaje - formulario de piloto" (dominios: blindaje-landing.vigiaperu.workers.dev y localhost).
      // Para pruebas locales sin red se puede pasar la de prueba: 1x00000000000000000000AA.
      PUBLIC_TURNSTILE_SITEKEY: envField.string({
        context: "client",
        access: "public",
        default: "0x4AAAAAAFpSga87REIjahye",
      }),
    },
  },
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
      // La letra de toda la página: es la misma de la app, la consola y el portal.
      name: "Atkinson Hyperlegible",
      cssVariable: "--font-atkinson",
      provider: fontProviders.local(),
      options: {
        variants: fontsource("atkinson-hyperlegible", [
          [400, "normal"],
          [700, "normal"],
        ]),
      },
      fallbacks: ["sans-serif"],
      display: "swap",
    },
    {
      // La letra a mano del logo de la consola: solo el logo y las notas sobre las capturas.
      name: "Kalam",
      cssVariable: "--font-kalam",
      provider: fontProviders.local(),
      options: {
        variants: fontsource("kalam", [[700, "normal"]]),
      },
      fallbacks: ["cursive"],
      display: "swap",
    },
  ],
  vite: {
    // eval/report.json y docs/screenshots viven fuera de apps/landing.
    server: { fs: { allow: ["../.."] } },
  },
});
