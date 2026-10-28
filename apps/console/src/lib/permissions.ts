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
  | "invites.create";

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
