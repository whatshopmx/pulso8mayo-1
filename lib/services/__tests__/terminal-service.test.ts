import { describe, it, expect, vi, beforeEach } from "vitest";
import { TerminalService } from "../terminal-service";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/error";

vi.mock("@/lib/db", () => {
  const mockInsert = vi.fn();
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockFindFirst = vi.fn();

  return {
    db: {
      insert: mockInsert,
      select: mockSelect,
      update: mockUpdate,
      query: {
        branchTerminals: {
          findFirst: mockFindFirst,
        },
      },
    },
  };
});

describe("TerminalService (Catálogo de Terminales TPV Autorizadas)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTerminal", () => {
    it("crea exitosamente una terminal con número de serie en mayúsculas", async () => {
      // Simular que no existe terminal previa
      vi.mocked(db.query.branchTerminals.findFirst).mockResolvedValueOnce(undefined as any);

      const fakeTerminal = {
        id: "term-1",
        companyId: "comp-1",
        branchId: "branch-1",
        serialNumber: "SN-987654",
        alias: "Barra Principal",
        acquirer: "BBVA",
        active: true,
      };

      const returningMock = vi.fn().mockResolvedValueOnce([fakeTerminal]);
      const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
      vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as any);

      const res = await TerminalService.createTerminal({
        companyId: "comp-1",
        branchId: "branch-1",
        serialNumber: "sn-987654",
        alias: "Barra Principal",
        acquirer: "BBVA" as any,
        userId: "user-1",
      });

      expect(res).toEqual(fakeTerminal);
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          serialNumber: "SN-987654",
          alias: "Barra Principal",
          active: true,
        })
      );
    });

    it("rechaza duplicados de número de serie en la misma empresa para prevenir terminales fantasma", async () => {
      // Simular que ya existe
      vi.mocked(db.query.branchTerminals.findFirst).mockResolvedValueOnce({
        id: "term-existing",
        alias: "Caja 1",
        branchId: "branch-1",
      } as any);

      await expect(
        TerminalService.createTerminal({
          companyId: "comp-1",
          branchId: "branch-2",
          serialNumber: "SN-987654",
          alias: "Terminal Móvil",
          acquirer: "CLIP" as any,
        })
      ).rejects.toThrowError(ApiError);
    });
  });

  describe("updateTerminal", () => {
    it("actualiza estado activo/inactivo de la terminal", async () => {
      vi.mocked(db.query.branchTerminals.findFirst).mockResolvedValueOnce({
        id: "term-1",
        companyId: "comp-1",
        alias: "Barra 1",
      } as any);

      const returningMock = vi.fn().mockResolvedValueOnce([
        {
          id: "term-1",
          companyId: "comp-1",
          active: false,
        },
      ]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.update).mockReturnValue({ set: setMock } as any);

      const res = await TerminalService.updateTerminal("term-1", "comp-1", {
        active: false,
        userId: "user-1",
      });

      expect(res).toEqual(expect.objectContaining({ active: false }));
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          active: false,
          updatedBy: "user-1",
        })
      );
    });
  });
});
