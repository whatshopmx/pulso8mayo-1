/**
 * Fixtures de aislamiento — dos empresas, sin datos de producción.
 *
 * Tarea C00 (`tasks/plan-conexion-frontend-backend.md`). Este módulo es la
 * vocabulario compartido que usan las pruebas de autorización y alcance: toda
 * prueba que necesite "alguien de otra empresa" toma los ids de aquí en vez de
 * inventarlos, para que dos suites no acaben comparando empresas distintas.
 *
 * Reglas del módulo:
 * - **Puro.** No importa `db`, `auth`, `next/headers` ni nada que sólo exista en
 *   el servidor. Es importable desde Vitest sin arnés y sin conexión.
 * - **Ids estables.** Empresas y sucursales son UUID con forma válida porque
 *   varias guardas (`assertBranchOfCompany`, casteos de Postgres) rechazan
 *   cualquier otra cosa antes de tocar la base.
 * - **Sin escritura.** Describe datos; no los persiste. La base de las pruebas
 *   unitarias es un `vi.mock("@/lib/db")`, no estas fixtures.
 *
 * Nombres en español porque describen el dominio HORECA del proyecto, igual que
 * el resto del código de aplicación.
 */

import type { Role } from "@/lib/permissions";
import type { CreateShiftInput, Shift } from "@/lib/types/shifts";

/** Empresa A — la del usuario autorizado en la mayoría de las pruebas. */
export const EMPRESA_A = "a1000000-0000-4000-8000-00000000000a";
/** Empresa B — la ajena. Nunca debe ser visible para nadie de A. */
export const EMPRESA_B = "b2000000-0000-4000-8000-00000000000b";

/** Dos sucursales en A: una propia del gerente, otra que debe quedar fuera. */
export const SUCURSAL_A_1 = "a1000001-0000-4000-8000-000000000001";
export const SUCURSAL_A_2 = "a1000001-0000-4000-8000-000000000002";
/** Una sucursal en B: existe, pero no es de nadie de A. */
export const SUCURSAL_B_1 = "b2000001-0000-4000-8000-000000000001";

/**
 * `planned_shifts.user_id` es `text` contra `users.id`, que también es `text`
 * (better-auth). No son UUID: un id con forma de UUID aquí no representaría
 * nada real.
 */
export const EMPLEADO_A_1 = "user-empleado-a1";
export const EMPLEADO_A_2 = "user-empleado-a2";
export const EMPLEADO_B_1 = "user-empleado-b1";

/**
 * Sesión simulada. La forma es la que devuelve `requireAuth()` y
 * `requireTenantAuth()`: si cambia una de las dos, el tipo deja de compilar
 * aquí antes de romper el silencio en una prueba.
 */
export interface SessionFixture {
  id: string;
  role: Role;
  companyId: string;
  /** `null` = alcance de empresa entera (ADMIN/OWNER) o usuario sin sucursal. */
  branchId: string | null;
  email: string;
  name: string;
}

/** Dueña de A. Ve la empresa entera. */
export const ownerA: SessionFixture = {
  id: "user-owner-a",
  role: "OWNER",
  companyId: EMPRESA_A,
  branchId: null,
  email: "owner@empresa-a.test",
  name: "Dueña A",
};

/** Admin de A. Ve la empresa entera, escribe pero no gestiona facturación. */
export const adminA: SessionFixture = {
  id: "user-admin-a",
  role: "ADMIN",
  companyId: EMPRESA_A,
  branchId: null,
  email: "admin@empresa-a.test",
  name: "Admin A",
};

/** Gerente de A, acotado a la sucursal 1. */
export const gerenteA1: SessionFixture = {
  id: "user-gerente-a1",
  role: "GERENTE",
  companyId: EMPRESA_A,
  branchId: SUCURSAL_A_1,
  email: "gerente@empresa-a.test",
  name: "Gerente A1",
};

/** Supervisor de A, acotado a la sucursal 2. */
export const supervisorA2: SessionFixture = {
  id: "user-supervisor-a2",
  role: "SUPERVISOR",
  companyId: EMPRESA_A,
  branchId: SUCURSAL_A_2,
  email: "supervisor@empresa-a.test",
  name: "Supervisor A2",
};

/**
 * Gerente de A **sin sucursal asignada**. Es el estado que `resolveBranchScope`
 * traduce a `NONE` (fallo cerrado): no ve la empresa entera ni una sucursal.
 */
export const gerenteA1SinSucursal: SessionFixture = {
  ...gerenteA1,
  id: "user-gerente-a1-sin-sucursal",
  branchId: null,
  name: "Gerente A1 sin sucursal",
};

/** Empleado de A. Acotado por rol, no tiene permisos de escritura de turnos. */
export const empleadoA1: SessionFixture = {
  id: EMPLEADO_A_1,
  role: "EMPLEADO",
  companyId: EMPRESA_A,
  branchId: SUCURSAL_A_1,
  email: "empleado@empresa-a.test",
  name: "Empleado A1",
};

/** Lectura únicamente. */
export const readonlyA: SessionFixture = {
  id: "user-readonly-a",
  role: "READONLY",
  companyId: EMPRESA_A,
  branchId: null,
  email: "readonly@empresa-a.test",
  name: "Lectura A",
};

/** Admin de B: para pruebas de alcance de empresa, el "otro tenant" por defecto. */
export const adminB: SessionFixture = {
  id: "user-admin-b",
  role: "ADMIN",
  companyId: EMPRESA_B,
  branchId: null,
  email: "admin@empresa-b.test",
  name: "Admin B",
};

/** Gerente de B, acotado a su sucursal. */
export const gerenteB1: SessionFixture = {
  id: "user-gerente-b1",
  role: "GERENTE",
  companyId: EMPRESA_B,
  branchId: SUCURSAL_B_1,
  email: "gerente@empresa-b.test",
  name: "Gerente B1",
};

/**
 * Todos los usuarios simulados, para las pruebas de matriz que recorren el rol
 * entero (p. ej. "ningún rol sin permiso lee turnos ajenos").
 */
export const usuarios: SessionFixture[] = [
  ownerA,
  adminA,
  gerenteA1,
  supervisorA2,
  empleadoA1,
  readonlyA,
  adminB,
  gerenteB1,
];

/** Turno de la empresa B: el objeto que A no debe leer, editar ni publicar. */
export function turnoDeEmpresaB(overrides: Partial<CreateShiftInput> = {}): CreateShiftInput {
  return {
    companyId: EMPRESA_B,
    userId: EMPLEADO_B_1,
    branchId: SUCURSAL_B_1,
    role: "COCINERO",
    shiftDate: "2026-03-16",
    startTime: "07:00",
    endTime: "15:00",
    ...overrides,
  };
}

/** Turno de la sucursal 1 de A, del empleado 1. */
export function turnoDeEmpresaA(overrides: Partial<CreateShiftInput> = {}): CreateShiftInput {
  return {
    companyId: EMPRESA_A,
    userId: EMPLEADO_A_1,
    branchId: SUCURSAL_A_1,
    role: "CAJERO",
    shiftDate: "2026-03-16",
    startTime: "07:00",
    endTime: "15:00",
    ...overrides,
  };
}

/** Fila de `planned_shifts` tal como la devuelve el driver (fechas como Date). */
export function filaDeShift(
  overrides: Partial<CreateShiftInput & { id: string }> = {}
): CreateShiftInput & { id: string; createdAt: Date; updatedAt: Date } {
  const base = turnoDeEmpresaA();
  return {
    ...base,
    id: "3000000-0000-4000-8000-000000000001",
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** `Shift` completo (fechas ya serializadas) para las aserciones de salida. */
export function shiftCompleto(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "3000000-0000-4000-8000-000000000001",
    companyId: EMPRESA_A,
    userId: EMPLEADO_A_1,
    userName: "",
    branchId: SUCURSAL_A_1,
    branchName: "",
    role: "CAJERO",
    shiftDate: "2026-03-16",
    startTime: "07:00",
    endTime: "15:00",
    status: "DRAFT",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}