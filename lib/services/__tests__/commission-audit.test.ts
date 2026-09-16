import { describe, it, expect, vi, beforeEach } from "vitest";
import { auditGatewayCommissions, getCommissionsByBranch } from "../commission-service";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const mockSelect = vi.fn();
  return {
    db: {
      select: mockSelect,
    },
  };
});

describe("Auditoría de Comisiones e Integridad en P&L (Línea 214)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("auditGatewayCommissions", () => {
    it("calcula la comisión esperada por contrato (MDR + IVA 16%) y detecta sobrecobro", async () => {
      const mockTransactions = [
        {
          id: "tx-1",
          branchId: "branch-1",
          externalId: "ext-100",
          authorizationCode: "AUTH123",
          transactionDate: new Date("2026-09-15T12:00:00Z"),
          cardBrand: "VISA",
          cardType: "CREDIT",
          grossAmountCents: 100000, // $1,000.00 MXN
          feeAmountCents: 3000, // $30.00 MXN retenido base
          feeVatCents: 480, // $4.80 MXN IVA retenido
          // Total cobrado = $34.80 MXN (3,480 cents)
        },
      ];

      // Tarifa pactada en contrato para TPV: 2.50% (250 bps) + 16% IVA (1600 bps)
      // Esperado base = 100,000 * 250 / 10,000 = 2,500 cents ($25.00 MXN)
      // Esperado IVA = 2,500 * 1600 / 10,000 = 400 cents ($4.00 MXN)
      // Esperado total = 2,900 cents ($29.00 MXN)
      // Sobrecobro = 3,480 - 2,900 = 580 cents ($5.80 MXN)
      const mockRates = [
        {
          channel: "tpv",
          branchId: null, // tarifa del grupo
          rateBps: 250,
          vatBps: 1600,
          effectiveFrom: "2026-01-01",
        },
      ];

      // Configurar cadenas de db.select
      const txChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValueOnce(mockTransactions),
          }),
        }),
      };

      const rateChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValueOnce(mockRates),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(txChain as any)
        .mockReturnValueOnce(rateChain as any);

      const result = await auditGatewayCommissions({
        companyId: "comp-1",
        branchId: "branch-1",
      });

      expect(result.totalAudited).toBe(1);
      expect(result.totalGrossCents).toBe(100000);
      expect(result.totalActualFeeCents).toBe(3480);
      expect(result.totalExpectedFeeCents).toBe(2900);
      expect(result.totalOverchargeCents).toBe(580);
      expect(result.discrepanciesCount).toBe(1);

      const disc = result.discrepancies[0];
      expect(disc.type).toBe("OVERCHARGED");
      expect(disc.expectedFeeCents).toBe(2500);
      expect(disc.expectedFeeVatCents).toBe(400);
      expect(disc.expectedTotalFeeCents).toBe(2900);
      expect(disc.actualTotalFeeCents).toBe(3480);
      expect(disc.differenceCents).toBe(580);
      expect(disc.rateBpsApplied).toBe(250);
      expect(disc.vatBpsApplied).toBe(1600);
    });

    it("no genera discrepancia si la comisión cobrada coincide con la tarifa esperada (dentro de tolerancia)", async () => {
      const mockTransactions = [
        {
          id: "tx-ok",
          branchId: "branch-1",
          externalId: "ext-200",
          authorizationCode: "AUTH999",
          transactionDate: new Date("2026-09-15T14:00:00Z"),
          cardBrand: "MASTERCARD",
          cardType: "DEBIT",
          grossAmountCents: 50000, // $500.00 MXN
          // Esperado a 2.00% (200 bps): 1,000 cents base + 160 cents IVA = 1,160 cents total
          feeAmountCents: 1000,
          feeVatCents: 160,
        },
      ];

      const mockRates = [
        {
          channel: "tpv",
          branchId: "branch-1",
          rateBps: 200,
          vatBps: 1600,
          effectiveFrom: "2026-01-01",
        },
      ];

      const txChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValueOnce(mockTransactions),
          }),
        }),
      };

      const rateChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValueOnce(mockRates),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(txChain as any)
        .mockReturnValueOnce(rateChain as any);

      const result = await auditGatewayCommissions({
        companyId: "comp-1",
        branchId: "branch-1",
      });

      expect(result.totalAudited).toBe(1);
      expect(result.totalOverchargeCents).toBe(0);
      expect(result.discrepanciesCount).toBe(0);
      expect(result.discrepancies).toHaveLength(0);
      expect(result.effectiveAvgRateBps).toBe(232); // 1,160 / 50,000 * 10,000 = 232 bps (2.32% con IVA)
    });

    it("identifica transacciones con menor cobro que la tarifa como UNDERCHARGED", async () => {
      const mockTransactions = [
        {
          id: "tx-under",
          branchId: "branch-1",
          externalId: "ext-300",
          authorizationCode: "AUTH333",
          transactionDate: new Date("2026-09-15T16:00:00Z"),
          cardBrand: "AMEX",
          cardType: "CREDIT",
          grossAmountCents: 200000, // $2,000.00 MXN
          feeAmountCents: 4000, // Cobrado $40 base + $6.40 IVA = $46.40 (4,640 cents)
          feeVatCents: 640,
        },
      ];

      // Tarifa pactada 3.00% (300 bps) + 16% IVA = 6,000 cents base + 960 IVA = 6,960 total
      const mockRates = [
        {
          channel: "tpv",
          branchId: null,
          rateBps: 300,
          vatBps: 1600,
          effectiveFrom: "2026-01-01",
        },
      ];

      const txChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValueOnce(mockTransactions),
          }),
        }),
      };

      const rateChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValueOnce(mockRates),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(txChain as any)
        .mockReturnValueOnce(rateChain as any);

      const result = await auditGatewayCommissions({
        companyId: "comp-1",
      });

      expect(result.discrepanciesCount).toBe(1);
      expect(result.discrepancies[0].type).toBe("UNDERCHARGED");
      expect(result.discrepancies[0].differenceCents).toBe(-2320); // 4640 - 6960 = -2320
    });
  });

  describe("Integridad en P&L (getCommissionsByBranch)", () => {
    it("sustituye la estimación por la medición real cuando existen gatewayTransactions, marcando el renglón como MEASURED", async () => {
      // 1. mockRates
      const mockRates = [
        {
          channel: "tpv",
          branchId: null,
          rateBps: 250,
          vatBps: 1600,
          effectiveFrom: "2026-01-01",
        },
      ];

      // 2. mockCuts: un corte con venta en tarjeta pero sin comisión manual capturada
      const mockCuts = [
        {
          branchId: "branch-1",
          businessDate: "2026-09-15",
          cashSales: 0,
          cardSales: 100000, // $1,000.00 MXN en tarjeta
          aggregatorSales: null,
          commissionCents: null,
        },
      ];

      // 3. mockGateway: reporte de pasarela importado con comisión real medida
      const mockGateway = [
        {
          branchId: "branch-1",
          grossAmountCents: 100000,
          feeAmountCents: 2500,
          feeVatCents: 400,
        },
      ];

      const rateChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValueOnce(mockRates),
          }),
        }),
      };

      const cutChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce(mockCuts),
        }),
      };

      const gwChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce(mockGateway),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(rateChain as any)
        .mockReturnValueOnce(cutChain as any)
        .mockReturnValueOnce(gwChain as any);

      const [branchComms] = await getCommissionsByBranch("comp-1", "2026-09-01", "2026-09-30");

      expect(branchComms).toBeDefined();
      expect(branchComms.branchId).toBe("branch-1");
      // El renglón de comisiones fue provisto por la medición del gateway
      expect(branchComms.source).toBe("MEASURED");
      expect(branchComms.totalCommissionCents).toBe(2900); // 2,500 + 400
      expect(branchComms.channels[0].channel).toBe("tpv");
      expect(branchComms.channels[0].source).toBe("MEASURED");
      expect(branchComms.channels[0].measuredCents).toBe(2900);
      expect(branchComms.channels[0].estimatedCents).toBe(0);
    });
  });
});
