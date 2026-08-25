import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/permissions";
import {
  buildOwnershipScope,
  evaluateAccess,
  type AccessContext,
  type AccessTarget,
} from "../abac";

/**
 * Suite de Task 7 (plan.md): decisiones ABAC puras de `lib/rbac/abac.ts`
 * (ejes rol ⊕ sucursal ⊕ clasificación ⊕ ownership).
 *
 * `requirePermissionApi` y `buildAccessContext` quedan FUERA: autentican y
 * tocan sesión/DB — capa 03/04.
 *
 * Matriz vigente (congelada del código):
 * - RBAC base: matriz PERMISSIONS de lib/permissions.ts (SUPER_ADMIN bypass).
 * - Branch scope: GERENTE/SUPERVISOR/EMPLEADO no salen de su branchId.
 * - Clasificación: SENSITIVE → sólo gate roles leen; FINANCIAL → gate roles
 *   leen plano, roles enmascarados leen con redactFields poblado (fail-cerrado
 *   para cualquier rol fuera de ambos conjuntos).
 * - Franchise: NONE/OWN_BRANCH_ONLY/ALL según buildOwnershipScope del rol.
 */

const GATE_ROLES: Role[] = ["SUPER_ADMIN", "OWNER", "ADMIN"];
const MASKED_ROLES: Role[] = ["GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"];

const ctxFor = (role: Role, overrides: Partial<AccessContext> = {}): AccessContext => ({
  userId: "user-1",
  userRole: role,
  userCompanyId: "company-1",
  userBranchId: "branch-1",
  ownershipScope: buildOwnershipScope(role),
  ...overrides,
});

// Firma real: evaluateAccess(resource, action, ctx, target?). Este helper fija
// resource=inventory/action=read y arma el ctx por rol.
const evaluar = (
  role: Role,
  target?: AccessTarget,
  ctxOverrides?: Partial<AccessContext>,
) => evaluateAccess("inventory", "read", ctxFor(role, ctxOverrides), target);

describe("buildOwnershipScope — matriz por rol", () => {
  it("OWNER/SUPER_ADMIN/ADMIN ven owned + TODAS las franquicias", () => {
    for (const role of GATE_ROLES) {
      expect(buildOwnershipScope(role), role).toEqual({
        canSeeOwned: true,
        canSeeFranchise: "ALL",
      });
    }
  });

  it("GERENTE/SUPERVISOR/EMPLEADO: sucursal propia, franquicia sólo si es la suya", () => {
    for (const role of ["GERENTE", "SUPERVISOR", "EMPLEADO"] as Role[]) {
      expect(buildOwnershipScope(role), role).toEqual({
        canSeeOwned: true,
        canSeeFranchise: "OWN_BRANCH_ONLY",
      });
    }
  });

  it("READONLY ve owned pero NINGUNA franquicia", () => {
    expect(buildOwnershipScope("READONLY")).toEqual({
      canSeeOwned: true,
      canSeeFranchise: "NONE",
    });
  });

  it("rol desconocido → fail-cerrado (nada visible)", () => {
    const fantasma = "FANTASMA" as Role;
    expect(buildOwnershipScope(fantasma)).toEqual({
      canSeeOwned: false,
      canSeeFranchise: "NONE",
    });
  });
});

describe("evaluateAccess — eje 1: matriz RBAC base", () => {
  it("permisos válidos pasan el primer gate", () => {
    expect(evaluar("READONLY").allowed).toBe(true); // inventory: read ✓
    expect(evaluar("SUPERVISOR").allowed).toBe(true); // inventory: read ✓
    expect(evaluar("EMPLEADO").allowed).toBe(true); // inventory: read ✓
  });

  it("acciones fuera de la matriz se deniegan con 'role-not-permitted'", () => {
    // Baseline: a EMPLEADO la lectura de inventario le corresponde...
    expect(evaluar("EMPLEADO").allowed).toBe(true);
    // ...pero borrar no está en su fila de la matriz:
    const denegado = evaluateAccess(
      "inventory",
      "delete",
      ctxFor("EMPLEADO"),
    );
    expect(denegado).toEqual({ allowed: false, reason: "role-not-permitted" });
  });

  it("recurso sin acciones para el rol (billing vacío p/ GERENTE) se deniega", () => {
    const denegado = evaluateAccess("billing", "read", ctxFor("GERENTE"));
    expect(denegado).toEqual({ allowed: false, reason: "role-not-permitted" });
  });

  it("SUPER_ADMIN hace bypass de toda la matriz", () => {
    for (const resource of ["users", "billing", "settings"] as const) {
      for (const action of ["create", "read", "update", "delete"] as const) {
        const d = evaluateAccess(resource, action, ctxFor("SUPER_ADMIN"));
        expect(d.allowed, `${resource}:${action}`).toBe(true);
      }
    }
  });

  it("un rol fuera del enum cae denegado por RBAC antes de cualquier otro eje", () => {
    const fantasma = "FANTASMA" as Role;
    const d = evaluar(fantasma, {
      dataClassification: "SENSITIVE",
      ownershipType: "OWNED",
    });
    expect(d).toEqual({ allowed: false, reason: "role-not-permitted" });
  });
});

describe("evaluateAccess — eje 2: alcance de sucursal", () => {
  it("rol acotado que toca SU sucursal pasa", () => {
    const d = evaluar("GERENTE", { branchId: "branch-1" });
    expect(d.allowed).toBe(true);
  });

  it("rol acotado que toca OTRA sucursal → 'branch-out-of-scope'", () => {
    for (const role of ["GERENTE", "SUPERVISOR", "EMPLEADO"] as Role[]) {
      const d = evaluar(role, { branchId: "branch-2" });
      expect(d, role).toEqual({ allowed: false, reason: "branch-out-of-scope" });
    }
  });

  it("roles NO acotados consultan cualquier sucursal", () => {
    for (const role of GATE_ROLES) {
      const d = evaluar(role, { branchId: "branch-2" });
      expect(d.allowed, role).toBe(true);
    }
  });

  it("sin branchId en el target no hay chequeo de sucursal", () => {
    const d = evaluar("GERENTE", {});
    expect(d.allowed).toBe(true);
  });

  it("el eje de sucursal corre ANTES que el de franquicia (orden de los gates)", () => {
    // GERENTE pidiendo una franquicia propia pero en SUCURSAL AJENA: el veredicto
    // es branch-out-of-scope, no franchise-* — así el log de auditoría señala
    // primero la frontera más dura.
    const d = evaluar("GERENTE", {
      branchId: "branch-2",
      ownershipType: "FRANCHISE",
      franchiseeUserId: "user-1",
    });
    expect(d).toEqual({ allowed: false, reason: "branch-out-of-scope" });
  });
});

describe("evaluateAccess — eje 3: clasificación SENSITIVE/FINANCIAL", () => {
  describe("SENSITIVE", () => {
    it("gate roles leen plano", () => {
      for (const role of GATE_ROLES) {
        const d = evaluar(role, { dataClassification: "SENSITIVE" });
        expect(d.allowed, role).toBe(true);
        expect(d.redactFields, role).toBeUndefined();
      }
    });

    it("todos los demás se deniegan ('insensitive-data-gate') — HR llega en Sprint 3", () => {
      for (const role of MASKED_ROLES) {
        const d = evaluar(role, { dataClassification: "SENSITIVE" });
        expect(d, role).toEqual({
          allowed: false,
          reason: "insensitive-data-gate",
        });
      }
    });
  });

  describe("FINANCIAL", () => {
    it("gate roles leen plano SIN redactFields", () => {
      for (const role of GATE_ROLES) {
        const d = evaluar(role, { dataClassification: "FINANCIAL" });
        expect(d.allowed, role).toBe(true);
        expect(d.redactFields, role).toBeUndefined();
      }
    });

    it("roles enmascarados leen CON redactFields poblado (allow+redact)", () => {
      for (const role of MASKED_ROLES) {
        const d = evaluar(role, { dataClassification: "FINANCIAL" });
        expect(d.allowed, role).toBe(true);
        expect(d.redactFields, role).toBeDefined();
        // PII bancario presente; curp/rfc son SENSITIVE y NO van aquí:
        expect(d.redactFields, role).toContain("clabe");
        expect(d.redactFields, role).toContain("bank_name");
        expect(d.redactFields, role).not.toContain("curp");
        expect((d.redactFields ?? []).every((f) => typeof f === "string")).toBe(true);
      }
    });

    it("clasificación PUBLIC/INTERNAL/PERSONAL no activa ningún gate", () => {
      for (const cls of ["PUBLIC", "INTERNAL", "PERSONAL"] as const) {
        const d = evaluar("EMPLEADO", { dataClassification: cls });
        expect(d.allowed, cls).toBe(true);
        expect(d.redactFields).toBeUndefined();
      }
    });
  });
});

describe("evaluateAccess — eje 4: ownership OWNED/FRANCHISE × visibilidad", () => {
  describe("FRANCHISE × NONE/OWN_BRANCH_ONLY/ALL", () => {
    it("visibilidad NONE → 'franchise-not-visible' (p.ej. READONLY)", () => {
      const d = evaluar("READONLY", {
        ownershipType: "FRANCHISE",
        franchiseeUserId: "user-1",
      });
      expect(d).toEqual({ allowed: false, reason: "franchise-not-visible" });
    });

    it("OWN_BRANCH_ONLY permite SÓLO la franquicia propia del actor", () => {
      const propia = evaluar("GERENTE", {
        ownershipType: "FRANCHISE",
        franchiseeUserId: "user-1", // === ctx.userId
      });
      expect(propia.allowed).toBe(true);

      const ajena = evaluar("GERENTE", {
        ownershipType: "FRANCHISE",
        franchiseeUserId: "user-999",
      });
      expect(ajena).toEqual({
        allowed: false,
        reason: "franchise-not-owned-by-actor",
      });
    });

    it("OWN_BRANCH_ONLY sin franchiseeUserId en el target no bloquea (no hay a quién comparar)", () => {
      const d = evaluar("GERENTE", {
        ownershipType: "FRANCHISE",
        franchiseeUserId: null,
      });
      expect(d.allowed).toBe(true);
    });

    it("ALL permite franquicias a gate roles", () => {
      for (const role of GATE_ROLES) {
        const d = evaluar(role, {
          ownershipType: "FRANCHISE",
          franchiseeUserId: "quien-sea",
        });
        expect(d.allowed, role).toBe(true);
      }
    });

    it("barrido completo: cada rol × cada visibilidad da el veredicto esperado", () => {
      const casos: Array<[Role, "NONE" | "OWN_BRANCH_ONLY" | "ALL", string, boolean]> = [
        // [rol, visibilidad del scope, franchiseeUserId del target, ¿permitido?]
        ["GERENTE", "NONE", "user-1", false],
        ["GERENTE", "OWN_BRANCH_ONLY", "user-1", true],
        ["GERENTE", "OWN_BRANCH_ONLY", "user-2", false],
        ["GERENTE", "ALL", "user-2", true],
        ["SUPERVISOR", "OWN_BRANCH_ONLY", "user-2", false],
        ["EMPLEADO", "OWN_BRANCH_ONLY", "user-1", true],
        ["READONLY", "ALL", "user-1", true], // ALL no pasa por el bloque NONE
        ["OWNER", "NONE", "user-1", false], // el scope manda, aunque sea OWNER
        ["ADMIN", "ALL", "user-9", true],
      ];
      for (const [role, visibilidad, franchisee, permitido] of casos) {
        const d = evaluar(
          role,
          { ownershipType: "FRANCHISE", franchiseeUserId: franchisee },
          { ownershipScope: { canSeeOwned: true, canSeeFranchise: visibilidad } },
        );
        expect(d.allowed, `${role}×${visibilidad}×${franchisee}`).toBe(permitido);
      }
    });
  });

  describe("OWNED", () => {
    it("roles normales (canSeeOwned=true) ven owned sin restricción extra", () => {
      const d = evaluar("GERENTE", { ownershipType: "OWNED" });
      expect(d.allowed).toBe(true);
    });

    it("scope canSeeOwned=false + rol sin privilegio → 'owned-not-visible'", () => {
      const d = evaluar(
        "EMPLEADO",
        { ownershipType: "OWNED" },
        { ownershipScope: { canSeeOwned: false, canSeeFranchise: "NONE" } },
      );
      expect(d).toEqual({ allowed: false, reason: "owned-not-visible" });
    });

    it("OWNER/SUPER_ADMIN atraviesan owned aunque su scope diga lo contrario", () => {
      for (const role of ["OWNER", "SUPER_ADMIN"] as Role[]) {
        const d = evaluar(
          role,
          { ownershipType: "OWNED" },
          { ownershipScope: { canSeeOwned: false, canSeeFranchise: "NONE" } },
        );
        expect(d.allowed, role).toBe(true);
      }
    });
  });
});
