import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  matchCancelledTicketWithGateway,
  detectTpvFraudFindings,
} from "../tpv-fraud-detection-service";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const mockSelect = vi.fn();
  return {
    db: {
      select: mockSelect,
    },
  };
});

describe("Motor Antifraude Operativo TPV (Cancelaciones, Propinas y Terminales Fantasma)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Regla 1: matchCancelledTicketWithGateway (Ticket POS cancelado post-cobro)", () => {
    it("detecta coincidencia en monto y tiempo (±20 min) generando alerta TPV_VOID_AFTER_CHARGE con severidad HIGH", () => {
      const ticket = {
        ticketId: "TCK-8821",
        amountCents: 85000, // $850.00 MXN
        cancelledAt: new Date("2026-09-15T14:10:00Z"),
        branchId: "branch-1",
        branchName: "Roma Norte",
      };

      const transactions = [
        {
          id: "tx-gw-1",
          grossAmountCents: 85000, // mismo monto
          transactionDate: new Date("2026-09-15T14:02:00Z"), // 8 min antes
          acquirer: "CLIP",
          authorizationCode: "AUT9981",
          externalId: "ext-1",
          branchId: "branch-1",
          branchName: "Roma Norte",
        },
      ];

      const finding = matchCancelledTicketWithGateway(ticket, transactions);

      expect(finding).not.toBeNull();
      expect(finding?.type).toBe("TPV_VOID_AFTER_CHARGE");
      expect(finding?.severity).toBe("HIGH");
      expect(finding?.amountCents).toBe(85000);
      expect(finding?.description).toContain("TCK-8821");
      expect(finding?.detail).toContain("8 minuto(s)");
    });

    it("ignora transacciones fuera de la ventana de 20 minutos", () => {
      const ticket = {
        ticketId: "TCK-8822",
        amountCents: 50000,
        cancelledAt: new Date("2026-09-15T14:00:00Z"),
        branchId: "branch-1",
      };

      const transactions = [
        {
          id: "tx-old",
          grossAmountCents: 50000,
          transactionDate: new Date("2026-09-15T14:35:00Z"), // 35 min después (>20 min)
          acquirer: "BBVA",
          authorizationCode: "AUT111",
          branchId: "branch-1",
        },
      ];

      const finding = matchCancelledTicketWithGateway(ticket, transactions);
      expect(finding).toBeNull();
    });

    it("ignora transacciones con montos diferentes", () => {
      const ticket = {
        ticketId: "TCK-8823",
        amountCents: 50000,
        cancelledAt: new Date("2026-09-15T14:00:00Z"),
        branchId: "branch-1",
      };

      const transactions = [
        {
          id: "tx-diff",
          grossAmountCents: 65000, // $650 vs $500
          transactionDate: new Date("2026-09-15T14:05:00Z"),
          acquirer: "CLIP",
          branchId: "branch-1",
        },
      ];

      const finding = matchCancelledTicketWithGateway(ticket, transactions);
      expect(finding).toBeNull();
    });

    it("ignora transacciones de otra sucursal", () => {
      const ticket = {
        ticketId: "TCK-8824",
        amountCents: 50000,
        cancelledAt: new Date("2026-09-15T14:00:00Z"),
        branchId: "branch-1",
      };

      const transactions = [
        {
          id: "tx-other-branch",
          grossAmountCents: 50000,
          transactionDate: new Date("2026-09-15T14:05:00Z"),
          acquirer: "CLIP",
          branchId: "branch-2", // Sucursal distinta
        },
      ];

      const finding = matchCancelledTicketWithGateway(ticket, transactions);
      expect(finding).toBeNull();
    });
  });

  describe("Regla 2: detectTpvFraudFindings - Propinas desproporcionadas en lotes (TPV_EXCESSIVE_TIP)", () => {
    it("alerta propina >20% en lote de terminal física con severidad correspondiente", async () => {
      // Mock db queries: terminals, cuts, batches, gateway
      const mockTerminals = [
        { id: "term-1", branchId: "branch-1", alias: "Barra 1", serialNumber: "SN001", acquirer: "CLIP", isActive: true },
      ];
      const mockCuts: any[] = [];
      const mockBatches = [
        {
          id: "batch-1",
          salesCutId: "cut-1",
          branchId: "branch-1",
          branchName: "Roma Norte",
          terminalId: "term-1",
          terminalAlias: "Barra 1",
          batchNumber: "LOTE-101",
          cardAmountCents: 100000, // $1,000 MXN consumo
          tipsCents: 25000, // $250 MXN propina = 25% (> 20%)
          voucherImageUrl: "https://r2.pulso/voucher1.jpg",
          capturedAt: new Date("2026-09-15T23:00:00Z"),
          notes: null,
        },
        {
          id: "batch-ok",
          salesCutId: "cut-1",
          branchId: "branch-1",
          branchName: "Roma Norte",
          terminalId: "term-1",
          terminalAlias: "Barra 1",
          batchNumber: "LOTE-102",
          cardAmountCents: 100000,
          tipsCents: 12000, // $120 MXN propina = 12% (normal)
          voucherImageUrl: null,
          capturedAt: new Date("2026-09-15T23:00:00Z"),
          notes: null,
        },
      ];
      const mockGateway: any[] = [];

      const tChain = { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValueOnce(mockTerminals) }) };
      const cChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValueOnce(mockCuts),
            }),
          }),
        }),
      };
      const bChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValueOnce(mockBatches),
              }),
            }),
          }),
        }),
      };
      const gChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValueOnce(mockGateway),
            }),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(tChain as any)
        .mockReturnValueOnce(cChain as any)
        .mockReturnValueOnce(bChain as any)
        .mockReturnValueOnce(gChain as any);

      const findings = await detectTpvFraudFindings("comp-1", "branch-1");

      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe("TPV_EXCESSIVE_TIP");
      expect(findings[0].description).toContain("25.0%");
      expect(findings[0].amountCents).toBe(25000);
      expect(findings[0].severity).toBe("MEDIUM"); // 25% > 20% pero <= 35%
    });

    it("alerta propina capturada con venta en tarjeta cero con severidad HIGH", async () => {
      const mockTerminals = [
        { id: "term-1", branchId: "branch-1", alias: "Caja 1", serialNumber: "SN001", acquirer: "BBVA", isActive: true },
      ];
      const mockCuts: any[] = [];
      const mockBatches = [
        {
          id: "batch-zero-sale",
          salesCutId: "cut-2",
          branchId: "branch-1",
          branchName: "Condesa",
          terminalId: "term-1",
          terminalAlias: "Caja 1",
          batchNumber: "LOTE-99",
          cardAmountCents: 0, // $0 venta
          tipsCents: 15000, // $150 propina
          voucherImageUrl: null,
          capturedAt: new Date("2026-09-15T23:00:00Z"),
          notes: null,
        },
      ];
      const mockGateway: any[] = [];

      const tChain = { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValueOnce(mockTerminals) }) };
      const cChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValueOnce(mockCuts),
            }),
          }),
        }),
      };
      const bChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValueOnce(mockBatches),
              }),
            }),
          }),
        }),
      };
      const gChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValueOnce(mockGateway),
            }),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(tChain as any)
        .mockReturnValueOnce(cChain as any)
        .mockReturnValueOnce(bChain as any)
        .mockReturnValueOnce(gChain as any);

      const findings = await detectTpvFraudFindings("comp-1", "branch-1");

      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe("TPV_EXCESSIVE_TIP");
      expect(findings[0].severity).toBe("HIGH");
      expect(findings[0].detail).toContain("sin reportar ningún monto de consumo");
    });
  });

  describe("Regla 3: detectTpvFraudFindings - Terminal fantasma (TPV_GHOST_TERMINAL)", () => {
    it("alerta con severidad HIGH si un corte declara venta con tarjeta pero la sucursal no tiene terminales activas", async () => {
      const mockTerminals: any[] = []; // Sin terminales registradas
      const mockCuts = [
        {
          id: "cut-ghost-1",
          branchId: "branch-no-terms",
          branchName: "Juárez",
          businessDate: "2026-09-15",
          shift: "VESPERTINO",
          cardSales: 450000, // $4,500 MXN en tarjeta
          totalSales: 600000,
          validationNotes: null,
          createdAt: new Date("2026-09-15T23:30:00Z"),
        },
      ];
      const mockBatches: any[] = [];
      const mockGateway: any[] = [];

      const tChain = { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValueOnce(mockTerminals) }) };
      const cChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValueOnce(mockCuts),
            }),
          }),
        }),
      };
      const bChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValueOnce(mockBatches),
              }),
            }),
          }),
        }),
      };
      const gChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValueOnce(mockGateway),
            }),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(tChain as any)
        .mockReturnValueOnce(cChain as any)
        .mockReturnValueOnce(bChain as any)
        .mockReturnValueOnce(gChain as any);

      const findings = await detectTpvFraudFindings("comp-1", "branch-no-terms");

      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe("TPV_GHOST_TERMINAL");
      expect(findings[0].severity).toBe("HIGH");
      expect(findings[0].detail).toContain("no tiene terminales físicas activas");
      expect(findings[0].amountCents).toBe(450000);
    });

    it("alerta con severidad HIGH si la venta en tarjeta del POS excede significativamente los lotes autorizados capturados", async () => {
      const mockTerminals = [
        { id: "term-1", branchId: "branch-1", alias: "Barra 1", serialNumber: "SN001", acquirer: "CLIP", isActive: true },
      ];
      const mockCuts = [
        {
          id: "cut-variance-1",
          branchId: "branch-1",
          branchName: "Roma Norte",
          businessDate: "2026-09-15",
          shift: "MATUTINO",
          cardSales: 500000, // $5,000.00 MXN en POS
          totalSales: 800000,
          validationNotes: null,
          createdAt: new Date("2026-09-15T16:00:00Z"),
        },
      ];
      const mockBatches = [
        {
          id: "batch-only-1",
          salesCutId: "cut-variance-1",
          branchId: "branch-1",
          branchName: "Roma Norte",
          terminalId: "term-1",
          terminalAlias: "Barra 1",
          batchNumber: "LOTE-55",
          cardAmountCents: 200000, // $2,000.00 MXN en voucher
          tipsCents: 15000,
          voucherImageUrl: "https://r2/v.jpg",
          capturedAt: new Date("2026-09-15T16:00:00Z"),
          notes: null,
        },
      ];
      // Discrepancia: POS $5,000 vs vouchers $2,000 -> Faltante $3,000 MXN (> $100 MXN)
      const mockGateway: any[] = [];

      const tChain = { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValueOnce(mockTerminals) }) };
      const cChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValueOnce(mockCuts),
            }),
          }),
        }),
      };
      const bChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValueOnce(mockBatches),
              }),
            }),
          }),
        }),
      };
      const gChain = {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValueOnce(mockGateway),
            }),
          }),
        }),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(tChain as any)
        .mockReturnValueOnce(cChain as any)
        .mockReturnValueOnce(bChain as any)
        .mockReturnValueOnce(gChain as any);

      const findings = await detectTpvFraudFindings("comp-1", "branch-1");

      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe("TPV_GHOST_TERMINAL");
      expect(findings[0].severity).toBe("HIGH");
      expect(findings[0].amountCents).toBe(300000); // $3,000 MXN faltante
      expect(findings[0].detail).toContain("Sospecha de cobros en terminal no autorizada");
    });
  });
});
