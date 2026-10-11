import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/tenant-context";
import { getSchedulerCatalog } from "@/app/actions/shifts";
import {
  adminA,
  empleadoA1,
  gerenteA1,
  gerenteA1SinSucursal,
} from "../../fixtures/tenant-isolation";

/**
 * C08.1 — el catálogo del planificador sale de la empresa del actor (H03).
 *
 * `ShiftSchedulerContainer` traía `MOCK_BRANCHES`, `MOCK_EMPLOYEES` y
 * `MOCK_ROLES` como arrays fijos y los pintaba como conteos reales, mientras la
 * matriz los pasaba a un editor que guardaba contra la base. Con C02 el
 * servidor ya rechaza esos ids, así que la pantalla tenía que dejar de
 * inventarlos: aquí se comprueba que la consulta lleva empresa y alcance.
 *
 * `roles` no es una lista inventada: son los puestos capturados en
 * `employee_profiles.position` más los roles que ya usan los turnos de la
 * empresa. Sin ese dato, la lista sale vacía y el operador lo ve.
 */

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    selectDistinct: vi.fn(),
  },
}));

vi.mock("@/lib/tenant-context", () => ({ requireAuth: vi.fn() }));

const dialect = new PgDialect();

function traducir(condicion: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condicion as never);
}

/**
 * Cadenas de consulta por llamada.
 *
 * El builder encadena las tres consultas seguidas —sucursales, empleados y
 * roles— así que `db.select` tiene que devolver una forma distinta en cada
 * llamada. Instalar un único simulacro hacía que la consulta de sucursales
 * recibiera la cadena de empleados y fallara con "where is not a function".
 */

/** `db.select().from().where().orderBy()` — consulta de sucursales. */
function cadenaDeSucursales(filas: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  return { from, where, orderBy };
}

/** `db.select().from().leftJoin().where().orderBy()` — consulta de empleados. */
function cadenaDeEmpleados(filas: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ orderBy });
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ leftJoin });
  return { from, leftJoin, where, orderBy };
}

/** `db.selectDistinct().from().where()` — roles ya usados. */
function cadenaDeRoles(filas: unknown[]) {
  const where = vi.fn().mockResolvedValue(filas);
  const from = vi.fn().mockReturnValue({ where });
  return { from, where };
}

/** Instala las cadenas en el orden en que el builder las va a pedir. */
function encolarCadenas(cadenas: Array<Record<string, unknown>>) {
  let i = 0;
  vi.mocked(db.select).mockImplementation(
    () => cadenas[i++] as unknown as ReturnType<typeof db.select>
  );
}

function sesion(de: typeof adminA) {
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

beforeEach(() => {
  vi.clearAllMocks();
  sesion(adminA);
});

describe("getSchedulerCatalog — alcance", () => {
  it("un admin ve todas las sucursales de su empresa, filtradas por company_id", async () => {
    const sucursales = cadenaDeSucursales([{ id: "b1", name: "Condesa" }]);
    encolarCadenas([sucursales, cadenaDeEmpleados([])]);
    vi.mocked(db.selectDistinct).mockReturnValue(cadenaDeRoles([]) as never);

    await getSchedulerCatalog();

    const { sql, params } = traducir(sucursales.where.mock.calls[0][0]);
    expect(sql).toContain('"company_id" =');
    expect(params).toContain(adminA.companyId);
  });

  it("un gerente ve sólo su sucursal y sus empleados", async () => {
    sesion(gerenteA1);
    const sucursales = cadenaDeSucursales([{ id: "b1", name: "Condesa" }]);
    const empleados = cadenaDeEmpleados([]);
    encolarCadenas([sucursales, empleados]);
    vi.mocked(db.selectDistinct).mockReturnValue(cadenaDeRoles([]) as never);

    const catalogo = await getSchedulerCatalog();

    const condSucursal = traducir(sucursales.where.mock.calls[0][0]);
    expect(condSucursal.sql).toContain('"id" =');
    expect(condSucursal.params).toContain(gerenteA1.branchId);

    const condEmpleados = traducir(empleados.where.mock.calls[0][0]);
    expect(condEmpleados.sql).toContain('"company_id" =');
    expect(condEmpleados.sql).toContain('"branch_id" =');
    expect(condEmpleados.params).toContain(empleadoA1.branchId);
    expect(catalogo.branches).toHaveLength(1);
  });

  it("un gerente sin sucursal no consulta y avisa de que no tiene alcance", async () => {
    sesion(gerenteA1SinSucursal);

    const catalogo = await getSchedulerCatalog();

    // "No hay sucursales" y "no tienes sucursal asignada" se ven igual en
    // pantalla; `sinAlcance` es lo que las distingue.
    expect(catalogo).toEqual({
      branches: [],
      employees: [],
      roles: [],
      sinAlcance: true,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("un rol sin permiso recibe el rechazo de la puerta", async () => {
    sesion(empleadoA1);
    const select = db.select as unknown as ReturnType<typeof vi.fn>;

    await expect(getSchedulerCatalog()).rejects.toBeTruthy();
    expect(select).not.toHaveBeenCalled();
  });
});

describe("getSchedulerCatalog — el contenido viene de datos, no de mocks", () => {
  it("los roles son los puestos capturados más los que ya usan los turnos", async () => {
    encolarCadenas([
      cadenaDeSucursales([{ id: "b1", name: "Condesa" }]),
      cadenaDeEmpleados([
        { id: "u1", name: "Ana", branchId: "b1", position: "Cocinera" },
        { id: "u2", name: "Luis", branchId: "b1", position: null },
        { id: "u3", name: "Sara", branchId: "b1", position: "  Cajera " },
      ]),
    ]);
    vi.mocked(db.selectDistinct).mockReturnValue(
      cadenaDeRoles([{ role: "MESERO" }, { role: "Cocinera" }]) as never
    );

    const catalogo = await getSchedulerCatalog();

    // Sin duplicados por mayúsculas ni espacios, y sin inventar roles.
    expect(catalogo.roles).toEqual(["Cajera", "Cocinera", "MESERO"]);
  });

  it("una empresa sin puestos capturados entrega roles vacíos, no una lista inventada", async () => {
    encolarCadenas([
      cadenaDeSucursales([{ id: "b1", name: "Condesa" }]),
      cadenaDeEmpleados([{ id: "u1", name: "Ana", branchId: "b1", position: null }]),
    ]);
    vi.mocked(db.selectDistinct).mockReturnValue(cadenaDeRoles([]) as never);

    const catalogo = await getSchedulerCatalog();

    expect(catalogo.roles).toEqual([]);
    expect(catalogo.employees).toHaveLength(1);
  });

  it("los empleados salen con nombre y puesto, nunca con id como nombre", async () => {
    encolarCadenas([
      cadenaDeSucursales([{ id: "b1", name: "Condesa" }]),
      cadenaDeEmpleados([{ id: "u1", name: null, branchId: "b1", position: "Cajera" }]),
    ]);
    vi.mocked(db.selectDistinct).mockReturnValue(cadenaDeRoles([]) as never);

    const catalogo = await getSchedulerCatalog();

    // Un empleado sin nombre se muestra por su id, que es mejor que un "null"
    // en la pantalla — pero el id es de la base, no el "1" del mock.
    expect(catalogo.employees[0]).toEqual({
      id: "u1",
      name: "u1",
      position: "Cajera",
      branchId: "b1",
    });
  });
});