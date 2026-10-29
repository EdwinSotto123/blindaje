import type { ConsoleRole } from "../api/types";

/**
 * Qué puede hacer cada rol de consola (docs/API.md, sección Consola; docs/rediseno.md, Roles). La API
 * es la que decide; esto solo evita mostrar lo que el rol no puede usar.
 *
 * Desde el rediseño del 28/10 los tres roles son del equipo central de Blindaje: revisan y aprueban
 * para cualquier distrito, no para una organización.
 */
export type Capability =
  | "links.review"
  | "networks.view"
  | "cartografo.run"
  | "hypotheses.decide"
  | "alerts.view"
  | "alerts.decide"
  | "vigia.run"
  | "expedientes"
  | "audit.view"
  | "costs.view"
  | "zones.view"
  | "admin.orgs"
  | "admin.users"
  | "invites.create"
  | "recommendations.view"
  | "recommendations.decide"
  | "asesor.run"
  | "leaks.trace";

const MATRIX: Record<Capability, ConsoleRole[]> = {
  "links.review": ["reviewer", "analyst"],
  "networks.view": ["analyst", "admin"],
  "cartografo.run": ["analyst"],
  "hypotheses.decide": ["analyst"],
  "alerts.view": ["reviewer", "analyst", "admin"],
  // Aprueba el equipo: cualquiera de sus roles, para cualquier distrito.
  "alerts.decide": ["reviewer", "analyst", "admin"],
  "vigia.run": ["analyst", "admin"],
  expedientes: ["analyst"],
  "audit.view": ["admin", "analyst"],
  "costs.view": ["admin", "analyst"],
  // Solo cifras agregadas por distrito, con el umbral de 5 casos de 3 víctimas para el detalle.
  "zones.view": ["reviewer", "analyst", "admin"],
  "admin.orgs": ["admin"],
  "admin.users": ["admin"],
  // Los códigos solo marcan por qué canal de difusión llegó la persona: los genera la administración.
  "invites.create": ["admin"],
  "recommendations.view": ["reviewer", "analyst", "admin"],
  "recommendations.decide": ["reviewer", "analyst", "admin"],
  "asesor.run": ["analyst", "admin"],
  // Solo administración: la analista es quien más evidencia escucha (sería su propia sospechosa) y el
  // rastreo le serviría para probar si una edición borra su marca. La administración no recibe copias.
  "leaks.trace": ["admin"],
};

export function can(role: ConsoleRole | null | undefined, cap: Capability): boolean {
  return !!role && MATRIX[cap].includes(role);
}

/** Primera pantalla útil para cada rol. */
export function homeFor(role: ConsoleRole): string {
  switch (role) {
    case "reviewer":
    case "analyst":
      return "/vinculos";
    case "admin":
      return "/redes";
  }
}
