import { describe, expect, it } from "vitest";

import {
  PERMISSIONS,
  hasPermission,
  type Resource,
  type Role,
} from "@/lib/permissions";

/**
 * Phase 0 / Task 2 — recurso RBAC `exceptions`.
 *
 * Contratos:
 * - `hasPermission` con `'exceptions'`: SUPER_ADMIN/OWNER/ADMIN gestionan,
 *   GERENTE/SUPERVISOR leen+actualizan, EMPLEADO/READONLY solo leen.
 * - No regresión: conserva el catálogo histórico más las capacidades explícitas
 *   de RP-01; el permiso de exceptions no cambia.
 */

const ROLES: Role[] = [
  "SUPER_ADMIN",
  "OWNER",
  "ADMIN",
  "GERENTE",
  "SUPERVISOR",
  "EMPLEADO",
  "READONLY",
];

/**
 * Recursos esperados por rol (congelado del código vigente). `exceptions`
 * fue el ÚNICO recurso agregado en Task 2; cualquier otro cambio de
 * catálogo (alta o baja) hace fallar este test.
 */
const EXPECTED_RESOURCES: Record<Role, Resource[]> = {
  SUPER_ADMIN: [
    "users",
    "companies",
    "branches",
    "workflows",
    "inventory",
    "reports",
    "settings",
    "billing",
    "exceptions",
  ],
  OWNER: [
    "users",
    "companies",
    "branches",
    "workflows",
    "inventory",
    "reports",
    "settings",
    "billing",
    "exceptions",
  ],
  ADMIN: [
    "users",
    "companies",
    "branches",
    "workflows",
    "inventory",
    "reports",
    "settings",
    "billing",
    "exceptions",
  ],
  GERENTE: [
    "users",
    "companies",
    "branches",
    "workflows",
    "inventory",
    "reports",
    "settings",
    "billing",
    "exceptions",
  ],
  SUPERVISOR: [
    "users",
    "companies",
    "branches",
    "workflows",
    "inventory",
    "reports",
    "settings",
    "billing",
    "exceptions",
  ],
  EMPLEADO: [
    "users",
    "companies",
    "branches",
    "workflows",
    "inventory",
    "reports",
    "settings",
    "billing",
    "exceptions",
  ],
  READONLY: [
    "users",
    "companies",
    "branches",
    "workflows",
    "inventory",
    "reports",
    "settings",
    "billing",
    "exceptions",
  ],
};

const RP01_RESOURCES: Record<Role, Resource[]> = {
  SUPER_ADMIN: ['executive', 'financial-summary', 'payroll', 'incidents', 'profile'],
  OWNER: ['executive', 'financial-summary', 'payroll', 'incidents', 'profile'],
  ADMIN: ['executive', 'financial-summary', 'payroll', 'incidents', 'profile'],
  GERENTE: ['financial-summary', 'incidents', 'profile'],
  SUPERVISOR: ['incidents', 'profile'],
  EMPLEADO: ['incidents', 'profile'],
  READONLY: ['incidents', 'profile'],
};

describe("matriz de recursos — no regresión (Task 2 + RP-01)", () => {
  it.each(ROLES)("%s conserva exactamente sus recursos", (role) => {
    expect(Object.keys(PERMISSIONS[role]).sort()).toEqual(
      [...EXPECTED_RESOURCES[role], ...RP01_RESOURCES[role]].sort(),
    );
  });

  it("no quedan roles sin entrada en la matriz", () => {
    for (const role of ROLES) {
      expect(PERMISSIONS[role], role).toBeDefined();
    }
  });
});

describe("hasPermission — recurso exceptions", () => {
  it("GERENTE puede actualizar (read+update)", () => {
    expect(hasPermission("GERENTE", "exceptions", "update")).toBe(true);
    expect(hasPermission("GERENTE", "exceptions", "read")).toBe(true);
  });

  it("SUPERVISOR puede actualizar (read+update)", () => {
    expect(hasPermission("SUPERVISOR", "exceptions", "update")).toBe(true);
    expect(hasPermission("SUPERVISOR", "exceptions", "read")).toBe(true);
  });

  it("EMPLEADO solo lee; no actualiza", () => {
    expect(hasPermission("EMPLEADO", "exceptions", "read")).toBe(true);
    expect(hasPermission("EMPLEADO", "exceptions", "update")).toBe(false);
    expect(hasPermission("EMPLEADO", "exceptions", "delete")).toBe(false);
  });

  it("READONLY solo lee", () => {
    expect(hasPermission("READONLY", "exceptions", "read")).toBe(true);
    expect(hasPermission("READONLY", "exceptions", "update")).toBe(false);
  });

  it("ADMIN/OWNER gestionan (manage cubre toda acción)", () => {
    for (const role of ["ADMIN", "OWNER", "SUPER_ADMIN"] as Role[]) {
      expect(hasPermission(role, "exceptions", "update"), role).toBe(true);
      expect(hasPermission(role, "exceptions", "delete"), role).toBe(true);
      expect(hasPermission(role, "exceptions", "manage"), role).toBe(true);
    }
  });

  it("SUPER_ADMIN lee exceptions mediante manage explícito", () => {
    expect(hasPermission("SUPER_ADMIN", "exceptions", "read")).toBe(true);
  });
});
