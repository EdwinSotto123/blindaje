import { MetaGuardError } from "./errors";

/**
 * Salvaguardas locales. Se ejecutan antes de cada llamada para que un error de configuración
 * nunca llegue a la API (ni a la factura).
 */

/** Contributor mode está prohibido para datos de la app (PROMPT.md, sección 2.4). */
export function assertModelAllowed(model: string): void {
  if (typeof model !== "string" || model.trim() === "") {
    throw new MetaGuardError("invalid_input", "Falta el modelo");
  }
  if (/-contributor$/i.test(model.trim()) || /contributor/i.test(model)) {
    throw new MetaGuardError(
      "contributor_model_forbidden",
      `El modelo ${model} es de Contributor mode: Meta usaría los datos para entrenar. Está prohibido en Blindaje`,
    );
  }
}

const WEB_SEARCH_TYPE = /^web_search/i;

/**
 * Los agentes de análisis no pueden usar búsqueda web ni search grounding. Rechaza:
 * herramientas `web_search*` (incluida `web_search_preview`), funciones llamadas `web_search`,
 * `web_search_options`, e `include` que pida fuentes de búsqueda.
 */
export function assertNoWebSearch(body: Record<string, unknown>): void {
  const tools = body.tools;
  if (tools !== undefined) {
    if (!Array.isArray(tools)) throw new MetaGuardError("invalid_input", "`tools` debe ser un arreglo");
    for (const tool of tools) {
      if (!tool || typeof tool !== "object") continue;
      const t = tool as Record<string, unknown>;
      const type = typeof t.type === "string" ? t.type : "";
      const name = typeof t.name === "string" ? t.name : "";
      if (WEB_SEARCH_TYPE.test(type) || WEB_SEARCH_TYPE.test(name)) {
        throw new MetaGuardError(
          "web_search_forbidden",
          "La búsqueda web (search grounding) está prohibida en los agentes de análisis de Blindaje",
        );
      }
    }
  }
  if ("web_search_options" in body && body.web_search_options !== undefined) {
    throw new MetaGuardError("web_search_forbidden", "`web_search_options` está prohibido: sin búsqueda web");
  }
  const include = body.include;
  if (Array.isArray(include) && include.some((v) => typeof v === "string" && v.startsWith("web_search"))) {
    throw new MetaGuardError("web_search_forbidden", "`include` no puede pedir resultados de búsqueda web");
  }
}

/** Solo `tool_choice: "auto"` existe en la Meta API; cualquier otro valor da HTTP 400. */
export function assertToolChoice(toolChoice: unknown): void {
  if (toolChoice !== undefined && toolChoice !== "auto") {
    throw new MetaGuardError(
      "tool_choice_unsupported",
      'La Meta API solo acepta tool_choice "auto"; el modelo puede responder texto sin llamar herramientas',
    );
  }
}

const TOOL_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Nombres de función: `^[a-zA-Z0-9_.-]+$` con a lo sumo un punto (documentación de tool calling). */
export function assertToolName(name: string): void {
  if (!TOOL_NAME.test(name) || (name.match(/\./g)?.length ?? 0) > 1) {
    throw new MetaGuardError(
      "invalid_tool_name",
      `Nombre de herramienta inválido: "${name}" (usa letras, dígitos, _ - y a lo sumo un punto)`,
    );
  }
  if (WEB_SEARCH_TYPE.test(name)) {
    throw new MetaGuardError("web_search_forbidden", `El nombre "${name}" choca con la herramienta de búsqueda web`);
  }
}
