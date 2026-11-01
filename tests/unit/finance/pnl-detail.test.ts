import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPnlDetail, pnlDetailQuerySchema } from "@/lib/services/pnl-detail-service";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/finance/pnl/detail/route";
import { ApiError } from "@/lib/api/error";
import * as pnlService from "@/lib/services/pnl-service";
import { getLaborCostByBranch } from "@/lib/services/labor-cost-service";
import { getCommissionsByBranch } from "@/lib/services/commission-service";
import type { BranchPnL } from "@/lib/services/pnl-types";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute } }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: authorize }));
vi.mock("@/lib/services/labor-cost-service", () => ({ getLaborCostByBranch: vi.fn() }));
vi.mock("@/lib/services/commission-service", () => ({ getCommissionsByBranch: vi.fn() }));
const laborMock = vi.mocked(getLaborCostByBranch);
const commissionMock = vi.mocked(getCommissionsByBranch);
const companyId = "00000000-0000-4000-8000-000000000001";
const branchId = "00000000-0000-4000-8000-000000000002";
const input = { companyId, scope: { kind: "ALL" as const }, branchId, line: "sales" as const,
  startDate: "2026-10-01", endDate: "2026-10-31", page: 1, pageSize: 1 };

describe("P&L source detail boundary", () => {
  beforeEach(() => { execute.mockReset(); });
  it("rejects missing scope and another branch before reading documents", async () => {
    await expect(getPnlDetail({ ...input, scope: { kind: "NONE" } })).rejects.toMatchObject({ statusCode: 403 });
    await expect(getPnlDetail({ ...input, scope: { kind: "BRANCH", branchId: companyId } })).rejects.toMatchObject({ statusCode: 403 });
    expect(execute).not.toHaveBeenCalled();
  });
  it("validates real dates, order, supported lines and bounded integer pagination", () => {
    for (const change of [
      { startDate: "2026-02-30" }, { startDate: "0000-01-01" }, { endDate: "2026-09-30" }, { page: 0 }, { page: 1.5 },
      { pageSize: 101 }, { page: 10001 }, { branchId: "bad" }, { line: "taxes" },
      { startDate: "2020-01-01" },
    ]) expect(pnlDetailQuerySchema.safeParse({ ...input, ...change }).success).toBe(false);
    for (const line of ["labor", "commissions", "operatingProfit"] as const) {
      expect(pnlDetailQuerySchema.safeParse({ ...input, line }).success).toBe(true);
    }
    expect(pnlDetailQuerySchema.parse({ branchId, line: "sales" })).toMatchObject({ page: 1, pageSize: 25 });
    expect(pnlDetailQuerySchema.safeParse({ ...input, startDate: "2024-01-01", endDate: "2024-12-31" }).success).toBe(true);
    expect(pnlDetailQuerySchema.safeParse({ ...input, startDate: "2023-12-31", endDate: "2024-12-31" }).success).toBe(false);
  });
  it("accepts inventory lines but still denies hidden branches before valuation", async () => {
    for (const line of ["foodCost", "waste"] as const) {
      expect(pnlDetailQuerySchema.safeParse({ ...input, line }).success).toBe(true);
      await expect(getPnlDetail({ ...input, line, scope: { kind: "NONE" } })).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it("returns the full total independent of the page and keeps sales coverage", async () => {
    execute.mockResolvedValue({ rows: [{ total_count: 2, total_cents: "35000", days: 2,
      id: "cut-2", date: "2026-10-02", cents: "20000", label: "Corte", status: "PENDING_REVIEW", cost_center: null }] });
    const detail = await getPnlDetail(input);
    expect(detail).toMatchObject({ totalCents: 35000, totalCount: 2, hasMore: true,
      source: "MEASURED", coveragePercent: 6, page: 1, pageSize: 1 });
    expect(detail.items).toEqual([{ id: "cut-2", date: "2026-10-02", cents: 20000,
      label: "Corte", status: "PENDING_REVIEW", costCenter: null }]);
  });
  it("preserves totals beyond the last page without inventing documents", async () => {
    execute.mockResolvedValue({ rows: [{ total_count: 2, total_cents: "35000", days: 2, id: null }] });
    expect(await getPnlDetail({ ...input, page: 3 })).toMatchObject({ totalCents: 35000, items: [], hasMore: false });
  });
  it("distinguishes missing data from a measured zero", async () => {
    execute.mockResolvedValue({ rows: [{ total_count: 0, total_cents: "0", days: 0, id: null }] });
    expect(await getPnlDetail(input)).toMatchObject({ source: "NO_DATA", coveragePercent: 0, items: [] });
  });
  it("does not reveal whether a branch belongs to another company", async () => {
    execute.mockResolvedValue({ rows: [] });
    await expect(getPnlDetail(input)).rejects.toMatchObject({ statusCode: 404 });
  });
  it("rejects totals that cannot be represented as exact integer cents", async () => {
    execute.mockResolvedValue({ rows: [{ total_count: 1, total_cents: "9007199254740992", days: 1 }] });
    await expect(getPnlDetail(input)).rejects.toMatchObject({ statusCode: 409 });
  });
  it("does not invent empty detail if inventory appears while calculating a fallback", async () => {
    execute.mockResolvedValue({ rows: [{ usage_count: 0, waste_count: 0, receiving_count: 0,
      foreign_count: 0, total_count: 0, total_raw: "0", rounded_total: "0", id: null }] });
    const current = vi.spyOn(pnlService, "getPnLByBranch").mockResolvedValue([
      { branchId, foodCost: { cents: 50, source: "MEASURED", coveragePercent: 100 } } as BranchPnL,
    ]);
    try {
      await expect(getPnlDetail({ ...input, line: "foodCost" })).rejects.toMatchObject({ statusCode: 409 });
    } finally { current.mockRestore(); }
  });
});

describe("P&L derived detail (labor, commissions, profit)", () => {
  const branchName = "Sucursal";
  const row = (cents: number, source: BranchPnL["labor"]["source"], coveragePercent = 100,
    note = "nota del renglón") => ({ cents, percentOfSales: null, source, coveragePercent, note });
  const profit = 100_000 - (25_000 + 2_000 + 30_000 + 10_000 + 3_355 + 500);
  const branch = (overrides: Partial<BranchPnL> = {}): BranchPnL => ({
    branchId, branchName,
    sales: row(116_000, "MEASURED"),
    foodCost: row(25_000, "MEASURED"),
    waste: row(2_000, "MEASURED"),
    labor: row(30_000, "DERIVED"),
    operatingExpenses: row(10_000, "MEASURED"),
    pettyCash: row(500, "MEASURED"),
    commissions: row(3_355, "ESTIMATED"),
    operatingProfit: row(profit, "DERIVED"),
    weakestLine: "ESTIMATED",
    salesBase: { kind: "NET_MEASURED", baseCents: 100_000, grossCents: 116_000,
      taxCents: 16_000, cutsWithTax: 1, cutsCount: 1, note: "base neta medida" },
    ...overrides,
  });
  const pnl = (rows: BranchPnL[]) => vi.spyOn(pnlService, "getPnLByBranch").mockResolvedValue(rows);
  const derived = (line: "labor" | "commissions" | "operatingProfit") => getPnlDetail({ ...input, line });
  const sum = (values: Array<{ cents: number }>) => values.reduce((total, value) => total + value.cents, 0);

  beforeEach(() => {
    execute.mockReset(); laborMock.mockReset(); commissionMock.mockReset();
    vi.restoreAllMocks();
    laborMock.mockResolvedValue([]); commissionMock.mockResolvedValue([]);
  });

  it("denies scope before reading the P&L or the calculated sources", async () => {
    const read = pnl([branch()]);
    for (const line of ["labor", "commissions", "operatingProfit"] as const) {
      await expect(getPnlDetail({ ...input, line, scope: { kind: "NONE" } }))
        .rejects.toMatchObject({ statusCode: 403 });
      await expect(getPnlDetail({ ...input, line, scope: { kind: "BRANCH", branchId: companyId } }))
        .rejects.toMatchObject({ statusCode: 403 });
    }
    expect(read).not.toHaveBeenCalled();
    expect(laborMock).not.toHaveBeenCalled();
    expect(commissionMock).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("explains payroll with components that add up to the published line", async () => {
    pnl([branch({ labor: row(30_000, "DERIVED", 0) })]);
    laborMock.mockResolvedValue([{ branchId, baseCostCents: 25_000, overtimeCostCents: 5_000,
      totalCostCents: 30_000, headcount: 2, source: "CONTRACT_ONLY", coveragePercent: 0,
      note: "plantilla", provisionAguinaldoCents: 1_200 }]);
    const detail = await derived("labor");
    expect(detail).toMatchObject({ totalCents: 30_000, source: "DERIVED", totalCount: 0,
      hasMore: false, basis: "CALCULATION", items: [], calculation: { kind: "LABOR", cents: 30_000, headcount: 2 } });
    expect(detail.calculation.components).toEqual([
      { key: "base", label: "Sueldo base devengado", cents: 25_000, source: "DERIVED" },
      { key: "overtime", label: "Horas extra y prima de día festivo", cents: 5_000, source: "DERIVED" },
    ]);
    expect(sum(detail.calculation.components)).toBe(detail.totalCents);
    // La provisión de aguinaldo se explica pero NO se suma: no es pasivo del P&L.
    expect(detail.calculation.informative).toEqual([expect.objectContaining({ key: "aguinaldoProvision", cents: 1_200 })]);
    expect(sum(detail.calculation.informative!)).not.toBe(detail.totalCents);
  });

  it("declares a sector payroll estimate without inventing components", async () => {
    pnl([branch({ labor: row(26_200, "SECTOR_DEFAULT", 0, "Estimación sectorial HORECA (26.2% de ventas).") })]);
    const detail = await derived("labor");
    expect(detail).toMatchObject({ totalCents: 26_200, source: "SECTOR_DEFAULT", coveragePercent: 0,
      calculation: { kind: "LABOR", cents: 26_200, components: [],
        note: "Estimación sectorial HORECA (26.2% de ventas)." } });
    expect(laborMock).not.toHaveBeenCalled();
  });

  it("rejects changed payroll provenance even when the amount is unchanged", async () => {
    pnl([branch()]);
    laborMock.mockResolvedValue([{ branchId, baseCostCents: 25_000, overtimeCostCents: 5_000,
      totalCostCents: 30_000, headcount: 2, source: "MEASURED", coveragePercent: 100, note: "turnos" }]);
    await expect(derived("labor")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects changed commission coverage even when the amount is unchanged", async () => {
    pnl([branch()]);
    commissionMock.mockResolvedValue([{ branchId, totalCommissionCents: 3_355, coveredSalesCents: 10_000,
      uncoveredSalesCents: 500, source: "ESTIMATED", coveragePercent: 95, note: "tarifa",
      channels: [{ channel: "rappi", baseSalesCents: 10_000, commissionCents: 3_355, measuredCents: 0,
        estimatedCents: 3_355, rateBps: 2_750, vatBps: 1_600, source: "ESTIMATED", cutsCount: 1 }] }]);
    await expect(derived("commissions")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses a payroll breakdown that no longer matches the published line", async () => {
    pnl([branch()]);
    laborMock.mockResolvedValue([{ branchId, baseCostCents: 25_000, overtimeCostCents: 5_001,
      totalCostCents: 30_001, headcount: 2, source: "MEASURED", coveragePercent: 50, note: "turnos" }]);
    await expect(derived("labor")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("explains commissions per channel with base, rate and measured part", async () => {
    pnl([branch({ commissions: row(3_355, "ESTIMATED", 95),
      commissionsByChannel: [{ channel: "rappi", cents: 3_355, rateBps: 2_750, measured: false }] })]);
    commissionMock.mockResolvedValue([{ branchId, totalCommissionCents: 3_355, coveredSalesCents: 10_000,
      uncoveredSalesCents: 500, source: "ESTIMATED", coveragePercent: 95, note: "tarifa vigente",
      channels: [{ channel: "rappi", baseSalesCents: 10_000, commissionCents: 3_355, measuredCents: 0,
        estimatedCents: 3_355, rateBps: 2_750, vatBps: 1_600, source: "ESTIMATED", cutsCount: 3 }] }]);
    const detail = await derived("commissions");
    expect(detail).toMatchObject({ totalCents: 3_355, source: "ESTIMATED", totalCount: 0, items: [],
      calculation: { kind: "COMMISSIONS", cents: 3_355, coveredSalesCents: 10_000, uncoveredSalesCents: 500 } });
    expect(detail.calculation.components).toEqual([{ key: "rappi", label: "Rappi", cents: 3_355,
      source: "ESTIMATED", baseCents: 10_000, rateBps: 2_750, vatBps: 1_600, measuredCents: 0 }]);
    expect(sum(detail.calculation.components)).toBe(detail.totalCents);
  });

  it("keeps a commission gap as NO_DATA instead of inventing documents or a zero", async () => {
    pnl([branch({ commissions: row(0, "NO_DATA", 0,
      "Hay venta por canales que cobran comisión y ninguna tarifa configurada.") })]);
    commissionMock.mockResolvedValue([{ branchId, channels: [], totalCommissionCents: 0,
      coveredSalesCents: 0, uncoveredSalesCents: 4_200, source: "NO_DATA", coveragePercent: 0,
      note: "sin tarifa" }]);
    const detail = await derived("commissions");
    expect(detail).toMatchObject({ totalCents: 0, totalCount: 0, items: [], source: "NO_DATA",
      calculation: { cents: 0, components: [], uncoveredSalesCents: 4_200,
        note: "Hay venta por canales que cobran comisión y ninguna tarifa configurada." } });
  });

  it("bridges every P&L component into operating profit with explicit signs", async () => {
    pnl([branch()]);
    const detail = await derived("operatingProfit");
    expect(detail).toMatchObject({ totalCents: profit, source: "DERIVED", totalCount: 0, items: [],
      calculation: { kind: "PROFIT_BRIDGE", cents: profit, weakestLine: "ESTIMATED",
        salesBaseKind: "NET_MEASURED" } });
    expect(detail.calculation.components.map(component => [component.key, component.cents])).toEqual([
      ["salesBase", 100_000], ["foodCost", -25_000], ["waste", -2_000], ["labor", -30_000],
      ["operatingExpenses", -10_000], ["commissions", -3_355], ["pettyCash", -500],
    ]);
    expect(sum(detail.calculation.components)).toBe(detail.totalCents);
  });

  it("returns no bridge at all when there are no sales to explain", async () => {
    pnl([branch({ sales: row(0, "NO_DATA", 0, "Sin cortes"), operatingProfit: row(0, "NO_DATA", 0, "Sin ventas"),
      salesBase: undefined })]);
    expect(await derived("operatingProfit")).toMatchObject({ totalCents: 0, source: "NO_DATA",
      calculation: { kind: "PROFIT_BRIDGE", components: [], note: "Sin ventas" }, items: [] });
  });

  it("does not reveal a branch from another company on calculated lines", async () => {
    pnl([]);
    for (const line of ["labor", "commissions", "operatingProfit"] as const) {
      await expect(derived(line)).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(laborMock).not.toHaveBeenCalled();
    expect(commissionMock).not.toHaveBeenCalled();
  });

  it("serves a calculated line over HTTP with financial report permission", async () => {
    authorize.mockResolvedValue({ ctx: { userCompanyId: companyId, userRole: "ADMIN", userBranchId: null },
      decision: { redactFields: [] } });
    pnl([branch()]);
    const response = await GET(new NextRequest(`http://localhost/api/finance/pnl/detail?branchId=${branchId}&line=operatingProfit`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ data: { totalCents: profit, line: "operatingProfit" } });
  });
});

describe("P&L detail HTTP access", () => {
  beforeEach(() => {
    execute.mockReset(); authorize.mockReset();
    authorize.mockResolvedValue({ ctx: { userCompanyId: companyId, userRole: "ADMIN", userBranchId: null }, decision: { redactFields: [] } });
    execute.mockResolvedValue({ rows: [{ total_count: 0, total_cents: "0", days: 0, id: null }] });
  });
  const request = (query = `branchId=${branchId}&line=sales`) => new NextRequest(`http://localhost/api/finance/pnl/detail?${query}`);
  it("requires the financial report permission and disables shared caching", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(authorize).toHaveBeenCalledWith("reports", "read", expect.objectContaining({ classification: "FINANCIAL" }));
  });
  it("denies unauthorized requests before querying", async () => {
    authorize.mockRejectedValue(ApiError.forbidden("Sin permiso"));
    expect((await GET(request())).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not allow a manager to select another branch", async () => {
    authorize.mockResolvedValue({ ctx: { userCompanyId: companyId, userRole: "GERENTE", userBranchId: companyId }, decision: { redactFields: [] } });
    expect((await GET(request())).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it("denies a manager without an assigned branch", async () => {
    authorize.mockResolvedValue({ ctx: { userCompanyId: companyId, userRole: "GERENTE", userBranchId: null }, decision: { redactFields: [] } });
    expect((await GET(request())).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it("returns validation errors without querying", async () => {
    expect((await GET(request(`branchId=${branchId}&line=sales&page=0`))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not expose database errors or parameters to the client", async () => {
    execute.mockRejectedValue(new Error("secret database connection details"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
