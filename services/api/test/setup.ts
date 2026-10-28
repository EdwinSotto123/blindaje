import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { setMetaFetchForTests } from "../src/agents/common";
import { metaNoSimulada } from "./fakes";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Ningún test habla con la Meta API real. Por defecto responde 401 (error permanente: la ficha queda
// pendiente); los tests del pipeline instalan su propio fetch falso.
setMetaFetchForTests(metaNoSimulada);
