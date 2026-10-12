import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { shiftTemplateService } from "@/lib/services/shift-template-service";
import type { BulkShiftOperation } from "@/lib/types/shifts";
import { hayExcepcionVigente, historialDeExcepcion } from "@/lib/security/policy-overrides";
import { adminA, empleadoA1, gerenteA1, gerenteA1SinSucursal, EMPRESA_A, EMPLEADO_A_1, EMPLEADO_A_2, EMPLEADO_B_1, SUCURSAL_A_1, SUCURSAL_A_2, SUCURSAL_B_1, filaDeShift } from "../../fixtures/tenant-isolation";

vi.mock("@/lib/db", () => ({ db: {
  select: vi.fn(), insert: vi.fn(), transaction: vi.fn(), query: { plannedShifts: { findMany: vi.fn() } },
} }));
vi.mock("@/lib/security/policy-overrides", () => ({
  hayExcepcionVigente: vi.fn(), historialDeExcepcion: vi.fn(),
}));

const actor = (user = adminA) => ({ userId: user.id, ...user });
const operation = (changes: Partial<BulkShiftOperation> = {}): BulkShiftOperation => ({
  branchId: SUCURSAL_A_1, role: "CAJERO", employeeIds: [EMPLEADO_A_1],
  startDate: "2026-10-05", endDate: "2026-10-06", pattern: "daily", shiftType: "MATUTINO", ...changes,
});
let stored: ReturnType<typeof filaDeShift>[];
const dialect = new PgDialect();

beforeEach(() => {
  vi.clearAllMocks(); stored = [];
  // Adaptador de transacciones: execute simula el bloqueo de PostgreSQL por
  // clave. Las consultas e inserts siguen usando los servicios/política reales.
  const locks = new Map<string, Promise<void>>();
  vi.mocked(db.transaction).mockImplementation(async (callback) => {
    let release: (() => void) | undefined;
    const tx = { ...db, execute: async (statement: never) => {
      const query = dialect.sqlToQuery(statement);
      expect(query.sql).toContain("pg_advisory_xact_lock");
      const key = String(query.params[0]);
      expect(JSON.parse(key)).toEqual(["shift-batch", EMPRESA_A, expect.any(String)]);
      const previous = locks.get(key) ?? Promise.resolve();
      locks.set(key, new Promise<void>((resolve) => { release = resolve; }));
      await previous;
    } };
    try { return await callback(tx as never); }
    finally { release?.(); }
  });
  vi.mocked(hayExcepcionVigente).mockResolvedValue(false);
  vi.mocked(historialDeExcepcion).mockResolvedValue([]);
  vi.mocked(db.select).mockImplementation(() => ({ from: () => ({ where: (where: never) => ({
    limit: async () => {
      const { params } = dialect.sqlToQuery(where);
      const own = [SUCURSAL_A_1, SUCURSAL_A_2, EMPLEADO_A_1, EMPLEADO_A_2];
      return params.includes(EMPRESA_A) && own.includes(params[0] as string) ? [{ id: params[0] }] : [];
    },
  }) }) }) as never);
  vi.mocked(db.query.plannedShifts.findMany).mockImplementation(async (options: never) => {
    const { params } = dialect.sqlToQuery((options as { where: never }).where);
    return stored.filter((row) => params.includes(row.companyId) && params.includes(row.userId)) as never;
  });
  vi.mocked(db.insert).mockImplementation(() => ({ values: (input: never) => ({ returning: async () => {
    const row = filaDeShift({ ...input, id: `saved-${stored.length}` }); stored.push(row); return [row];
  } }) }) as never);
});

describe("C11 — vista previa y aplicación con el servicio y política reales", () => {
  it("anticipa un solapamiento por empleado sin escribir y conserva los resultados parciales", async () => {
    stored.push(filaDeShift({ userId: EMPLEADO_A_1, shiftDate: "2026-10-05" }));
    const request = operation({ employeeIds: [EMPLEADO_A_1, EMPLEADO_A_2] });
    const preview = await shiftTemplateService.previewBulkOperation(actor(), request);
    expect(preview).toHaveLength(4);
    expect(preview[0]).toMatchObject({ employeeId: EMPLEADO_A_1, branchId: SUCURSAL_A_1, role: "CAJERO", canApply: false });
    expect(preview[0].error).toContain("solapa");
    expect(preview.filter((row) => row.canApply)).toHaveLength(3);
    expect(db.insert).not.toHaveBeenCalled();
    const result = await shiftTemplateService.applyBulkOperation(actor(), request);
    expect(result.created).toHaveLength(3);
    expect(result.failed).toEqual([expect.objectContaining({ employeeId: EMPLEADO_A_1, date: "2026-10-05", error: expect.stringContaining("solapa") })]);
    expect(stored).toHaveLength(4);
    expect(result.created.every((row) => row.branchId === SUCURSAL_A_1 && row.role === "CAJERO" && row.companyId === EMPRESA_A)).toBe(true);
  });

  it("simula el límite semanal con los elementos anteriores del lote", async () => {
    const request = operation({ endDate: "2026-10-11" });
    const preview = await shiftTemplateService.previewBulkOperation(actor(), request);
    expect(preview.filter((row) => row.canApply)).toHaveLength(6);
    expect(preview[6].error).toContain("48 horas");
    expect(db.insert).not.toHaveBeenCalled();
    const result = await shiftTemplateService.applyBulkOperation(actor(), request);
    expect(result.created).toHaveLength(6); expect(result.failed).toHaveLength(1);
  });

  it("respeta los días y horas de la plantilla, incluyendo cruce de medianoche", async () => {
    const request = operation({ endDate: "2026-10-11", pattern: "custom", daysOfWeek: [6, 0], shiftType: "CUSTOM", customStartTime: "23:00", customEndTime: "07:00" });
    const result = await shiftTemplateService.applyBulkOperation(actor(), request);
    expect(result.created.map((row) => row.shiftDate)).toEqual(["2026-10-10", "2026-10-11"]);
    expect(result.created.every((row) => row.startTime === "23:00" && row.endTime === "07:00")).toBe(true);
  });

  it("vuelve a validar si aparece un conflicto después de la vista previa", async () => {
    const request = operation({ endDate: "2026-10-05" });
    expect((await shiftTemplateService.previewBulkOperation(actor(), request))[0].canApply).toBe(true);
    stored.push(filaDeShift({ shiftDate: "2026-10-05" }));
    expect((await shiftTemplateService.applyBulkOperation(actor(), request)).failed).toHaveLength(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rechaza la jornada larga sin excepción y la anticipa con una vigente", async () => {
    const request = operation({ endDate: "2026-10-05", shiftType: "CUSTOM", customStartTime: "10:00", customEndTime: "22:00" });
    expect((await shiftTemplateService.previewBulkOperation(actor(), request))[0].error).toContain("MAX_DAILY_HOURS");
    vi.mocked(hayExcepcionVigente).mockResolvedValue(true);
    expect((await shiftTemplateService.previewBulkOperation(actor(), request))[0].canApply).toBe(true);
    expect((await shiftTemplateService.applyBulkOperation(actor(), request)).created).toHaveLength(1);
  });

  for (const changes of [{ branchId: "" }, { role: " " }, { employeeIds: [] }, { startDate: "2026-02-30" }, { endDate: "2026-10-04" }, { endDate: "2027-10-05" }, { shiftType: "CUSTOM", customStartTime: "25:00", customEndTime: "07:00" }, { pattern: "custom", daysOfWeek: [] }] as Partial<BulkShiftOperation>[]) {
    it(`rechaza contrato inválido antes de consultar o escribir: ${JSON.stringify(changes)}`, async () => {
      await expect(shiftTemplateService.applyBulkOperation(actor(), operation(changes))).rejects.toThrow();
      expect(db.select).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled();
    });
  }

  for (const user of [empleadoA1, gerenteA1SinSucursal]) {
    it(`rechaza actor sin permiso/alcance ${user.id} sin escribir`, async () => {
      await expect(shiftTemplateService.previewBulkOperation(actor(user), operation())).rejects.toThrow();
      await expect(shiftTemplateService.applyBulkOperation(actor(user), operation())).rejects.toThrow();
      expect(db.insert).not.toHaveBeenCalled();
    });
  }
  for (const changes of [{ branchId: SUCURSAL_B_1 }, { employeeIds: [EMPLEADO_B_1] }]) {
    it(`informa destino ajeno sin escribir: ${JSON.stringify(changes)}`, async () => {
      const request = operation(changes);
      expect((await shiftTemplateService.previewBulkOperation(actor(), request)).every((row) => !row.canApply)).toBe(true);
      expect((await shiftTemplateService.applyBulkOperation(actor(), request)).created).toEqual([]);
      expect(db.insert).not.toHaveBeenCalled();
    });
  }
  it("un gerente no aplica a otra sucursal de su empresa", async () => {
    const request = operation({ branchId: SUCURSAL_A_2 });
    await expect(shiftTemplateService.applyBulkOperation(actor(gerenteA1), request)).rejects.toThrow();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("C12: elimina empleados repetidos y repetir el lote no duplica turnos", async () => {
    const request = operation({ employeeIds: [EMPLEADO_A_1, EMPLEADO_A_1], endDate: "2026-10-05" });
    expect((await shiftTemplateService.previewBulkOperation(actor(), request))).toHaveLength(1);
    expect((await shiftTemplateService.applyBulkOperation(actor(), request)).created).toHaveLength(1);
    const repeated = await shiftTemplateService.applyBulkOperation(actor(), request);
    expect(repeated.created).toEqual([]);
    expect(repeated.failed[0].error).toContain("solapa");
    expect(stored).toHaveLength(1);
  });

  it("C12: dos aplicaciones concurrentes del mismo lote no crean duplicados", async () => {
    const request = operation({ endDate: "2026-10-05" });
    const results = await Promise.all([
      shiftTemplateService.applyBulkOperation(actor(), request),
      shiftTemplateService.applyBulkOperation(actor(), request),
    ]);
    expect(stored).toHaveLength(1);
    expect(results.flatMap((result) => result.created)).toHaveLength(1);
    expect(results.flatMap((result) => result.failed)).toHaveLength(1);
  });

  it("C12: reintenta un lote parcial sin volver a crear sus elementos guardados", async () => {
    stored.push(filaDeShift({ userId: EMPLEADO_A_1, shiftDate: "2026-10-05" }));
    const request = operation({ employeeIds: [EMPLEADO_A_1, EMPLEADO_A_2] });
    const first = await shiftTemplateService.applyBulkOperation(actor(), request);
    expect(first.created).toHaveLength(3);
    expect(first.failed).toHaveLength(1);
    const retry = await shiftTemplateService.applyBulkOperation(actor(), request);
    expect(retry.created).toEqual([]);
    expect(retry.failed).toHaveLength(4);
    expect(stored).toHaveLength(4);
  });

  it("C12: el bloqueo por empleado también evita duplicados en lotes de otra sucursal", async () => {
    const results = await Promise.all([
      shiftTemplateService.applyBulkOperation(actor(), operation({ endDate: "2026-10-05" })),
      shiftTemplateService.applyBulkOperation(actor(), operation({ endDate: "2026-10-05", branchId: SUCURSAL_A_2 })),
    ]);
    expect(stored).toHaveLength(1);
    expect(results.flatMap((result) => result.created)).toHaveLength(1);
    expect(results.flatMap((result) => result.failed)).toHaveLength(1);
  });

  it("rechaza lotes mayores de 500 elementos antes de consultar o escribir", async () => {
    const request = operation({ endDate: "2026-10-11", employeeIds: Array.from({ length: 72 }, (_, index) => `employee-${index}`) });
    await expect(shiftTemplateService.previewBulkOperation(actor(), request)).rejects.toThrow("500 turnos");
    await expect(shiftTemplateService.applyBulkOperation(actor(), request)).rejects.toThrow("500 turnos");
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
