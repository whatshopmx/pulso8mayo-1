// lib/services/__tests__/financial-period-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockFreezePnLPeriod = vi.fn();
vi.mock("../pnl-snapshot-service", () => ({
  freezePnLPeriod: (...args: unknown[]) => mockFreezePnLPeriod(...args),
}));

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
    update: () => mockUpdate(),
  },
}));

import { closeFinancialPeriod } from "../financial-period-service";

describe("financial-period-service: closeFinancialPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error and preserves OPEN status if freezePnLPeriod throws", async () => {
    mockFreezePnLPeriod.mockRejectedValueOnce(
      new Error("Database timeout while calculating branch PnL")
    );

    await expect(
      closeFinancialPeriod({
        companyId: "comp-1",
        year: 2026,
        month: 8,
        closedBy: "user-admin",
      })
    ).rejects.toThrow(/falló la congelación y preservación del snapshot de P&L/);

    // Verify DB update or insert was NEVER reached
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("completes close and marks CLOSED if freezePnLPeriod succeeds for existing record", async () => {
    mockFreezePnLPeriod.mockResolvedValueOnce({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      branchCount: 3,
      estimatedBranchCount: 0,
    });

    const mockPeriod = {
      id: "fp-1",
      companyId: "comp-1",
      year: 2026,
      month: 8,
      status: "CLOSED",
      closedBy: "user-admin",
    };

    // mock select().from().where().limit() -> [existing]
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: "fp-1", status: "OPEN" }]),
        }),
      }),
    });

    // mock update().set().where().returning() -> [updated]
    mockUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([mockPeriod]),
        }),
      }),
    });

    const result = await closeFinancialPeriod({
      companyId: "comp-1",
      year: 2026,
      month: 8,
      closedBy: "user-admin",
    });

    expect(mockFreezePnLPeriod).toHaveBeenCalledWith(
      "comp-1",
      "2026-08-01",
      "2026-08-31",
      "user-admin"
    );
    expect(result.status).toBe("CLOSED");
  });
});
