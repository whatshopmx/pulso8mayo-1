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
 * - Los roles acotados a sucursal son SÓLO GERENTE y SUPERVISOR. EMPLEADO no
 *   está acotado en ESTE módulo (a diferencia de `lib/rbac/abac.ts`, donde
 *   BRANCH_SCOPED_ROLES sí lo incluye — son dos capas distintas).
 * - `enforceBranchScope` es legacy fail-ABIERTO para un GERENTE sin sucursal:
 *   devuelve null y el consumidor interpreta "sin filtro". No corregir aquí;
 *   `resolveBranchScope` es su reemplazo fail-cerrado.
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

const BRANCH_SCOPED: Role[] = ["GERENTE", "SUPERVISOR"];
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
    expect(enforceBranchScope("READONLY", "propia", null)).toBeNull();
  });

  it("rol acotado SIEMPRE devuelve su propia sucursal aunque pida otra (no amplía alcance por parámetro)", () => {
    expect(enforceBranchScope("GERENTE", "suc-propia", "suc-ajena")).toBe(
      "suc-propia"
    );
    expect(enforceBranchScope("SUPERVISOR", "suc-propia", "suc-ajena")).toBe(
      "suc-propia"
    );
  });

  it("⚠️ rol acotado SIN sucursal asignada devuelve null (fail-abierto, legacy documentado)", () => {
    // Congelado a propósito: null significa "sin filtro" para quien llama,
    // así que un GERENTE sin branchId ve toda la empresa por este helper.
    // El reemplazo fail-cerrado es resolveBranchScope → NONE.
    expect(enforceBranchScope("GERENTE", null, "suc-pedida")).toBeNull();
    expect(enforceBranchScope("SUPERVISOR", undefined, "suc-pedida")).toBeNull();
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

  it("rol acotado con sucursal FUERA del catálogo sigue viendo sólo la suya", () => {
    // Congelado: la respuesta es [userBranchId] aunque no esté en allBranchIds.
    // El helper no valida contra el catálogo; quien consume decide si 404.
    expect(getAccessibleBranchIds("GERENTE", "suc-fantasma", catalogo)).toEqual(
      ["suc-fantasma"]
    );
  });

  it("rol acotado sin sucursal asignada ve el vacío (fail-cerrado)", () => {
    expect(getAccessibleBranchIds("GERENTE", null, catalogo)).toEqual([]);
    expect(getAccessibleBranchIds("SUPERVISOR", "", catalogo)).toEqual([]);
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
