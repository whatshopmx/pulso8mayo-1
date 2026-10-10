import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/tenant-context";
import {
  alcanceDeListado,
  assertSesionOperable,
  assertSucursalDestino,
  requireAttendanceAccess,
} from "@/lib/labor/attendance-scope";
import { GET as sesionesGet } from "@/app/api/shift-sessions/route";
import {
  SUCURSAL_A_1,
  SUCURSAL_A_2,
  SUCURSAL_B_1,
  adminA,
  empleadoA1,
  gerenteA1,
  gerenteA1SinSucursal,
  type SessionFixture,
} from "../../fixtures/tenant-isolation";

/**
 * C06 — sesiones de turno y descansos acotados a la empresa del actor (H02).
 *
 * `GET /api/shift-sessions` llamaba a `requireTenant()`, recibía la empresa de
 * la sesión y **no la usaba en la consulta**: sin filtros devolvía las sesiones
 * de todas las empresas. `GET /api/labor/breaks/status` ni siquiera pedía
 * empresa. `PUT /api/shift-sessions` cargaba la sesión por id y escribía.
 *
 * `shift_sessions` no tiene columna de empresa —cuelga de `branch_id`—, así que
 * el filtro de empresa se traduce a "las sucursales de esta empresa". Eso es lo
 * que comprueban estas pruebas sobre el SQL realmente enviado a Postgres.
 */

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    query: { shiftSessions: { findMany: vi.fn() } },
  },
}));

vi.mock("@/lib/tenant-context", () => ({ requireAuth: vi.fn() }));

const dialect = new PgDialect();

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

function sesion(de: SessionFixture) {
  vi.mocked(requireAuth).mockResolvedValue({
    user: {
      id: de.id,
      role: de.role,
      companyId: de.companyId,
      branchId: de.branchId,
      email: de.email,
    },
    session: { id: "sesion" },
  } as never);
}

/** `db.select().from().where().limit()` — `assertBranchOfCompany`. */
function encadenarSelect(filas: unknown[]) {
  const limit = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, limit };
}

/** Petición GET con la query que se quiera probar. */
function peticion(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/shift-sessions${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  sesion(adminA);
  vi.mocked(db.query.shiftSessions.findMany).mockResolvedValue([]);
});

describe("requireAttendanceAccess", () => {
  it("toma empresa y sucursal de la sesión", async () => {
    sesion(gerenteA1);
    const actorDeAsistencia = await requireAttendanceAccess();

    expect(actorDeAsistencia.companyId).toBe(gerenteA1.companyId);
    expect(actorDeAsistencia.branchId).toBe(SUCURSAL_A_1);
  });

  it("cierra a un rol sin acceso al módulo de turnos", async () => {
    sesion(empleadoA1);
    await expect(requireAttendanceAccess()).rejects.toBeTruthy();
  });
});

describe("alcanceDeListado — la empresa va siempre en la consulta", () => {
  it("sin filtros, limita a las sucursales de esta empresa", async () => {
    // `shift_sessions` no guarda empresa: el filtro es un subselect sobre
    // `branches`, así que la empresa se comprueba donde se declara —dentro del
    // subselect— y no en la condición exterior.
    const subselect = encadenarSelect([]);

    const condicion = await alcanceDeListado(actor(adminA));
    const { sql } = traducir(condicion);

    expect(sql).toContain('"branch_id" in');

    const sub = traducir(subselect.where.mock.calls[0][0]);
    expect(sub.sql).toContain('"company_id" =');
    expect(sub.params).toContain(adminA.companyId);
  });

  it("acota a la sucursal de la sesión cuando el rol es de sucursal", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    const condicion = await alcanceDeListado(actor(gerenteA1));
    const { sql, params } = traducir(condicion);

    expect(sql).toContain('"branch_id" =');
    expect(params).toContain(SUCURSAL_A_1);
    expect(params).not.toContain(SUCURSAL_A_2);
  });

  it("ignora la sucursal pedida cuando el rol está acotado a la suya", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    const condicion = await alcanceDeListado(actor(gerenteA1), SUCURSAL_A_2);
    const { params } = traducir(condicion);

    expect(params).toContain(SUCURSAL_A_1);
    expect(params).not.toContain(SUCURSAL_A_2);
  });

  it("una sucursal pedida que no es de la empresa se rechaza antes de listar", async () => {
    encadenarSelect([]); // la sucursal no aparece en esta empresa

    await expect(alcanceDeListado(actor(adminA), SUCURSAL_B_1)).rejects.toBeTruthy();
  });

  it("un rol acotado sin sucursal falla cerrado, no devuelve vacío", async () => {
    const select = encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(alcanceDeListado(actor(gerenteA1SinSucursal))).rejects.toBeTruthy();
    // "Sin filtro" y "cero filas" se leen igual en la pantalla; el rechazo
    // dice la causa.
    expect(select.from).not.toHaveBeenCalled();
  });
});

describe("assertSesionOperable / assertSucursalDestino — la escritura", () => {
  it("un gerente no modifica la sesión de otra sucursal", async () => {
    encadenarSelect([]);

    await expect(
      assertSesionOperable(actor(gerenteA1), {
        id: "sesion-1",
        branchId: SUCURSAL_A_2,
      })
    ).rejects.toBeTruthy();
  });

  it("un gerente sí modifica la sesión de su sucursal", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      assertSesionOperable(actor(gerenteA1), {
        id: "sesion-1",
        branchId: SUCURSAL_A_1,
      })
    ).resolves.toBeUndefined();
  });

  it("un admin no abre sesión en la sucursal de otra empresa", async () => {
    encadenarSelect([]);

    await expect(
      assertSucursalDestino(actor(adminA), SUCURSAL_B_1)
    ).rejects.toBeTruthy();
  });

  it("un gerente acotado no abre sesión en otra sucursal", async () => {
    const select = encadenarSelect([{ id: SUCURSAL_A_2 }]);

    await expect(
      assertSucursalDestino(actor(gerenteA1), SUCURSAL_A_2)
    ).rejects.toBeTruthy();
    expect(select.from).not.toHaveBeenCalled();
  });
});

describe("GET /api/shift-sessions — la ruta con su status", () => {
  it("sin filtros, la consulta lleva la empresa", async () => {
    const subselect = encadenarSelect([]);
    const findMany = vi.mocked(db.query.shiftSessions.findMany);

    const res = await sesionesGet(peticion());

    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(1);

    const args = findMany.mock.calls[0][0] as { where: unknown };
    const { sql } = traducir(args.where);
    expect(sql).toContain('"branch_id" in');

    const sub = traducir(subselect.where.mock.calls[0][0]);
    expect(sub.sql).toContain('"company_id" =');
    expect(sub.params).toContain(adminA.companyId);
  });

  it("la where ya no puede quedar sin condiciones", async () => {
    // Antes era `conditions.length > 0 ? and(...conditions) : undefined`: sin
    // filtros, `undefined` significaba "la tabla entera".
    const findMany = vi.mocked(db.query.shiftSessions.findMany);

    await sesionesGet(peticion());

    const args = findMany.mock.calls[0][0] as { where: unknown };
    expect(args.where).toBeDefined();
  });

  it("un userId ajeno no aparece en el resultado ni se rechaza con 403", async () => {
    const subselect = encadenarSelect([]);
    const findMany = vi.mocked(db.query.shiftSessions.findMany);

    const res = await sesionesGet(peticion("?userId=user-empleado-b1"));

    // Ni 403 (confirmaría que ese empleado tiene sesión en algún sitio) ni
    // filas ajenas: el id simplemente no coincide con lo ya acotado.
    expect(res.status).toBe(200);

    const args = findMany.mock.calls[0][0] as { where: unknown };
    const { sql, params } = traducir(args.where);
    expect(sql).toContain('"user_id" =');
    expect(params).toContain("user-empleado-b1");
    // Y el filtro de empresa sigue ahí: el userId no lo sustituye.
    expect(sql).toContain('"branch_id" in');
    const sub = traducir(subselect.where.mock.calls[0][0]);
    expect(sub.params).toContain(adminA.companyId);
  });

  it("un rol sin sucursal recibe 403 y no consulta", async () => {
    sesion(gerenteA1SinSucursal);
    const findMany = vi.mocked(db.query.shiftSessions.findMany);

    const res = await sesionesGet(peticion());

    expect(res.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("un rol sin permiso recibe 403", async () => {
    sesion(empleadoA1);
    const findMany = vi.mocked(db.query.shiftSessions.findMany);

    const res = await sesionesGet(peticion());

    expect(res.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });
});