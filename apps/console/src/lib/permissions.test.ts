import { describe, expect, it } from "vitest";
import type { ConsoleRole } from "../api/types";
import { ROLE_LABEL } from "./format";
import { can, homeFor, type Capability } from "./permissions";

const ROLES: ConsoleRole[] = ["reviewer", "analyst", "admin"];
const who = (cap: Capability) => ROLES.filter((r) => can(r, cap));

describe("permisos del equipo central (rediseño del 28/10)", () => {
  it("aprueba el equipo: alertas y consejos los decide cualquiera de sus roles", () => {
    expect(who("alerts.decide")).toEqual(ROLES);
    expect(who("recommendations.decide")).toEqual(ROLES);
    expect(who("alerts.view")).toEqual(ROLES);
    expect(who("recommendations.view")).toEqual(ROLES);
  });

  it("los agentes los corren análisis y administración", () => {
    expect(who("vigia.run")).toEqual(["analyst", "admin"]);
    expect(who("asesor.run")).toEqual(["analyst", "admin"]);
    expect(who("cartografo.run")).toEqual(["analyst", "admin"]);
  });

  it("la administración ve y hace todo, y empieza en Monitoreo (29/10)", () => {
    const caps = Object.keys({
      "links.review": 1, "networks.view": 1, "cartografo.run": 1, "hypotheses.decide": 1, "alerts.view": 1, "alerts.decide": 1,
      "vigia.run": 1, expedientes: 1, "audit.view": 1, "costs.view": 1, "zones.view": 1, "admin.orgs": 1, "admin.users": 1,
      "invites.create": 1, "recommendations.view": 1, "recommendations.decide": 1, "asesor.run": 1, "leaks.trace": 1,
      "vectors.view": 1, "monitor.view": 1,
    } satisfies Record<Capability, 1>) as Capability[];
    for (const cap of caps) expect(can("admin", cap), cap).toBe(true);
    expect(homeFor("admin")).toBe("/monitoreo");
    expect(who("links.review")).toEqual(ROLES);
    expect(who("expedientes")).toEqual(["analyst", "admin"]);
  });

  it("la vista de zonas es para todo el equipo", () => {
    expect(who("zones.view")).toEqual(ROLES);
  });

  it("los códigos de un canal de difusión y la administración son solo de administración", () => {
    expect(who("invites.create")).toEqual(["admin"]);
    expect(who("admin.orgs")).toEqual(["admin"]);
    expect(who("admin.users")).toEqual(["admin"]);
    expect(who("leaks.trace")).toEqual(["admin"]);
    expect(who("vectors.view")).toEqual(["admin"]);
    expect(who("monitor.view")).toEqual(["admin"]);
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
