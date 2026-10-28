/**
 * Agentes (sección 10): Vinculador, Cartógrafo, Vigía y Redactor, cada uno en su archivo.
 * Piezas comunes (cliente de Meta con hooks de costo, validador de citas, reintento y
 * registro en agent_runs) en ./common.
 *
 * Reglas (10.1): toda afirmación cita evidencia existente; hechos e hipótesis separados; sin
 * búsqueda web; nunca nombres de personas; nada sale sin revisión humana (todo nace en borrador);
 * cada ejecución se audita con `audit(env, { action: "agent.<nombre>", ... })`.
 */
export type { CitationCheck } from "@blindaje/shared";
export { citationFeedback, metaClientFor, recordAgentRun, runCheckedAgent, validateCitations } from "./common";
export type { AgentAttempt, AgentKind, CheckedAgentResult } from "./common";
export { runVinculador } from "./vinculador";
export { runCartografo, type CartografoOptions } from "./cartografo";
export { runVigia, type VigiaRunOptions } from "./vigia";
export { runRedactor, type RedactorOptions } from "./redactor";
