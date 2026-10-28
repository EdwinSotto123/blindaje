import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import { setMetaFetchForTests } from "../src/agents/common";
import { mlClientForTests, setMlClientForTests } from "../src/ml/client";
import { metaNoSimulada } from "./fakes";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Ningún test habla con la Meta API real. Por defecto responde 401 (error permanente: la ficha queda
// pendiente); los tests del pipeline instalan su propio fetch falso.
setMetaFetchForTests(metaNoSimulada);

// Ningún test habla con el contenedor ML real. Con la sección `containers` activa en wrangler.jsonc el
// binding ML existe en el pool, pero no hay contenedor. Por defecto los tests ven un despliegue sin ML
// (como antes de activar el contenedor), salvo que el archivo ya haya instalado su ML falso.
beforeEach(() => {
  if (!mlClientForTests()) setMlClientForTests("not_configured");
});
