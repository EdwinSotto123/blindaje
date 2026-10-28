import { forgetDevices } from "./api-client";
import { demoApi, demoSecret } from "./demo-data";

/**
 * pnpm demo:reset: POST /v1/demo/reset (x-demo-secret). Borra todo lo marcado is_demo (casos con
 * su evidencia, índices y vínculos, dispositivos, usuarios, invitaciones, alertas y la
 * organización) y olvida las sesiones locales de los dispositivos del demo. Se puede correr las
 * veces que sea: sin datos de demo, no borra nada. La auditoría no se borra (solo escritura).
 */

async function main() {
  const api = demoApi();
  console.log(`API: ${api.base}`);
  const r = await api.request<{ ok: boolean; deleted: { cases: number; devices: number; users: number } }>("/v1/demo/reset", {
    method: "POST",
    headers: { "x-demo-secret": demoSecret() },
  });
  forgetDevices();
  console.log(`Borrado: ${r.deleted.cases} casos, ${r.deleted.devices} dispositivos, ${r.deleted.users} usuarios de demo.`);
  console.log("Sesiones locales de los dispositivos del demo olvidadas. Corre `pnpm demo:seed` para cargar la historia de nuevo.");
}

main().catch((e) => {
  console.error(`demo:reset falló: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
