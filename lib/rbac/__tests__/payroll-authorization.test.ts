import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/permissions";
import { buildOwnershipScope, evaluateAccess } from "../abac";

/**
 * S-1 (Phase -1 / security gate) — autorización del módulo de nómina.
 *
 * `POST /api/payroll/run` timbra CFDI: es irreversible y fiscal. El guard es
 * `requirePermissionApi("reports", "manage", { classification: "FINANCIAL" })`.
 * Esta suite congela la decisión pura para que ningún cambio de la matriz
 * PERMISSIONS vuelva a abrir la ejecución de nómina a roles no autorizados.
 *
 * No toca sesión ni DB: prueba `evaluateAccess`, que es lo que el guard usa.
 */

const ctxFor = (role: Role) => ({
  userId: "user-1",
  userRole: role,
  userCompanyId: "company-1",
  userBranchId: "branch-1",
  ownershipScope: buildOwnershipScope(role),
});

const decisionFor = (role: Role) =>
  evaluateAccess("reports", "manage", ctxFor(role), {
    dataClassification: "FINANCIAL",
  });

describe("S-1 · /api/payroll/run — reports:manage + FINANCIAL", () => {
  it("ADMIN / OWNER / SUPER_ADMIN pueden ejecutar la nómina", () => {
    for (const role of ["ADMIN", "OWNER", "SUPER_ADMIN"] as Role[]) {
      expect(decisionFor(role).allowed, role).toBe(true);
    }
  });

  it("GERENTE queda denegado (no tiene reports:manage) — era el agujero original", () => {
    expect(decisionFor("GERENTE")).toEqual({
      allowed: false,
      reason: "role-not-permitted",
    });
  });

  it("SUPERVISOR / EMPLEADO / READONLY quedan denegados", () => {
    for (const role of ["SUPERVISOR", "EMPLEADO", "READONLY"] as Role[]) {
      const d = decisionFor(role);
      expect(d.allowed, role).toBe(false);
    }
  });

  it("un rol desconocido falla cerrado", () => {
    const d = evaluateAccess(
      "reports",
      "manage",
      ctxFor("FANTASMA" as Role),
      { dataClassification: "FINANCIAL" },
    );
    expect(d.allowed).toBe(false);
  });
});
