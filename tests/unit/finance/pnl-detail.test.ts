import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPnlDetail, pnlDetailQuerySchema } from "@/lib/services/pnl-detail-service";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/finance/pnl/detail/route";
import { ApiError } from "@/lib/api/error";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute } }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: authorize }));
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
      { pageSize: 101 }, { page: 10001 }, { branchId: "bad" }, { line: "labor" },
    ]) expect(pnlDetailQuerySchema.safeParse({ ...input, ...change }).success).toBe(false);
    expect(pnlDetailQuerySchema.parse({ branchId, line: "sales" })).toMatchObject({ page: 1, pageSize: 25 });
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
