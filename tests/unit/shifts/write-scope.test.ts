import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { plannedShiftService } from "@/lib/services/shift-service-extended";
import {
  hayExcepcionVigente,
  historialDeExcepcion,
} from "@/lib/security/policy-overrides";
import { ApiError } from "@/lib/api/error";
import {
  EMPLEADO_A_1,
  SUCURSAL_A_1,
  SUCURSAL_A_2,
  SUCURSAL_B_1,
  adminA,
  empleadoA1,
  filaDeShift,
  gerenteA1,
  turnoDeEmpresaA,
  turnoDeEmpresaB,
  type SessionFixture,
} from "../../fixtures/tenant-isolation";

/**
 * C02 — escrituras de turnos autorizadas (H01).
 *
 * Corre el servicio de verdad; lo único simulado es la base. El `WHERE` se
 * revisa traducido con `PgDialect.sqlToQuery` para que quitar el `company_id`
 * de una actualización o un borrado truene aquí en vez de en producción.
 *
 * El hilo de las pruebas es el mismo en todas: **lo que hace un actor de la
 * empresa A nunca toca, lee ni publica una fila de la empresa B**, aunque
 * mande su id, su `companyId` o el de un empleado de la otra empresa.
 */

vi.mock("@/lib/db", () => ({
  db: {
    query: { plannedShifts: { findMany: vi.fn() } },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// La tabla de excepciones se simula entera: lo que se prueba aquí es que el
// servicio **consulta** la excepción correcta y respeta la respuesta.
vi.mock("@/lib/security/policy-overrides", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/security/policy-overrides")>();
  return {
    ...real,
    hayExcepcionVigente: vi.fn(),
    historialDeExcepcion: vi.fn(),
  };
});

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

/**
 * `db.select().from().where().limit()` — la forma de `assertBranchOfCompany` y de
 * `assertEmployeeOfCompany`. Se configuran **por vez** porque las dos guardas
 * comparten la misma cadena y se ejecutan en el mismo orden: con un único
 * resultado, "la sucursal es válida" tapaba "el empleado no existe".
 */
function encadenarSelectPorVez(...resultados: unknown[][]) {
  const limit = vi.fn();
  for (const filas of resultados) limit.mockResolvedValueOnce(filas);
  // Por defecto "no existe": una consulta que no se ensayó no autoriza nada.
  limit.mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, limit };
}

/** Azúcar: sólo la existencia de una sucursal/empleado. */
function existe(id: string) {
  return [{ id }];
}

/** `db.insert(tabla).values({...}).returning()` */
function encadenarInsert(filas: unknown[]) {
  const returning = vi.fn().mockResolvedValue(filas);
  const values = vi.fn().mockReturnValue({ returning });
  vi.mocked(db.insert).mockReturnValue({ values } as never);
  return { values, returning };
}

/** `db.update(tabla).set({...}).where(...).returning()` */
function encadenarUpdate(filas: unknown[]) {
  const returning = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where, returning };
}

/** `db.delete(tabla).where(...)` */
function encadenarDelete() {
  const where = vi.fn().mockResolvedValue(undefined);
  vi.mocked(db.delete).mockReturnValue({ where } as never);
  return { where };
}

/** Condiciones que la última `where` recibió, traducidas. */
function whereDe(where: ReturnType<typeof encadenarUpdate>["where"]) {
  expect(where).toHaveBeenCalledTimes(1);
  return traducir(where.mock.calls[0][0]);
}

const TURNO_B = {
  id: "3000000-0000-4000-8000-0000000000bb",
  branchId: SUCURSAL_B_1,
  userId: "user-empleado-b1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.query.plannedShifts.findMany).mockResolvedValue([]);
  // Sin excepción por defecto: el comportamiento normal es la política.
  vi.mocked(hayExcepcionVigente).mockResolvedValue(false);
  vi.mocked(historialDeExcepcion).mockResolvedValue([] as never);
});

describe("createPlannedShift — la empresa sale de la sesión", () => {
  it("escribe con la empresa del actor aunque el cuerpo mande otra", async () => {
    // La pantalla activa manda `companyId: ""` (H03) y un cliente podría mandar
    // el de otra empresa: los dos se ignoran.
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    const { values } = encadenarInsert([filaDeShift()]);

    await plannedShiftService.createPlannedShift(actor(adminA), {
      ...turnoDeEmpresaA(),
      companyId: "empresa-ajena",
    });

    const enviado = values.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado.companyId).toBe(adminA.companyId);
    expect(enviado.companyId).not.toBe("empresa-ajena");
  });

  it("rechaza una sucursal de otra empresa antes de insertar", async () => {
    // `assertBranchOfCompany` no encuentra la sucursal: cero filas.
    encadenarSelectPorVez([]); // sucursal ajena
    const insert = encadenarInsert([filaDeShift()]);

    await expect(
      plannedShiftService.createPlannedShift(actor(adminA), turnoDeEmpresaB())
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("rechaza un empleado de otra empresa antes de insertar", async () => {
    encadenarSelectPorVez(existe(SUCURSAL_A_1), []); // sucursal sí es de A
    const insert = encadenarInsert([filaDeShift()]);

    await expect(
      plannedShiftService.createPlannedShift(actor(adminA),
        turnoDeEmpresaA({ userId: "user-empleado-b1" })
      )
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("un gerente no escribe en la sucursal de otro", async () => {
    encadenarSelectPorVez(existe(SUCURSAL_A_2), existe(EMPLEADO_A_1));
    const insert = encadenarInsert([filaDeShift()]);

    await expect(
      plannedShiftService.createPlannedShift(actor(gerenteA1),
        turnoDeEmpresaA({ branchId: SUCURSAL_A_2 })
      )
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("un rol sin permiso no escribe nada", async () => {
    const insert = encadenarInsert([filaDeShift()]);

    await expect(
      plannedShiftService.createPlannedShift(actor(empleadoA1), turnoDeEmpresaA())
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });
});

describe("createPlannedShift — la política de turnos es la autoridad (C09)", () => {
  it("rechaza un turno que se solapa con uno existente", async () => {
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    // El empleado ya tiene 07:00–15:00 ese día.
    vi.mocked(db.query.plannedShifts.findMany).mockResolvedValue([
      { ...filaDeShift(), id: "3000000-0000-4000-8000-000000000099", startTime: "07:00", endTime: "15:00" },
    ] as never);
    const insert = encadenarInsert([filaDeShift()]);

    await expect(
      plannedShiftService.createPlannedShift(
        actor(adminA),
        turnoDeEmpresaA({ startTime: "14:00", endTime: "22:00" })
      )
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("rechaza un turno de más de 12 horas", async () => {
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    const insert = encadenarInsert([filaDeShift()]);

    await expect(
      plannedShiftService.createPlannedShift(
        actor(adminA),
        turnoDeEmpresaA({ startTime: "06:00", endTime: "19:00" })
      )
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("rechaza un turno de 9 horas: la jornada de 8 h ya bloquea", async () => {
    // C09.1 lo dejó en advertencia porque cambiar qué acepta el sistema es
    // decisión del negocio. El negocio lo confirmó: ahora bloquea.
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    const insert = encadenarInsert([filaDeShift()]);

    await expect(
      plannedShiftService.createPlannedShift(
        actor(adminA),
        turnoDeEmpresaA({ startTime: "07:00", endTime: "16:00" })
      )
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("con una excepción auditada, el mismo turno de 9 horas sí se guarda", async () => {
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    encadenarInsert([filaDeShift()]);
    // Excepción viva para ese empleado en esa fecha de negocio.
    vi.mocked(hayExcepcionVigente).mockResolvedValue(true);
    vi.mocked(historialDeExcepcion).mockResolvedValue([
      {
        id: "override-1",
        companyId: adminA.companyId,
        branchId: null,
        domain: "SHIFT_VALIDATION",
        rule: "MAX_DAILY_HOURS",
        resourceType: "employee_day",
        resourceId: `${EMPLEADO_A_1}:2026-03-16`,
        grantedBy: adminA.id,
        reason: "Temporada alta con cierre doble",
        grantedAt: new Date("2026-10-01T00:00:00.000Z"),
        expiresAt: null,
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
      },
    ] as never);

    await expect(
      plannedShiftService.createPlannedShift(
        actor(adminA),
        turnoDeEmpresaA({ startTime: "07:00", endTime: "16:00" })
      )
    ).resolves.toBeDefined();

    // Y se pregunta por la empresa y el día del turno, no por un id suelto.
    expect(hayExcepcionVigente).toHaveBeenCalledWith(
      adminA.companyId,
      expect.objectContaining({
        domain: "SHIFT_VALIDATION",
        rule: "MAX_DAILY_HOURS",
        resourceId: `${EMPLEADO_A_1}:2026-03-16`,
      })
    );
  });

  it("una excepción de otra empresa no abre la jornada", async () => {
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    const insert = encadenarInsert([filaDeShift()]);
    vi.mocked(hayExcepcionVigente).mockResolvedValue(false);

    await expect(
      plannedShiftService.createPlannedShift(
        actor(adminA),
        turnoDeEmpresaA({ startTime: "07:00", endTime: "16:00" })
      )
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("la excepción de la jornada no perdona un turno de más de 12 horas", async () => {
    // La política decide por regla: una excepción para MAX_DAILY_HOURS no puede
    // perdonar MAX_SHIFT_MINUTES, que es otro límite con otro motivo.
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    const insert = encadenarInsert([filaDeShift()]);
    vi.mocked(hayExcepcionVigente).mockResolvedValue(true);
    vi.mocked(historialDeExcepcion).mockResolvedValue([] as never);

    await expect(
      plannedShiftService.createPlannedShift(
        actor(adminA),
        turnoDeEmpresaA({ startTime: "06:00", endTime: "19:00" })
      )
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("compara horas de verdad, no como cadenas", async () => {
    // El servicio anterior comparaba "07:00" < "9:00": en texto "9" > "0", así
    // que un turno de 9 a.m. se solapaba con uno de 7 a.m. sin solaparse.
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    encadenarInsert([filaDeShift()]);

    await expect(
      plannedShiftService.createPlannedShift(
        actor(adminA),
        turnoDeEmpresaA({ startTime: "09:00", endTime: "13:00" })
      )
    ).resolves.toBeDefined();
  });
});

describe("updatePlannedShift — el turno se carga dentro del alcance", () => {
  it("rechaza el turno de otra empresa sin ejecutar el UPDATE", async () => {
    // La carga acotada a la empresa no encuentra el id: 404 antes de escribir.
    const update = encadenarUpdate([]);

    await expect(
      plannedShiftService.updatePlannedShift(actor(adminA), TURNO_B.id, { notes: "x" })
    ).rejects.toBeInstanceOf(ApiError);

    expect(update.set).not.toHaveBeenCalled();
  });

  it("rechaza un turno de otra sucursal para un gerente acotado", async () => {
    vi.mocked(db.query.plannedShifts.findMany).mockResolvedValue([
      { ...filaDeShift(), id: TURNO_B.id, branchId: SUCURSAL_A_2 },
    ] as never);
    const update = encadenarUpdate([]);

    await expect(
      plannedShiftService.updatePlannedShift(actor(gerenteA1), TURNO_B.id, { notes: "x" })
    ).rejects.toBeInstanceOf(ApiError);

    expect(update.set).not.toHaveBeenCalled();
  });

  it("el UPDATE lleva company_id aunque la carga ya lo comprobara", async () => {
    vi.mocked(db.query.plannedShifts.findMany).mockResolvedValue([
      filaDeShift(),
    ] as never);
    const update = encadenarUpdate([filaDeShift({ notes: "nota" })]);

    await plannedShiftService.updatePlannedShift(actor(adminA), filaDeShift().id, {
      notes: "nota",
    });

    const { sql, params } = whereDe(update.where);
    expect(sql).toContain('"company_id" =');
    expect(params).toContain(adminA.companyId);
  });

  it("mover el turno a otra sucursal vuelve a validar esa sucursal", async () => {
    vi.mocked(db.query.plannedShifts.findMany).mockResolvedValue([
      filaDeShift(),
    ] as never);
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1)); // la sucursal destino sí es de A
    encadenarSelectPorVez([]); // la sucursal destino no pertenece a A
    const update = encadenarUpdate([]);

    await expect(
      plannedShiftService.updatePlannedShift(actor(adminA), filaDeShift().id, {
        branchId: SUCURSAL_B_1,
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(update.set).not.toHaveBeenCalled();
  });
});

describe("deletePlannedShift — borrar por id también es puerta", () => {
  it("un turno de otra empresa no se borra", async () => {
    const borrar = encadenarDelete();

    await expect(
      plannedShiftService.deletePlannedShift(actor(adminA), TURNO_B.id)
    ).rejects.toBeInstanceOf(ApiError);

    expect(borrar.where).not.toHaveBeenCalled();
  });

  it("el DELETE lleva company_id e id", async () => {
    vi.mocked(db.query.plannedShifts.findMany).mockResolvedValue([
      filaDeShift(),
    ] as never);
    const borrar = encadenarDelete();

    await plannedShiftService.deletePlannedShift(actor(adminA), filaDeShift().id);

    const { sql, params } = whereDe(borrar.where);
    expect(sql).toContain('"company_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain(adminA.companyId);
  });
});

describe("publishShifts — el lote se valida completo o no se toca", () => {
  it("un solo id ajeno invalida el lote entero", async () => {
    // Publicar la mitad y dejar la otra parada no es un estado que el operador
    // pueda entender ni corregir desde la pantalla.
    vi.mocked(db.query.plannedShifts.findMany).mockResolvedValue([
      { ...filaDeShift(), id: "3000000-0000-4000-8000-000000000001" },
    ] as never);
    const update = encadenarUpdate([]);

    await expect(
      plannedShiftService.publishShifts(actor(adminA), [
        "3000000-0000-4000-8000-000000000001",
        TURNO_B.id,
      ])
    ).rejects.toBeInstanceOf(ApiError);

    expect(update.set).not.toHaveBeenCalled();
  });

  it("publica sólo filas de la empresa del actor", async () => {
    vi.mocked(db.query.plannedShifts.findMany).mockResolvedValue([
      { ...filaDeShift(), id: "3000000-0000-4000-8000-000000000001" },
      { ...filaDeShift(), id: "3000000-0000-4000-8000-000000000002" },
    ] as never);
    const update = encadenarUpdate([]);

    await plannedShiftService.publishShifts(actor(adminA), [
      "3000000-0000-4000-8000-000000000001",
      "3000000-0000-4000-8000-000000000002",
    ]);

    const { sql, params } = whereDe(update.where);
    expect(sql).toContain('"company_id" =');
    expect(params).toContain(adminA.companyId);
  });

  it("un rol sin permiso no publica", async () => {
    const update = encadenarUpdate([]);

    await expect(
      plannedShiftService.publishShifts(actor(empleadoA1), [filaDeShift().id])
    ).rejects.toBeInstanceOf(ApiError);

    expect(update.set).not.toHaveBeenCalled();
  });
});

describe("duplicateShifts — copiar no puede cambiar de empresa", () => {
  it("duplicar un turno de otra empresa no crea nada", async () => {
    const update = encadenarUpdate([]);
    const insert = encadenarInsert([]);

    await expect(
      plannedShiftService.duplicateShifts(actor(adminA), [TURNO_B.id], {
        targetWeekStart: new Date("2026-03-23T00:00:00.000Z"),
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
    expect(update.set).not.toHaveBeenCalled();
  });

  it("cada copia vuelve a pasar por la puerta de creación", async () => {
    // findMany responde tres veces en este recorrido: la puerta de alcance, la
    // lectura de las filas a duplicar y —dentro de la copia— el solapamiento.
    // La última va vacía o la copia se rechazaría contra sí misma.
    vi.mocked(db.query.plannedShifts.findMany)
      .mockResolvedValueOnce([
        { ...filaDeShift(), id: "3000000-0000-4000-8000-000000000001" },
      ] as never)
      .mockResolvedValueOnce([
        { ...filaDeShift(), id: "3000000-0000-4000-8000-000000000001" },
      ] as never)
      .mockResolvedValue([] as never);
    encadenarSelectPorVez(existe(SUCURSAL_A_1), existe(EMPLEADO_A_1));
    const insert = encadenarInsert([filaDeShift()]);

    await plannedShiftService.duplicateShifts(actor(adminA), [
      "3000000-0000-4000-8000-000000000001",
    ], { targetWeekStart: new Date("2026-03-23T00:00:00.000Z") });

    // La copia se escribe con la empresa del actor y vuelve a validar destino,
    // en vez de confiar en los campos de la fila original.
    expect(insert.values).toHaveBeenCalledTimes(1);
    const enviado = insert.values.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado.companyId).toBe(adminA.companyId);
    expect(enviado.branchId).toBe(SUCURSAL_A_1);
  });
});