import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { plannedShiftService } from "@/lib/services/shift-service-extended";
import { ApiError } from "@/lib/api/error";
import { getShifts } from "@/app/actions/shifts";
import { requireAuth } from "@/lib/tenant-context";
import {
  SUCURSAL_A_1,
  SUCURSAL_A_2,
  adminA,
  empleadoA1,
  gerenteA1,
  gerenteA1SinSucursal,
  type SessionFixture,
} from "../../fixtures/tenant-isolation";

/**
 * C01 — lectura de turnos acotada a la empresa y a la sucursal del actor (H01).
 *
 * El servicio corre de verdad: lo único simulado es la base y la sesión. El
 * `WHERE` se revisa con `PgDialect.sqlToQuery`, la traducción que Drizzle hace
 * para hablar con Postgres, en vez de leer el código y confiar: si alguien
 * vuelve a quitar el `company_id` de las condiciones, esta suite truena.
 *
 * La última parte llama a la acción real con la sesión simulada, para probar la
 * barrera que no vive en el servicio: que la acción derive el actor de la
 * sesión y no del cuerpo de la petición.
 */

vi.mock("@/lib/db", () => ({
  db: { query: { plannedShifts: { findMany: vi.fn() } } },
}));

vi.mock("@/lib/tenant-context", () => ({ requireAuth: vi.fn() }));

const dialect = new PgDialect();

/** Traduce una condición capturada al SQL que Postgres recibiría. */
function traducir(condicion: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condicion as never);
}

function actor(de: SessionFixture) {
  return {
    userId: de.id,
    role: de.role,
    companyId: de.companyId,
    branchId: de.branchId,
  };
}

/**
 * Deja `findMany` resolviendo `filas` y devuelve el mismo espía, para poder
 * inspeccionar después el `where` con el que lo llamaron. Se conecta con
 * `mockImplementation` y no con `mockReturnValue`: el servicio hace `await`, y
 * una función devuelta no es thenable — `await` la devolvería entera.
 */
function capturarConsulta(filas: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(filas);
  vi.mocked(db.query.plannedShifts.findMany).mockImplementation(findMany);
  return findMany;
}

/** El SQL real de la consulta que el servicio construyó. */
function whereDe(findMany: ReturnType<typeof capturarConsulta>) {
  expect(findMany).toHaveBeenCalledTimes(1);
  const args = findMany.mock.calls[0][0] as { where: unknown };
  return traducir(args.where);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPlannedShifts — filtros vacíos", () => {
  it("siempre filtra por la empresa del actor, sin importar lo que pida el cliente", async () => {
    const findMany = capturarConsulta();

    await plannedShiftService.getPlannedShifts(actor(adminA), {});

    const { sql, params } = whereDe(findMany);
    expect(sql).toContain('"company_id" =');
    expect(params).toContain(adminA.companyId);
  });

  it("el filtro de sucursal no sustituye al de empresa", async () => {
    // Pedir una sucursal acota *dentro* de la empresa de la sesión: el `WHERE`
    // lleva las dos columnas, no una u otra.
    const findMany = capturarConsulta();

    await plannedShiftService.getPlannedShifts(actor(adminA), {
      branchId: SUCURSAL_A_2,
    });

    const { sql, params } = whereDe(findMany);
    expect(sql).toContain('"company_id" =');
    expect(sql).toContain('"branch_id" =');
    expect(params).toContain(adminA.companyId);
    expect(params).toContain(SUCURSAL_A_2);
  });

  it("rechaza a un rol sin permiso antes de consultar la base", async () => {
    const findMany = capturarConsulta();

    await expect(
      plannedShiftService.getPlannedShifts(actor(empleadoA1), {})
    ).rejects.toBeInstanceOf(ApiError);

    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("getPlannedShifts — alcance de sucursal", () => {
  it("un gerente ve su sucursal aunque pida otra", async () => {
    const findMany = capturarConsulta();

    await plannedShiftService.getPlannedShifts(actor(gerenteA1), {
      branchId: SUCURSAL_A_2,
    });

    const { sql, params } = whereDe(findMany);
    expect(sql).toContain('"branch_id" =');
    // Pidió A2, se quedó filtrando A1: la sucursal pedida es intención.
    expect(params).toContain(SUCURSAL_A_1);
    expect(params).not.toContain(SUCURSAL_A_2);
  });

  it("un admin ve la empresa entera si no pide sucursal", async () => {
    const findMany = capturarConsulta();

    await plannedShiftService.getPlannedShifts(actor(adminA), {});

    const { sql } = whereDe(findMany);
    expect(sql).toContain('"company_id" =');
    expect(sql).not.toContain('"branch_id" =');
  });

  it("un gerente sin sucursal asignada recibe cero filas sin consultar", async () => {
    const findMany = capturarConsulta();

    const resultado = await plannedShiftService.getPlannedShifts(
      actor(gerenteA1SinSucursal),
      {}
    );

    expect(resultado).toEqual([]);
    // `NONE` es "no lee nada", no "sin filtro": consultar sería volver a abrir
    // el alcance que `resolveBranchScope` acaba de cerrar.
    expect(findMany).not.toHaveBeenCalled();
  });

  it("el resto de filtros se suman al alcance, no lo sustituyen", async () => {
    const findMany = capturarConsulta();

    await plannedShiftService.getPlannedShifts(actor(gerenteA1), {
      employeeId: "user-empleado-a1",
      role: "CAJERO",
      startDate: "2026-03-16",
      endDate: "2026-03-22",
    });

    const { sql, params } = whereDe(findMany);
    for (const columna of ['"company_id"', '"branch_id"', '"user_id"', '"role"']) {
      expect(sql, columna).toContain(columna);
    }
    expect(params).toContain("2026-03-16");
    expect(params).toContain("2026-03-22");
  });
});

describe("getShifts (acción de servidor) — el actor sale de la sesión", () => {
  it("rechaza sin sesión antes de llegar al servicio", async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      new ApiError("No session found. Please sign in.", 401)
    );
    const findMany = capturarConsulta();

    await expect(getShifts({})).rejects.toBeInstanceOf(ApiError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("ignora cualquier empresa que llegue en los filtros y usa la de la sesión", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      user: {
        id: adminA.id,
        role: adminA.role,
        companyId: adminA.companyId,
        branchId: adminA.branchId,
        email: adminA.email,
      },
      session: { id: "sesion" },
    } as never);

    const findMany = capturarConsulta();

    // El cliente intenta colarse por los filtros; `ShiftFilters` ni siquiera
    // tiene `companyId`, así que la única empresa posible es la de la sesión.
    await getShifts({ employeeId: "user-empleado-a1" });

    const { params } = whereDe(findMany);
    expect(params).toContain(adminA.companyId);
  });
});