import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/tenant-context";
import { shiftTemplateService } from "@/lib/services";
import { applyBulkOperation, previewBulkOperation } from "@/app/actions/shifts";
import { revalidatePath } from "next/cache";
import { adminA, empleadoA1, EMPLEADO_A_1, EMPLEADO_B_1, SUCURSAL_A_1, SUCURSAL_B_1 } from "../../fixtures/tenant-isolation";
import type { BulkShiftOperation } from "@/lib/types/shifts";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), selectDistinct: vi.fn() } }));
vi.mock("@/lib/tenant-context", () => ({ requireAuth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/services", () => ({ shiftTemplateService: { applyBulkOperation: vi.fn(), previewBulkOperation: vi.fn() } }));

const request: BulkShiftOperation = {
  branchId: SUCURSAL_A_1, role: "CAJERO", employeeIds: [EMPLEADO_A_1],
  startDate: "2026-10-05", endDate: "2026-10-05", pattern: "daily", shiftType: "MATUTINO",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ user: adminA } as never);
  vi.mocked(db.select).mockImplementation(() => ({ from: () => ({
    where: () => ({ orderBy: async () => [{ id: SUCURSAL_A_1, name: "Centro" }] }),
    leftJoin: () => ({ where: () => ({ orderBy: async () => [{ id: EMPLEADO_A_1, name: "Ana", position: "CAJERO", branchId: SUCURSAL_A_1 }] }) }),
  }) }) as never);
  vi.mocked(db.selectDistinct).mockReturnValue({ from: () => ({ where: async () => [] }) } as never);
  vi.mocked(shiftTemplateService.applyBulkOperation).mockResolvedValue({ created: [], failed: [] });
  vi.mocked(shiftTemplateService.previewBulkOperation).mockResolvedValue([]);
});

describe("C11 — acciones y catálogo autorizado", () => {
  for (const action of [previewBulkOperation, applyBulkOperation]) {
    it(`${action.name} deriva el actor de sesión e ignora identidad enviada`, async () => {
      await action({ ...request, companyId: "otra-empresa" } as BulkShiftOperation);
      const service = action === applyBulkOperation ? shiftTemplateService.applyBulkOperation : shiftTemplateService.previewBulkOperation;
      expect(service).toHaveBeenCalledWith({ userId: adminA.id, companyId: adminA.companyId, branchId: null, role: adminA.role }, expect.anything());
      expect(revalidatePath).toHaveBeenCalledTimes(action === applyBulkOperation ? 1 : 0);
    });
    for (const changes of [{ role: "INVENTADO" }, { employeeIds: [EMPLEADO_B_1] }, { branchId: SUCURSAL_B_1 }]) {
      it(`${action.name} rechaza destino fuera de catálogo: ${JSON.stringify(changes)}`, async () => {
        await expect(action({ ...request, ...changes })).rejects.toThrow("catálogo vigente");
        expect(shiftTemplateService.applyBulkOperation).not.toHaveBeenCalled();
        expect(shiftTemplateService.previewBulkOperation).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
      });
    }
    it(`${action.name} exige sesión y permiso`, async () => {
      vi.mocked(requireAuth).mockRejectedValueOnce(new Error("Sin sesión"));
      await expect(action(request)).rejects.toThrow("Sin sesión");
      vi.mocked(requireAuth).mockResolvedValue({ user: empleadoA1 } as never);
      await expect(action(request)).rejects.toThrow("Tu rol");
      expect(db.select).not.toHaveBeenCalled();
      expect(shiftTemplateService.applyBulkOperation).not.toHaveBeenCalled();
      expect(shiftTemplateService.previewBulkOperation).not.toHaveBeenCalled();
    });
  }
});
