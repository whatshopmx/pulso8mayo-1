import { describe, expect, it } from "vitest";

import { exceptionBranchScope } from "../exception-access";
import type { Role } from "@/lib/permissions";

/**
 * Phase 0 / Task 9 — alcance de sucursal para excepciones.
 *
 * La decisión pura es lo que garantiza el aislamiento: un rol de sucursal sin
 * `branchId` devuelve `NONE` (fail-closed) y la ruta responde vacío/404.
 */
describe("exceptionBranchScope", () => {
  it("roles no acotados ven toda la empresa", () => {
    for (const role of ["SUPER_ADMIN", "OWNER", "ADMIN"] as Role[]) {
      expect(exceptionBranchScope(role, null)).toEqual({ kind: "ALL" });
      expect(exceptionBranchScope(role, "b1")).toEqual({ kind: "ALL" });
    }
  });

  it("GERENTE queda pinneado a su sucursal", () => {
    expect(exceptionBranchScope("GERENTE", "b1")).toEqual({
      kind: "BRANCH",
      branchId: "b1",
    });
  });

  it("SUPERVISOR queda pinneado a su sucursal", () => {
    expect(exceptionBranchScope("SUPERVISOR", "b2")).toEqual({
      kind: "BRANCH",
      branchId: "b2",
    });
  });

  it("GERENTE y SUPERVISOR sin sucursal devuelven NONE (fail-closed)", () => {
    expect(exceptionBranchScope("GERENTE", null)).toEqual({ kind: "NONE" });
    expect(exceptionBranchScope("GERENTE", undefined)).toEqual({ kind: "NONE" });
    expect(exceptionBranchScope("SUPERVISOR", null)).toEqual({ kind: "NONE" });
  });
});
