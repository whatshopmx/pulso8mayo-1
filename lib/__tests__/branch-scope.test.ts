import { describe, expect, it } from "vitest";

import {
  assertBranchAssignment,
  canAccessAllBranches,
  enforceBranchScope,
  getAccessibleBranchIds,
  isBranchScopedRole,
  resolveBranchScope,
  type BranchScope,
} from "../branch-scope";
import type { Role } from "../permissions";

/**
 * Suite de Task 7 (plan.md): alcance de sucursal sobre la parte pura de
 * `lib/branch-scope.ts`.
 *
 * `assertBranchOfCompany` queda FUERA de esta capa: es async y toca Postgres
 * (valida que la sucursal pertenezca a la empresa) — se cubre en la capa de
 * base efímera (Task 16).
 *
 * Contratos congelados aquí (documentados en el propio módulo):
 * - RP-02: GERENTE/SUPERVISOR/READONLY tienen BRANCH y EMPLEADO tiene OWN,
 *   ambos limitados por su sucursal. Los recursos personales usan además userId.
 * - RP-02: `enforceBranchScope` lanza sin asignación; `resolveBranchScope`
 *   devuelve NONE. Ninguno permite interpretar ausencia como consolidado.
 */

const ALL_ROLES: Role[] = [
  "SUPER_ADMIN",
  "OWNER",
  "ADMIN",
  "GERENTE",
  "SUPERVISOR",
  "EMPLEADO",
  "READONLY",
];

const BRANCH_SCOPED: Role[] = ["GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"];
const NOT_SCOPED = ALL_ROLES.filter((r) => !BRANCH_SCOPED.includes(r));

describe("isBranchScopedRole", () => {
  it("GERENTE y SUPERVISOR están acotados a sucursal", () => {
    expect(isBranchScopedRole("GERENTE")).toBe(true);
    expect(isBranchScopedRole("SUPERVISOR")).toBe(true);
  });

  it("los demás roles no están acotados", () => {
    for (const role of NOT_SCOPED) {
      expect(isBranchScopedRole(role), role).toBe(false);
    }
  });
});

describe("canAccessAllBranches", () => {
  it("es el complemento exacto de isBranchScopedRole", () => {
    // Propiedad: para todo rol, uno y sólo uno de los dos predicados es true.
    for (const role of ALL_ROLES) {
      expect(canAccessAllBranches(role), role).toBe(!isBranchScopedRole(role));
    }
  });
});

describe("enforceBranchScope", () => {
  it("rol sin acotación devuelve la sucursal pedida (puede filtrar por parámetro)", () => {
    expect(enforceBranchScope("ADMIN", "propia", "pedida")).toBe("pedida");
    expect(enforceBranchScope("SUPER_ADMIN", null, "pedida")).toBe("pedida");
  });

  it("rol sin acotación sin parámetro devuelve null (= todas)", () => {
    expect(enforceBranchScope("ADMIN", null, null)).toBeNull();
    expect(enforceBranchScope("ADMIN", undefined, undefined)).toBeNull();
    expect(enforceBranchScope("OWNER", "propia", null)).toBeNull();
  });

  it("rol acotado SIEMPRE devuelve su propia sucursal aunque pida otra (no amplía alcance por parámetro)", () => {
    expect(enforceBranchScope("GERENTE", "suc-propia", "suc-ajena")).toBe(
      "suc-propia"
    );
    expect(enforceBranchScope("SUPERVISOR", "suc-propia", "suc-ajena")).toBe(
      "suc-propia"
    );
  });

  it("RP-02: helper legacy sin asignación lanza 403, nunca null interpretable como ALL", () => {
    for (const role of BRANCH_SCOPED) {
      expect(() => enforceBranchScope(role, null, 'suc-pedida')).toThrow(/sucursal/i);
    }
    expect(() => enforceBranchScope('UNKNOWN' as Role, null, 'suc-pedida')).toThrow();
  });
});

describe("getAccessibleBranchIds", () => {
  const catalogo = ["suc-a", "suc-b", "suc-c"];

  it("rol sin acotación recibe el catálogo completo tal cual", () => {
    expect(getAccessibleBranchIds("ADMIN", null, catalogo)).toEqual(catalogo);
    expect(getAccessibleBranchIds("OWNER", "suc-x", catalogo)).toEqual(catalogo);
  });

  it("rol acotado con sucursal del catálogo ve sólo la suya", () => {
    expect(getAccessibleBranchIds("GERENTE", "suc-b", catalogo)).toEqual([
      "suc-b"
    ]);
  });

  it("rol acotado con sucursal FUERA del catálogo falla cerrado", () => {
    expect(getAccessibleBranchIds("GERENTE", "suc-fantasma", catalogo)).toEqual(
      []
    );
  });

  it("rol acotado sin sucursal asignada ve el vacío (fail-cerrado)", () => {
    expect(getAccessibleBranchIds("GERENTE", null, catalogo)).toEqual([]);
    expect(getAccessibleBranchIds("SUPERVISOR", "", catalogo)).toEqual([]);
  });
});

describe('RP-02b · roles fijados y desconocidos', () => {
  it.each(BRANCH_SCOPED)('%s ignora preferencias y no cae a ALL sin asignación', role => {
    expect(isBranchScopedRole(role)).toBe(true);
    expect(resolveBranchScope(role, 'propia', 'otra')).toEqual({ kind: 'BRANCH', branchId: 'propia' });
    expect(resolveBranchScope(role, null, 'otra')).toEqual({ kind: 'NONE' });
  });
  it('rol desconocido no obtiene empresa ni sucursales', () => {
    const role = 'UNKNOWN' as Role;
    expect(canAccessAllBranches(role)).toBe(false);
    expect(resolveBranchScope(role, null, 'otra')).toEqual({ kind: 'NONE' });
    expect(getAccessibleBranchIds(role, null, ['otra'])).toEqual([]);
  });
});

describe("resolveBranchScope", () => {
  const esBranch = (s: BranchScope, id: string) =>
    expect(s).toEqual({ kind: "BRANCH", branchId: id });

  it("rol sin acotación + sucursal pedida → BRANCH(pedida)", () => {
    esBranch(resolveBranchScope("ADMIN", null, "suc-pedida"), "suc-pedida");
    esBranch(resolveBranchScope("ADMIN", "propia", "pedida"), "pedida");
  });

  it("rol sin acotación sin pedido → ALL", () => {
    expect(resolveBranchScope("ADMIN", null, null)).toEqual({ kind: "ALL" });
    expect(resolveBranchScope("SUPER_ADMIN", null)).toEqual({ kind: "ALL" });
  });

  it("rol acotado con sucursal → BRANCH(propia) aunque pida otra", () => {
    esBranch(resolveBranchScope("GERENTE", "suc-propia", "suc-ajena"), "suc-propia");
    esBranch(resolveBranchScope("SUPERVISOR", "suc-propia"), "suc-propia");
  });

  it("rol acotado SIN sucursal → NONE (fail-cerrado, nunca 'sin filtro')", () => {
    expect(resolveBranchScope("GERENTE", null, "suc-pedida")).toEqual({
      kind: "NONE"
    });
    expect(resolveBranchScope("SUPERVISOR", undefined)).toEqual({
      kind: "NONE"
    });
  });
});

describe("assertBranchAssignment", () => {
  it("lanza para GERENTE/SUPERVISOR sin sucursal, con mensaje apto para UI", () => {
    for (const role of BRANCH_SCOPED) {
      for (const branchId of [null, undefined, ""] as
        Array<string | null | undefined>) {
        // Nota: "   " NO cuenta como ausente para este guard (truthy) — el
        // chequeo es `!branchId`; recortar espacios queda del lado de la UI.
        expect(() => assertBranchAssignment(role, branchId), `${role}/${String(branchId)}`)
          .toThrowError(/sucursal/i);
      }
    }
  });

  it("no lanza para rol acotado con sucursal asignada", () => {
    expect(() => assertBranchAssignment("GERENTE", "suc-1")).not.toThrow();
    expect(() => assertBranchAssignment("SUPERVISOR", "suc-1")).not.toThrow();
  });

  it("no lanza para roles que legítimamente no tienen sucursal", () => {
    for (const role of NOT_SCOPED) {
      expect(() => assertBranchAssignment(role, null), role).not.toThrow();
      expect(() => assertBranchAssignment(role, undefined), role).not.toThrow();
    }
  });
});
