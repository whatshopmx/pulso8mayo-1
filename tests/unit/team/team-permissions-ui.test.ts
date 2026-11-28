import { describe, expect, it } from "vitest";
import {
  canActorDeleteTarget,
  canActorManageTarget,
  getAssignableRoles,
} from "@/lib/team/team-permissions";
import { PERMISSION_ROWS } from "@/components/team/role-permission-matrix";

const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
const BRANCH_POLANCO = "b1000001-0000-4000-8000-000000000002";

describe("Task 11: Team permissions UI helpers & RolePermissionMatrix", () => {
  it("GERENTE can edit lower roles in own branch, never ADMIN/SUPER_ADMIN/GERENTE or other branches, and cannot delete", () => {
    const gerente = { id: "u-ger", role: "GERENTE" as const, branchId: BRANCH_CONDESA };

    expect(
      canActorManageTarget(gerente, { id: "u-emp", role: "EMPLEADO", branchId: BRANCH_CONDESA }),
    ).toBe(true);
    expect(
      canActorManageTarget(gerente, { id: "u-sup", role: "SUPERVISOR", branchId: BRANCH_CONDESA }),
    ).toBe(true);
    expect(
      canActorManageTarget(gerente, { id: "u-emp2", role: "EMPLEADO", branchId: BRANCH_POLANCO }),
    ).toBe(false);
    expect(
      canActorManageTarget(gerente, { id: "u-admin", role: "ADMIN", branchId: BRANCH_CONDESA }),
    ).toBe(false);
    expect(
      canActorManageTarget(gerente, { id: "u-sa", role: "SUPER_ADMIN", branchId: BRANCH_CONDESA }),
    ).toBe(false);
    expect(
      canActorDeleteTarget(gerente, { id: "u-emp", role: "EMPLEADO", branchId: BRANCH_CONDESA }),
    ).toBe(false);
  });

  it("ADMIN can manage and delete GERENTE/SUPERVISOR/EMPLEADO across branches, never SUPER_ADMIN/OWNER or self", () => {
    const admin = { id: "u-adm", role: "ADMIN" as const, branchId: BRANCH_CONDESA };

    expect(
      canActorManageTarget(admin, { id: "u-ger", role: "GERENTE", branchId: BRANCH_POLANCO }),
    ).toBe(true);
    expect(
      canActorDeleteTarget(admin, { id: "u-ger", role: "GERENTE", branchId: BRANCH_POLANCO }),
    ).toBe(true);
    expect(
      canActorManageTarget(admin, { id: "u-sa", role: "SUPER_ADMIN", branchId: BRANCH_CONDESA }),
    ).toBe(false);
    expect(
      canActorDeleteTarget(admin, { id: "u-sa", role: "SUPER_ADMIN", branchId: BRANCH_CONDESA }),
    ).toBe(false);
    expect(
      canActorDeleteTarget(admin, { id: "u-adm", role: "ADMIN", branchId: BRANCH_CONDESA }),
    ).toBe(false);
  });

  it("getAssignableRoles includes SUPERVISOR and READONLY and respects hierarchy", () => {
    expect(getAssignableRoles("GERENTE")).toEqual(["SUPERVISOR", "EMPLEADO", "READONLY"]);
    expect(getAssignableRoles("ADMIN")).toEqual(["GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"]);
    expect(getAssignableRoles("SUPER_ADMIN")).toContain("SUPER_ADMIN");
    expect(getAssignableRoles("SUPER_ADMIN")).toContain("OWNER");
    expect(getAssignableRoles("SUPER_ADMIN")).toContain("SUPERVISOR");
  });

  it("RolePermissionMatrix accurately reflects real RBAC policy (e.g. GERENTE builds workflows; ADMIN cannot manage subscription)", () => {
    const builderRow = PERMISSION_ROWS.find((r) => r.name.includes("Constructor"));
    const subRow = PERMISSION_ROWS.find((r) => r.name.includes("Suscripción"));
    const selfServiceRow = PERMISSION_ROWS.find((r) => r.name.includes("Autoservicio"));
    const execRow = PERMISSION_ROWS.find((r) => r.name.includes("Ejecutiva"));

    expect(builderRow?.check("GERENTE")).toBe(true);
    expect(builderRow?.check("SUPERVISOR")).toBe(false);
    expect(subRow?.check("SUPER_ADMIN")).toBe(true);
    expect(subRow?.check("ADMIN")).toBe(false);
    expect(selfServiceRow?.check("EMPLEADO")).toBe(true);
    expect(execRow?.check("ADMIN")).toBe(true);
    expect(execRow?.check("GERENTE")).toBe(false);
  });
});
