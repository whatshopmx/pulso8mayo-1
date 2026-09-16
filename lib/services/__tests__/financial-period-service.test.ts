// lib/services/__tests__/financial-period-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockFreezePnLPeriod = vi.fn();
vi.mock("../pnl-snapshot-service", () => ({
  freezePnLPeriod: (...args: unknown[]) => mockFreezePnLPeriod(...args),
}));

const mockLogDataAccess = vi.fn();
vi.mock("@/lib/security/audit", () => ({
  logDataAccess: (...args: unknown[]) => mockLogDataAccess(...args),
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

import {
  closeFinancialPeriod,
  reopenFinancialPeriod,
  isPeriodClosed,
} from "../financial-period-service";

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

    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: "fp-1", status: "OPEN" }]),
        }),
      }),
    });

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

  it("creates a new closed period if no previous record exists", async () => {
    mockFreezePnLPeriod.mockResolvedValueOnce({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      branchCount: 3,
      estimatedBranchCount: 0,
    });

    const mockPeriod = {
      id: "fp-new",
      companyId: "comp-1",
      year: 2026,
      month: 8,
      status: "CLOSED",
      closedBy: "user-admin",
    };

    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });

    mockInsert.mockReturnValue({
      values: () => ({
        returning: () => Promise.resolve([mockPeriod]),
      }),
    });

    const result = await closeFinancialPeriod({
      companyId: "comp-1",
      year: 2026,
      month: 8,
      closedBy: "user-admin",
    });

    expect(result.status).toBe("CLOSED");
    expect(result.id).toBe("fp-new");
  });

  it("is idempotent: re-running close after failure resolution succeeds and freezes again", async () => {
    // 1. First run fails
    mockFreezePnLPeriod.mockRejectedValueOnce(new Error("Transient connection error"));
    await expect(
      closeFinancialPeriod({
        companyId: "comp-1",
        year: 2026,
        month: 8,
        closedBy: "user-admin",
      })
    ).rejects.toThrow();

    // 2. Retry succeeds
    mockFreezePnLPeriod.mockResolvedValueOnce({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      branchCount: 3,
      estimatedBranchCount: 0,
    });

    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: "fp-1", status: "OPEN" }]),
        }),
      }),
    });

    mockUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () =>
            Promise.resolve([
              { id: "fp-1", companyId: "comp-1", year: 2026, month: 8, status: "CLOSED" },
            ]),
        }),
      }),
    });

    const retryResult = await closeFinancialPeriod({
      companyId: "comp-1",
      year: 2026,
      month: 8,
      closedBy: "user-admin",
    });

    expect(retryResult.status).toBe("CLOSED");
  });
});

describe("financial-period-service: reopenFinancialPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reopens period to OPEN and logs audit entry with author and reason", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });

    await reopenFinancialPeriod({
      companyId: "comp-1",
      year: 2026,
      month: 8,
      reopenedBy: "user-admin-123",
      reason: "Ajuste de factura tardía de proveedor",
    });

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "OPEN",
        closedAt: null,
        closedBy: null,
      })
    );

    expect(mockLogDataAccess).toHaveBeenCalledWith({
      userId: "user-admin-123",
      companyId: "comp-1",
      action: "UPDATE",
      resource: "financial_periods",
      resourceId: "2026-08",
      decision: {
        allowed: true,
        reason: "Ajuste de factura tardía de proveedor",
      },
    });
  });
});

describe("financial-period-service: isPeriodClosed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when period status is CLOSED", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ status: "CLOSED" }]),
        }),
      }),
    });

    const closed = await isPeriodClosed("comp-1", "2026-08-15");
    expect(closed).toBe(true);
  });

  it("returns false when period is OPEN or not found", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ status: "OPEN" }]),
        }),
      }),
    });

    const open = await isPeriodClosed("comp-1", "2026-08-15");
    expect(open).toBe(false);

    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });

    const notFound = await isPeriodClosed("comp-1", "2026-08-15");
    expect(notFound).toBe(false);
  });
});

