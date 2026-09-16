import { describe, it, expect, vi, beforeEach } from "vitest";
import { TpvBatchService } from "../tpv-batch-service";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/error";

vi.mock("@/lib/db", () => {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockDelete = vi.fn();
  const mockTransaction = vi.fn((cb) => cb({ insert: mockInsert }));

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
      transaction: mockTransaction,
    },
  };
});

describe("TpvBatchService (Cierre de Lotes TPV y Conciliación Física)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getBatchesForCut", () => {
    it("calcula reconciliación 'cuadrado' cuando los vouchers suman exactamente lo declarado en tarjeta", async () => {
      const fakeCut = {
        id: "cut-1",
        companyId: "comp-1",
        branchId: "branch-1",
        businessDate: "2026-09-15",
        shift: "VESPERTINO",
        totalSales: 500000,
        cardSales: 350000, // $3,500.00
        status: "PENDING_REVIEW",
      };

      const fakeTerminals = [
        {
          id: "term-1",
          alias: "Barra 1",
          serialNumber: "SN-001",
          acquirer: "BBVA",
          active: true,
        },
        {
          id: "term-2",
          alias: "Salón",
          serialNumber: "SN-002",
          acquirer: "CLIP",
          active: true,
        },
      ];

      const fakeBatches = [
        {
          id: "batch-1",
          companyId: "comp-1",
          branchId: "branch-1",
          salesCutId: "cut-1",
          terminalId: "term-1",
          batchNumber: "0012",
          cardAmountCents: 200000, // $2,000.00
          tipAmountCents: 20000, // $200.00
          voucherPhotoUrl: "https://r2.pulso/voucher1.jpg",
          notes: null,
          capturedBy: "user-1",
          capturedByName: "Gerente Turno",
          createdAt: new Date(),
          updatedAt: new Date(),
          terminalAlias: "Barra 1",
          terminalSerial: "SN-001",
          terminalAcquirer: "BBVA",
          terminalActive: true,
        },
        {
          id: "batch-2",
          companyId: "comp-1",
          branchId: "branch-1",
          salesCutId: "cut-1",
          terminalId: "term-2",
          batchNumber: "0045",
          cardAmountCents: 150000, // $1,500.00 -> Total: $3,500.00 (cuadrado)
          tipAmountCents: 15000, // $150.00
          voucherPhotoUrl: "https://r2.pulso/voucher2.jpg",
          notes: null,
          capturedBy: "user-1",
          capturedByName: "Gerente Turno",
          createdAt: new Date(),
          updatedAt: new Date(),
          terminalAlias: "Salón",
          terminalSerial: "SN-002",
          terminalAcquirer: "CLIP",
          terminalActive: true,
        },
      ];

      // Configurar las 3 llamadas secuenciales a db.select()
      // 1. Cut
      const cutChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([fakeCut]),
          }),
        }),
      };
      // 2. Terminals
      const terminalsChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce(fakeTerminals),
        }),
      };
      // 3. Batches
      const batchesChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValueOnce(fakeBatches),
            }),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(cutChain as any)
        .mockReturnValueOnce(terminalsChain as any)
        .mockReturnValueOnce(batchesChain as any);

      const result = await TpvBatchService.getBatchesForCut("comp-1", "cut-1");

      expect(result.cut.id).toBe("cut-1");
      expect(result.batches).toHaveLength(2);
      expect(result.reconciliation.posCardSalesCents).toBe(350000);
      expect(result.reconciliation.batchesTotalCardCents).toBe(350000);
      expect(result.reconciliation.batchesTotalTipCents).toBe(35000);
      expect(result.reconciliation.varianceCents).toBe(0);
      expect(result.reconciliation.direction).toBe("cuadrado");
      expect(result.reconciliation.isBalanced).toBe(true);
      expect(result.reconciliation.hasMissingTerminals).toBe(false);
    });

    it("detecta 'faltante' y alerta si hay terminales activas sin lote capturado", async () => {
      const fakeCut = {
        id: "cut-1",
        companyId: "comp-1",
        branchId: "branch-1",
        businessDate: "2026-09-15",
        shift: "MATUTINO",
        totalSales: 400000,
        cardSales: 300000, // POS reporta $3,000.00
        status: "PENDING_REVIEW",
      };

      const fakeTerminals = [
        {
          id: "term-1",
          alias: "Barra 1",
          serialNumber: "SN-001",
          acquirer: "BBVA",
          active: true,
        },
        {
          id: "term-2",
          alias: "Salón",
          serialNumber: "SN-002",
          acquirer: "CLIP",
          active: true,
        },
      ];

      // Solo se capturó la terminal 1 con $2,500.00 (Faltan $500 y falta la terminal 2)
      const fakeBatches = [
        {
          id: "batch-1",
          companyId: "comp-1",
          branchId: "branch-1",
          salesCutId: "cut-1",
          terminalId: "term-1",
          batchNumber: "0012",
          cardAmountCents: 250000,
          tipAmountCents: 25000,
          voucherPhotoUrl: null,
          notes: "Falta capturar terminal salón",
          capturedBy: "user-1",
          capturedByName: "Cajero",
          createdAt: new Date(),
          updatedAt: new Date(),
          terminalAlias: "Barra 1",
          terminalSerial: "SN-001",
          terminalAcquirer: "BBVA",
          terminalActive: true,
        },
      ];

      const cutChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([fakeCut]),
          }),
        }),
      };
      const terminalsChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce(fakeTerminals),
        }),
      };
      const batchesChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValueOnce(fakeBatches),
            }),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(cutChain as any)
        .mockReturnValueOnce(terminalsChain as any)
        .mockReturnValueOnce(batchesChain as any);

      const result = await TpvBatchService.getBatchesForCut("comp-1", "cut-1");

      expect(result.reconciliation.varianceCents).toBe(-50000); // Faltante de $500
      expect(result.reconciliation.direction).toBe("faltante");
      expect(result.reconciliation.isBalanced).toBe(false);
      expect(result.reconciliation.hasMissingTerminals).toBe(true);
      expect(result.reconciliation.missingTerminals).toHaveLength(1);
      expect(result.reconciliation.missingTerminals[0].id).toBe("term-2");
    });

    it("lanza error 404 si el corte no existe", async () => {
      const cutChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      };

      vi.mocked(db.select).mockReturnValueOnce(cutChain as any);

      await expect(
        TpvBatchService.getBatchesForCut("comp-1", "non-existent")
      ).rejects.toThrow(ApiError);
    });
  });

  describe("saveBatches", () => {
    it("valida que la terminal pertenezca a la sucursal y realiza upsert", async () => {
      const fakeCut = {
        id: "cut-1",
        branchId: "branch-1",
      };

      // 1. Cut check
      const cutChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([fakeCut]),
          }),
        }),
      };

      // 2. Terminal check
      const terminalChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([{ id: "term-1" }]),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(cutChain as any)
        .mockReturnValueOnce(terminalChain as any);

      const onConflictMock = vi.fn().mockResolvedValueOnce(undefined);
      const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock });
      const txInsertMock = vi.fn().mockReturnValue({ values: valuesMock });

      vi.mocked(db.transaction).mockImplementationOnce(async (cb: any) => {
        return cb({ insert: txInsertMock });
      });

      // Simular getBatchesForCut subsecuente
      const spyGet = vi
        .spyOn(TpvBatchService, "getBatchesForCut")
        .mockResolvedValueOnce({
          cut: fakeCut as any,
          batches: [],
          terminals: [],
          reconciliation: {} as any,
        });

      await TpvBatchService.saveBatches({
        companyId: "comp-1",
        salesCutId: "cut-1",
        userId: "user-1",
        batches: [
          {
            terminalId: "term-1",
            batchNumber: "0059",
            cardAmountCents: 150000,
            tipAmountCents: 15000,
            voucherPhotoUrl: "https://r2/voucher.jpg",
          },
        ],
      });

      expect(txInsertMock).toHaveBeenCalled();
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          salesCutId: "cut-1",
          terminalId: "term-1",
          batchNumber: "0059",
          cardAmountCents: 150000,
          tipAmountCents: 15000,
          voucherPhotoUrl: "https://r2/voucher.jpg",
        })
      );
      expect(spyGet).toHaveBeenCalledWith("comp-1", "cut-1");
    });

    it("rechaza si una terminal no pertenece a la sucursal del corte", async () => {
      const fakeCut = {
        id: "cut-1",
        branchId: "branch-1",
      };

      const cutChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([fakeCut]),
          }),
        }),
      };

      const terminalChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([]), // Terminal no encontrada para esta sucursal
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(cutChain as any)
        .mockReturnValueOnce(terminalChain as any);

      await expect(
        TpvBatchService.saveBatches({
          companyId: "comp-1",
          salesCutId: "cut-1",
          userId: "user-1",
          batches: [
            {
              terminalId: "foreign-term",
              batchNumber: "0059",
              cardAmountCents: 150000,
            },
          ],
        })
      ).rejects.toThrow("no está autorizada para esta sucursal");
    });
  });
});
