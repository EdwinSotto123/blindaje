import { describe, expect, it } from "vitest";
import type { ConsoleRole } from "../api/types";
import { ROLE_LABEL } from "./format";
import { can, type Capability } from "./permissions";

const ROLES: ConsoleRole[] = ["reviewer", "analyst", "admin"];
const who = (cap: Capability) => ROLES.filter((r) => can(r, cap));

describe("permisos del equipo central (rediseño del 28/10)", () => {
  it("aprueba el equipo: alertas y consejos los decide cualquiera de sus roles", () => {
    expect(who("alerts.decide")).toEqual(ROLES);
    expect(who("recommendations.decide")).toEqual(ROLES);
    expect(who("alerts.view")).toEqual(ROLES);
    expect(who("recommendations.view")).toEqual(ROLES);
  });

  it("los agentes los corren análisis y administración; el Cartógrafo, solo análisis", () => {
    expect(who("vigia.run")).toEqual(["analyst", "admin"]);
    expect(who("asesor.run")).toEqual(["analyst", "admin"]);
    expect(who("cartografo.run")).toEqual(["analyst"]);
  });

  it("la vista de zonas es para todo el equipo", () => {
    expect(who("zones.view")).toEqual(ROLES);
  });

  it("los códigos de un canal de difusión y la administración son solo de administración", () => {
    expect(who("invites.create")).toEqual(["admin"]);
    expect(who("admin.orgs")).toEqual(["admin"]);
    expect(who("admin.users")).toEqual(["admin"]);
    expect(who("leaks.trace")).toEqual(["admin"]);
  });

  it("sin sesión no se puede nada", () => {
    expect(can(null, "zones.view")).toBe(false);
    expect(can(undefined, "alerts.view")).toBe(false);
  });

  it("los roles se nombran por su función, sin gremio ni alianza", () => {
    expect(ROLES.map((r) => ROLE_LABEL[r])).toEqual(["Revisión", "Análisis", "Administración"]);
    expect(Object.values(ROLE_LABEL).join(" ")).not.toMatch(/gremio|alianza/i);
  });
});
