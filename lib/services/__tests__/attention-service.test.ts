import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDetectViolations = vi.fn();
vi.mock("@/lib/services/control-interno-service", () => ({
  detectViolations: (...args: unknown[]) => mockDetectViolations(...args),
}));

const mockGetOperatingExpenses = vi.fn();
vi.mock("@/lib/services/expense-service", () => ({
  getOperatingExpenses: (...args: unknown[]) => mockGetOperatingExpenses(...args),
}));

const mockCheckBudgetAvailability = vi.fn();
vi.mock("@/lib/services/budget-service", () => ({
  checkBudgetAvailability: (...args: unknown[]) => mockCheckBudgetAvailability(...args),
}));

const mockSelect = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    select: () => mockSelect(),
  },
}));

import { getAttentionSummary } from "../attention-service";

describe("AttentionService: getAttentionSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates violations, pending expenses, cash variances, and TPV variances", async () => {
    mockDetectViolations.mockResolvedValueOnce([
      {
        id: "v-1",
        type: "SELF_APPROVAL",
        severity: "HIGH",
        description: "Gasto auto-aprobado",
        detail: "Mismo usuario registró y aprobó",
        branchName: "Centro",
        amountCents: 50000,
        createdAt: new Date(),
      },
    ]);

    mockGetOperatingExpenses.mockResolvedValueOnce({
      items: [
        {
          id: "exp-1",
          branchName: "San Pedro",
          category: "MANTENIMIENTO",
          amountCents: 120000,
          description: "Reparación cafetera",
          createdAt: new Date(Date.now() - 3 * 86_400_000), // 3 days ago -> HIGH
          requiredApproverRole: "GERENTE",
        },
      ],
      truncated: false,
    });

    // Mock DB select query for dailySalesCuts
    const mockFrom = vi.fn();
    const mockInnerJoin = vi.fn();
    const mockWhere = vi.fn();
    const mockOrderBy = vi.fn();

    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ innerJoin: mockInnerJoin });
    mockInnerJoin.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });

    mockOrderBy.mockResolvedValueOnce([
      {
        id: "cut-1",
        branchId: "b-1",
        branchName: "Centro",
        businessDate: "2026-09-14",
        shift: "Cena",
        cashSales: 10000,
        cashCountedCents: 8500, // faltante de 1500 -> HIGH
        cardSales: 20000,
        tpvDepositCents: 19000,
        commissionCents: 600, // (19000 + 600) - 20000 = -400 -> TPV faltante
      },
    ]);

    const result = await getAttentionSummary("comp-1", "b-1");

    expect(result.sourceStatuses).toEqual({
      violations: "available",
      expenses: "available",
      cuts: "available",
    });

    expect(result.counts.total).toBe(4); // 1 violation, 1 expense, 1 cash variance, 1 TPV variance
    expect(result.counts.high).toBe(4); // v-1, exp-1 (3d old), cut-cash (-1500), cut-tpv (-400)
    expect(result.counts.expense).toBe(1);
    expect(result.counts.cutCash).toBe(1);
    expect(result.counts.cutTpv).toBe(1);
    expect(result.counts.violation).toBe(1);

    // Check items content
    const tpvItem = result.items.find((i) => i.sourceType === "cut_tpv");
    expect(tpvItem).toBeDefined();
    expect(tpvItem?.title).toBe("Depósito TPV con faltante");
    expect(tpvItem?.amountCents).toBe(-400);
    expect(tpvItem?.href).toBe("/dashboard/sales?focus=cut-1");

    const cashItem = result.items.find((i) => i.sourceType === "cut_cash");
    expect(cashItem).toBeDefined();
    expect(cashItem?.title).toBe("Arqueo con faltante");
    expect(cashItem?.amountCents).toBe(-1500);
    expect(cashItem?.href).toBe("/dashboard/sales?focus=cut-1");
  });

  it("handles source failure gracefully and reports partial availability", async () => {
    mockDetectViolations.mockRejectedValueOnce(new Error("Timeout detecting violations"));

    mockGetOperatingExpenses.mockResolvedValueOnce({
      items: [],
      truncated: false,
    });

    const mockFrom = vi.fn();
    const mockInnerJoin = vi.fn();
    const mockWhere = vi.fn();
    const mockOrderBy = vi.fn();

    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ innerJoin: mockInnerJoin });
    mockInnerJoin.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValueOnce([]);

    const result = await getAttentionSummary("comp-1", null);

    expect(result.sourceStatuses.violations).toBe("unavailable");
    expect(result.sourceStatuses.expenses).toBe("available");
    expect(result.sourceStatuses.cuts).toBe("available");
    expect(result.counts.total).toBe(0);
  });

  it("enriches pending expenses with payee, cost center, and budget availability", async () => {
    mockDetectViolations.mockResolvedValueOnce([]);

    mockGetOperatingExpenses.mockResolvedValueOnce({
      items: [
        {
          id: "exp-budget-1",
          branchId: "b-1",
          branchName: "San Pedro",
          category: "INSUMOS",
          amountCents: 50000,
          description: "Compra de café de grano",
          createdAt: new Date(),
          requiredApproverRole: "ADMIN",
          payeeName: "Tostaduría Gourmet",
          costCenterId: "cc-1",
          costCenterName: "Cafetería y Barra",
          costCenterCode: "CB-01",
          requestedByName: "Carlos Barista",
          evidenceUrl: "https://r2.pulso.app/receipts/exp-1.pdf",
        },
      ],
      truncated: false,
    });

    mockCheckBudgetAvailability.mockResolvedValueOnce({
      budgeted: 100000,
      committed: 40000,
      available: 60000,
      requested: 50000,
      ok: true,
    });

    const mockFrom = vi.fn();
    const mockInnerJoin = vi.fn();
    const mockWhere = vi.fn();
    const mockOrderBy = vi.fn();

    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ innerJoin: mockInnerJoin });
    mockInnerJoin.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValueOnce([]);

    const result = await getAttentionSummary("comp-1", "b-1");

    expect(result.items.length).toBe(1);
    const item = result.items[0];
    expect(item.payeeName).toBe("Tostaduría Gourmet");
    expect(item.costCenterName).toBe("Cafetería y Barra");
    expect(item.costCenterCode).toBe("CB-01");
    expect(item.requestedByName).toBe("Carlos Barista");
    expect(item.evidenceUrl).toBe("https://r2.pulso.app/receipts/exp-1.pdf");
    expect(item.budgetContext).toEqual({
      budgetedCents: 100000,
      committedCents: 40000,
      availableCents: 60000,
      ok: true,
    });
  });
});
