import { describe, it, expect, vi, beforeEach } from "vitest";
import { GatewayReportService } from "../gateway-report-service";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/error";

vi.mock("@/lib/db", () => {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
    },
  };
});

describe("GatewayReportService (Ingesta y Consulta de Transacciones de Pasarelas)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("importReport", () => {
    it("valida la sucursal, parsea el archivo e inserta detectando duplicados con onConflictDoNothing", async () => {
      // 1. Simular validación de sucursal
      const branchChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([{ id: "branch-1" }]),
          }),
        }),
      };

      vi.mocked(db.select).mockReturnValueOnce(branchChain as any);

      // 2. Simular inserción: 2 transacciones en el archivo, pero solo 1 es nueva (la otra es duplicada)
      const onConflictMock = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValueOnce([{ id: "tx-new-1" }]),
      });
      const valuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictMock });
      vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as any);

      const sampleCsv = `Fecha de transacción,ID de transacción,Autorización,Tarjeta,Monto,Comisión Clip,IVA Comisión,Monto Neto
15/09/2026 13:45:00,clp_001,098712,4321,500.00,18.00,2.88,479.12
15/09/2026 15:10:22,clp_002,098713,9876,1000.00,36.00,5.76,958.24`;

      const buffer = Buffer.from(sampleCsv, "utf8");

      const result = await GatewayReportService.importReport({
        companyId: "comp-1",
        branchId: "branch-1",
        acquirer: "CLIP",
        fileName: "clip_report.csv",
        buffer,
        userId: "user-1",
      });

      expect(result.totalParsed).toBe(2);
      expect(result.insertedCount).toBe(1);
      expect(result.duplicateCount).toBe(1); // 2 - 1 = 1 duplicado detectado
      expect(result.totalGrossCents).toBe(150000);
      expect(result.totalFeeCents).toBe(5400);
      expect(result.totalFeeVatCents).toBe(864);
      expect(result.totalNetCents).toBe(143736);
    });

    it("rechaza la importación si la sucursal no pertenece a la compañía", async () => {
      const branchChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([]), // Sucursal no encontrada
          }),
        }),
      };

      vi.mocked(db.select).mockReturnValueOnce(branchChain as any);

      const buffer = Buffer.from("dummy", "utf8");

      await expect(
        GatewayReportService.importReport({
          companyId: "comp-1",
          branchId: "foreign-branch",
          acquirer: "CLIP",
          fileName: "test.csv",
          buffer,
          userId: "user-1",
        })
      ).rejects.toThrow("La sucursal seleccionada no es válida.");
    });
  });

  describe("getTransactions", () => {
    it("ejecuta consulta con agregados de totales y paginación", async () => {
      const fakeItems = [
        {
          id: "tx-1",
          companyId: "comp-1",
          branchId: "branch-1",
          branchName: "Roma",
          acquirer: "CLIP",
          externalId: "clp_001",
          authorizationCode: "098712",
          transactionDate: new Date("2026-09-15T13:45:00Z"),
          cardLast4: "4321",
          cardBrand: "VISA",
          cardType: "CREDIT",
          grossAmountCents: 50000,
          feeAmountCents: 1800,
          feeVatCents: 288,
          netAmountCents: 47912,
          settlementDate: null,
          batchNumber: null,
          status: "SETTLED",
          importedAt: new Date(),
          importedByName: "Admin",
        },
      ];

      const fakeAggregates = [
        {
          totalCount: 1,
          sumGross: 50000,
          sumFee: 1800,
          sumFeeVat: 288,
          sumNet: 47912,
        },
      ];

      // 1. Items query
      const itemsChain = {
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    offset: vi.fn().mockResolvedValueOnce(fakeItems),
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      // 2. Aggregates query
      const aggChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce(fakeAggregates),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(itemsChain as any)
        .mockReturnValueOnce(aggChain as any);

      const result = await GatewayReportService.getTransactions({
        companyId: "comp-1",
        branchId: "branch-1",
        acquirer: "CLIP",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.summary.totalGrossCents).toBe(50000);
      expect(result.summary.totalFeeCents).toBe(1800);
      expect(result.summary.totalFeeVatCents).toBe(288);
      expect(result.summary.totalNetCents).toBe(47912);
    });
  });
});
