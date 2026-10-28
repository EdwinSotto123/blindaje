import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RESULTS_DIR } from "./env";
import { demoApi, demoSecret, loadDemo, prepareCase, submitAndWait } from "./demo-data";

/**
 * pnpm demo:seed: carga la historia ficticia de los casos A, B y C usando la API como la app.
 *
 *   1. POST /v1/demo/seed (x-demo-secret): organización, usuarios de consola e invitaciones.
 *   2. Por caso, en orden cronológico (A, D, E, B, F, C, G): dispositivo con su invitación y llave
 *      P-256, muestra de voz (A), caso con x-demo-case-code, evidencia con SHA-256, submit y espera
 *      del procesamiento, para que B encuentre a A en los índices y C encuentre a B.
 *      D, E, F y G son casos de fondo de solo texto en Lima Este (tres pagan a la cuenta
 *      recaudadora 900 000 202) para que la red y el Vigía tengan volumen: >= 5 casos de >= 3
 *      víctimas en la misma zona en 14 días. Las fechas son relativas al día del seed.
 *
 * Idempotente: reutiliza los dispositivos guardados (refresh firmado), no recrea casos que ya
 * existen y la API ignora una evidencia repetida (mismo SHA-256). Variables: API_URL,
 * DEMO_SECRET (o services/api/.dev.vars), DEMO_WAIT_SECONDS (por caso, 240 por defecto).
 */

async function main() {
  const api = demoApi();
  const demo = loadDemo();
  const wait = Number(process.env.DEMO_WAIT_SECONDS ?? 240);
  console.log(`API: ${api.base}`);
  const seed = await api.request<{ org: { name: string }; invites: string[]; users: { email: string; role: string }[] }>(
    "/v1/demo/seed",
    { method: "POST", headers: { "x-demo-secret": demoSecret() } },
  );
  console.log(`Organización: ${seed.org.name}`);
  console.log(`Consola: ${seed.users.map((u) => `${u.role} ${u.email}`).join(", ")} (contraseñas en services/api/README.md)`);

  const resumen: Record<string, unknown> = {};
  for (const c of demo.casos) {
    console.log(`\nCaso ${c.code}${c.fondo ? " (de fondo, solo texto)" : ""}: ${c.sector}, ${c.zona}, primer contacto ${c.evidencia[0]!.captured_at}`);
    const p = await prepareCase(api, `caso-${c.code}`, c);
    const r = await submitAndWait(api, p, c.relato, wait);
    const estado = r.status === "procesando" ? `sigue procesando después de ${r.segundos} s` : `${r.status} en ${r.segundos} s`;
    console.log(`  procesamiento: ${estado}`);
    if (r.hallazgos.length) console.log(`  lo que encontramos: ${r.hallazgos.join(" · ")}`);
    resumen[c.code] = { case_id: p.case_id, status: r.status, segundos: r.segundos, evidencia: p.subidas, muestra_voz: p.muestra_voz };
  }
  writeFileSync(resolve(RESULTS_DIR, "demo-seed.json"), JSON.stringify({ ts: new Date().toISOString(), api: api.base, casos: resumen }, null, 2));
  console.log("\nListo. Revisa la cola de vínculos en la consola con la cuenta de la revisora.");
}

main().catch((e) => {
  console.error(`demo:seed falló: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
