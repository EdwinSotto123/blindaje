import type { ConsoleRole } from "../api/types";

/**
 * Qué puede hacer cada rol de consola (docs/API.md, sección Consola). La API es la que decide;
 * esto solo evita mostrar lo que el rol no puede usar.
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
  | "admin.orgs"
  | "admin.users"
  | "invites.create"
  | "recommendations.view"
  | "recommendations.decide"
  | "asesor.run"
  | "business.create"
  | "leaks.trace";

const MATRIX: Record<Capability, ConsoleRole[]> = {
  "links.review": ["reviewer", "analyst"],
  "networks.view": ["analyst", "admin"],
  "cartografo.run": ["analyst"],
  "hypotheses.decide": ["analyst"],
  "alerts.view": ["reviewer", "analyst", "admin"],
  "alerts.decide": ["reviewer", "admin"],
  "vigia.run": ["analyst", "admin"],
  expedientes: ["analyst"],
  "audit.view": ["admin", "analyst"],
  "costs.view": ["admin", "analyst"],
  "admin.orgs": ["admin"],
  "admin.users": ["admin"],
  "invites.create": ["admin", "reviewer"],
  "recommendations.view": ["reviewer", "analyst", "admin"],
  "recommendations.decide": ["reviewer", "admin"],
  "asesor.run": ["analyst", "admin"],
  "business.create": ["admin", "reviewer"],
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
