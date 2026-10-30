import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Api } from "./api-client";
import { runAgentes } from "./api-evals";
import { EVAL_DIR, apiUrl } from "./env";
import { buildResumen, renderMarkdown, type Report } from "./report";

/**
 * pnpm eval:agentes: vuelve a medir solo la fidelidad de citas de los agentes y las estadísticas con
 * menos de 5 casos contra la API desplegada (solo lectura, con la cuenta de analista del demo) y
 * actualiza esas dos secciones de eval/report.json y eval/REPORT.md. Lo demás (voz, imágenes, ficha,
 * escenarios, infiltrado) queda como en la última corrida de `pnpm eval`, y el comando lo dice.
 */
async function main() {
  const url = apiUrl();
  if (!url) throw new Error("Falta API_URL (o la URL en services/api/README.md).");
  const path = resolve(EVAL_DIR, "report.json");
  const prev = JSON.parse(readFileSync(path, "utf8")) as Report;
  const api = new Api(url);
  await api.request("/v1/health");

  const { agentes, estadisticas } = await runAgentes(api);
  console.log(`Agentes: ${agentes.estado}${agentes.motivo ? ` (${agentes.motivo})` : ""}, ${agentes.verificadas}/${agentes.afirmaciones} afirmaciones verificadas en ${agentes.salidas} salidas.`);
  console.log(`Estadísticas con menos de 5 casos: ${estadisticas.estado}, ${estadisticas.estadisticas_con_menos_de_5} en ${estadisticas.perfiles_revisados} perfiles.`);

  const fecha = new Date().toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Lima" });
  const { resumen: _resumen, ...base } = prev;
  const next: Omit<Report, "resumen"> = {
    ...base,
    comando: `${prev.comando.split(" ; ")[0]} ; pnpm --filter @blindaje/eval eval:agentes (agentes y estadísticas, ${fecha})`,
    agentes,
    privacidad: { ...prev.privacidad, estadisticas_menos_5: estadisticas },
  };
  const report: Report = { ...next, resumen: buildResumen(next) };
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(resolve(EVAL_DIR, "REPORT.md"), renderMarkdown(report));
  console.log("eval/report.json y eval/REPORT.md actualizados.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
