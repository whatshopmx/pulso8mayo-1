import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CASH_FLOW_PROJECTION_DISCLAIMER,
  computeCashFlowHeroMetrics,
  describeOpeningBalance,
} from "@/lib/services/cash-flow-balance-rules";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import { getReconciledAccountBalances } from "@/lib/services/company-bank-account-service";

describe("FIN-01 — Distinguir saldo conciliado de caja proyectada (V1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getReconciledAccountBalances separa movimientos MATCHED de UNMATCHED y fija fecha efectiva por cuenta", async () => {
    const accountsChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValueOnce([
          {
            id: "acc-1",
            label: "Cuenta Operativa",
            bankName: "BBVA",
            accountLastFour: "4321",
            openingBalanceCents: 500_000,
            openingAsOfDate: "2026-11-01",
          },
          {
            id: "acc-2",
            label: "Cuenta Recepción",
            bankName: "Santander",
            accountLastFour: "9876",
            openingBalanceCents: 200_000,
            openingAsOfDate: "2026-11-10",
          },
        ]),
      }),
    };

    const sumsChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValueOnce([
            {
              accountId: "acc-1",
              matchedNetCents: 120_000,
              unmatchedNetCents: -45_000,
              unmatchedCount: 2,
              latestMatchedDate: "2026-11-20",
            },
          ]),
        }),
      }),
    };

    vi.mocked(db.select)
      .mockReturnValueOnce(accountsChain as never)
      .mockReturnValueOnce(sumsChain as never);

    const balances = await getReconciledAccountBalances("comp-1");
    expect(balances).toHaveLength(2);

    expect(balances[0]).toEqual({
      id: "acc-1",
      label: "Cuenta Operativa",
      bankName: "BBVA",
      accountLastFour: "4321",
      openingAsOfDate: "2026-11-01",
      asOfDate: "2026-11-20",
      openingBalanceCents: 500_000,
      reconciledBalanceCents: 620_000,
      statementBalanceCents: 575_000,
      unmatchedDeltaCents: -45_000,
      unmatchedCount: 2,
      balanceCents: 620_000,
    });

    // Cuenta sin movimientos posteriores conserva su fecha de ancla y saldo conciliado exacto
    expect(balances[1]).toEqual({
      id: "acc-2",
      label: "Cuenta Recepción",
      bankName: "Santander",
      accountLastFour: "9876",
      openingAsOfDate: "2026-11-10",
      asOfDate: "2026-11-10",
      openingBalanceCents: 200_000,
      reconciledBalanceCents: 200_000,
      statementBalanceCents: 200_000,
      unmatchedDeltaCents: 0,
      unmatchedCount: 0,
      balanceCents: 200_000,
    });
  });

  it("sin ancla bancaria ni saldo inicial NO calcula saldo mínimo aparente ($0) ni runway (30+ días)", () => {
    const metrics = computeCashFlowHeroMetrics(
      {
        initialBalanceCents: null,
        openingBalance: {
          source: "NONE",
          balanceSource: "NO_ANCHOR",
          asOfDate: null,
          ageInDays: null,
          isStale: false,
        },
        days: [
          {
            date: "2026-11-25",
            projectedInflowCents: 50_000,
            projectedOutflowCents: 30_000,
            cumulativeBalanceCents: null,
          },
          {
            date: "2026-11-26",
            projectedInflowCents: 50_000,
            projectedOutflowCents: 40_000,
            cumulativeBalanceCents: null,
          },
        ],
      },
      30,
    );

    expect(metrics.hasAbsoluteBalance).toBe(false);
    expect(metrics.hasBankAnchor).toBe(false);
    expect(metrics.minBalanceCents).toBeNull();
    expect(metrics.endingBalanceCents).toBeNull();
    expect(metrics.runwayDays).toBeNull();
    expect(metrics.statusLevel).toBe("UNANCHORED");
    expect(metrics.totalInflowCents).toBe(100_000);
    expect(metrics.totalOutflowCents).toBe(70_000);
    expect(metrics.netFlowCents).toBe(30_000);
  });

  it("describeOpeningBalance declara fuente, fecha y cuenta para banco conciliado, supuesto manual y sin ancla", () => {
    const bankDesc = describeOpeningBalance(
      {
        source: "ACCOUNTS",
        balanceSource: "BANK_RECONCILED",
        isBankAnchored: true,
        asOfDate: "2026-11-20",
        ageInDays: 5,
        isStale: false,
        accountBreakdown: [
          {
            id: "acc-1",
            label: "Cuenta Operativa",
            bankName: "BBVA",
            accountLastFour: "4321",
            asOfDate: "2026-11-20",
            reconciledBalanceCents: 620_000,
            balanceCents: 620_000,
          },
        ],
      },
      620_000,
    );
    expect(bankDesc).toEqual({
      balanceSource: "BANK_RECONCILED",
      sourceLabel: "Saldo bancario conciliado",
      isBankAnchored: true,
      hasAbsoluteBalance: true,
      effectiveAsOfDate: "2026-11-20",
      accountsSummary: "BBVA · Cuenta Operativa ····4321",
      projectionDisclaimer: CASH_FLOW_PROJECTION_DISCLAIMER,
    });

    const manualDesc = describeOpeningBalance(
      {
        source: "BRANCH",
        asOfDate: "2026-11-18",
        ageInDays: 7,
        isStale: false,
      },
      150_000,
      { branchId: "br-1", branchName: "Polanco" },
    );
    expect(manualDesc.balanceSource).toBe("MANUAL_BRANCH");
    expect(manualDesc.isBankAnchored).toBe(false);
    expect(manualDesc.sourceLabel).toContain("sin ancla bancaria");
    expect(manualDesc.effectiveAsOfDate).toBe("2026-11-18");
    expect(manualDesc.accountsSummary).toBe("Caja/supuesto de Polanco");

    const noAnchorDesc = describeOpeningBalance(
      {
        source: "NONE",
        asOfDate: null,
        ageInDays: null,
        isStale: false,
      },
      null,
    );
    expect(noAnchorDesc.balanceSource).toBe("NO_ANCHOR");
    expect(noAnchorDesc.isBankAnchored).toBe(false);
    expect(noAnchorDesc.hasAbsoluteBalance).toBe(false);
    expect(noAnchorDesc.effectiveAsOfDate).toBeNull();
    expect(noAnchorDesc.accountsSummary).toBeNull();
  });
});
