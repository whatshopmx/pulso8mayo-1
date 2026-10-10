import { describe, expect, it } from "vitest";

import {
  ROLES_TURNOS,
  assertCanAccessShifts,
  assertShiftScopeCoversBranch,
  resolveShiftScope,
  shiftScopeCoversBranch,
} from "@/lib/labor/shift-access";
import { ApiError } from "@/lib/api/error";
import {
  adminA,
  adminB,
  empleadoA1,
  gerenteA1,
  gerenteA1SinSucursal,
  readonlyA,
  supervisorA2,
  type SessionFixture,
} from "../../fixtures/tenant-isolation";

/**
 * C01 — alcance del actor sobre turnos (`lib/labor/shift-access.ts`).
 *
 * Esta es la capa pura: decide qué filas puede leer y a qué recurso puede
 * escribir, sin tocar Postgres. Lo que la consume es `plannedShiftService`
 * (`lib/services/shift-service-extended.ts`), que se prueba aparte en
 * `read-scope.test.ts` con el `WHERE` traducido.
 *
 * Los actores vienen de `tests/fixtures/tenant-isolation.ts`: dos empresas, sin
 * datos de producción. Si aquí se rompe algo, la regla cambió.
 */

/** Actores de la sesión (`requireAuth`) tal como los entrega el servidor. */
function actor(de: SessionFixture) {
  return {
    userId: de.id,
    role: de.role,
    companyId: de.companyId,
    branchId: de.branchId,
  };
}

/** Captura el `ApiError` que lanza una guarda, para revisar status y mensaje. */
function capturarError(accion: () => void): ApiError {
  try {
    accion();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("Se esperaba un ApiError y la operación no lanzó nada.");
}

describe("assertCanAccessShifts — puerta por sesión y rol", () => {
  it("deja pasar a la gerencia de la operación", () => {
    for (const sesion of [gerenteA1, supervisorA2, adminA]) {
      expect(() => assertCanAccessShifts(actor(sesion))).not.toThrow();
    }
  });

  it("cierra a EMPLEADO y READONLY aunque su sucursal sea real", () => {
    const error = capturarError(() => assertCanAccessShifts(actor(empleadoA1)));
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain("no tiene acceso");
  });

  it("cierra a READONLY", () => {
    expect(capturarError(() => assertCanAccessShifts(actor(readonlyA))).statusCode).toBe(403);
  });

  it("cierra a un usuario sin empresa: no hay contra qué acotar", () => {
    const sinEmpresa = { ...actor(adminA), companyId: "" };
    const error = capturarError(() => assertCanAccessShifts(sinEmpresa));
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain("empresa asignada");
  });

  it("la lista de roles coincide con la ruta del dashboard", () => {
    // Si alguien cambia ROLES_TURNOS, la pantalla y el servidor dejan de
    // contar la misma historia. `/dashboard/labor/shifts` es la declaración de
    // producto; esta lista es su reflejo en el servidor.
    expect([...ROLES_TURNOS].sort()).toEqual(
      ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"].sort()
    );
  });
});

describe("resolveShiftScope — alcance de sucursal", () => {
  it("un rol acotado ve sólo su sucursal aunque pida otra", () => {
    expect(resolveShiftScope(actor(gerenteA1))).toEqual({
      kind: "BRANCH",
      branchId: gerenteA1.branchId,
    });
    expect(resolveShiftScope(actor(gerenteA1), "otra-sucursal-cualquiera")).toEqual({
      kind: "BRANCH",
      branchId: gerenteA1.branchId,
    });
  });

  it("un rol acotado sin sucursal asignada da NONE, no ALL", () => {
    // El fallo abierto de H01: un GERENTE sin sucursal terminaba viendo el
    // grupo entero porque su `null` se leía como "sin filtro".
    expect(resolveShiftScope(actor(gerenteA1SinSucursal))).toEqual({ kind: "NONE" });
  });

  it("un rol de empresa ve la empresa entera si no pide sucursal", () => {
    expect(resolveShiftScope(actor(adminA))).toEqual({ kind: "ALL" });
  });

  it("un rol de empresa se acota a la sucursal que pide", () => {
    expect(resolveShiftScope(actor(adminA), "sucursal-2")).toEqual({
      kind: "BRANCH",
      branchId: "sucursal-2",
    });
  });

  it("un id vacío o con espacios se trata como 'no pedida'", () => {
    // `?branchId=%20` llegaba como cadena no vacía y se colaba por la rama
    // "sin filtro" del consumidor.
    expect(resolveShiftScope(actor(adminA), "   ")).toEqual({ kind: "ALL" });
    expect(resolveShiftScope(actor(adminA), "")).toEqual({ kind: "ALL" });
  });

  it("el alcance de la otra empresa no se puede pedir para abrirse eluyo", () => {
    // Pedir la sucursal de B no da acceso a B: el alcance se acota por sesión y
    // el filtro de empresa lo aplica el servicio.
    expect(resolveShiftScope(actor(adminB), "sucursal-de-a")).toEqual({
      kind: "BRANCH",
      branchId: "sucursal-de-a",
    });
  });
});

describe("shiftScopeCoversBranch — predicado puro", () => {
  it("ALL cubre cualquier sucursal; NONE no cubre ninguna", () => {
    expect(shiftScopeCoversBranch({ kind: "ALL" }, "cualquiera")).toBe(true);
    expect(shiftScopeCoversBranch({ kind: "NONE" }, "cualquiera")).toBe(false);
    expect(shiftScopeCoversBranch({ kind: "NONE" }, null)).toBe(false);
  });

  it("BRANCH cubre sólo la suya", () => {
    const scope = { kind: "BRANCH", branchId: "a1" } as const;
    expect(shiftScopeCoversBranch(scope, "a1")).toBe(true);
    expect(shiftScopeCoversBranch(scope, "a2")).toBe(false);
    expect(shiftScopeCoversBranch(scope, null)).toBe(false);
  });
});

describe("assertShiftScopeCoversBranch — puerta por recurso", () => {
  it("ALL deja pasar cualquier sucursal", () => {
    expect(() =>
      assertShiftScopeCoversBranch({ kind: "ALL" }, "la-que-sea")
    ).not.toThrow();
  });

  it("BRANCH rechaza una sucursal ajena con 403", () => {
    const error = capturarError(() =>
      assertShiftScopeCoversBranch({ kind: "BRANCH", branchId: "a1" }, "a2")
    );
    expect(error.statusCode).toBe(403);
    // El mensaje no distingue "no es tuya" de "no existe": confirmar la
    // existencia de una sucursal ajena ya es filtrar.
    expect(error.message).not.toContain("no existe");
  });

  it("NONE rechaza incluso la sucursal que el recurso declara", () => {
    const error = capturarError(() =>
      assertShiftScopeCoversBranch({ kind: "NONE" }, "a1")
    );
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain("sucursal asignada");
  });
});