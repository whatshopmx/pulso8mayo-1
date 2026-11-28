import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";

const requireTenantAuthMock = vi.fn();
const dbSelectMock = vi.fn();
const getCommittedByPairMock = vi.fn();

vi.mock("@/lib/api/with-auth", () => ({
  requireTenantAuth: (...args: unknown[]) => requireTenantAuthMock(...args),
}));
vi.mock("@/lib/db", () => ({
  db: { select: (...args: unknown[]) => dbSelectMock(...args) },
}));
vi.mock("@/lib/services/budget-service", () => ({
  computeBudgetStatus: (budgeted: number | null, committedList: number[]) => {
    const b = budgeted ?? 0;
    const c = committedList.reduce((a, n) => a + n, 0);
    return { budgeted: b, committed: c, available: b - c };
  },
  getCommittedByPair: (...args: unknown[]) => getCommittedByPairMock(...args),
}));

import { GET } from "@/app/api/budgets/route";

const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
const BRANCH_POLANCO = "b1000001-0000-4000-8000-000000000002";

function collectStrings(value: unknown, seen = new WeakSet<object>(), out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, seen, out);
  } else {
    for (const [k, v] of Object.entries(value)) {
      if (k === "table") continue;
      collectStrings(v, seen, out);
    }
  }
  return out;
}

function mockDbBranchesAndCostCenters(
  allBranches: Array<{ id: string; name: string; code: string | null }>,
) {
  let callIndex = 0;
  dbSelectMock.mockImplementation(() => {
    const idx = callIndex++;
    if (idx === 0) {
      return {
        from: () => ({
          where: () => ({
            orderBy: async () => allBranches,
          }),
        }),
      };
    }
    if (idx === 1) {
      return {
        from: () => ({
          where: () => ({
            orderBy: async () => [
              { id: "cc-1", code: "CC-ALM", name: "Alimentos", accountingLine: "COGS" },
            ],
          }),
        }),
      };
    }
    return {
      from: () => ({
        where: async () => [],
      }),
    };
  });
}

describe("GET /api/budgets — Task 5 permissions and branch scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommittedByPairMock.mockResolvedValue(new Map());
  });

  it.each<Role>(["EMPLEADO", "SUPERVISOR", "READONLY"])("denies %s with 403 before querying DB", async (role) => {
    requireTenantAuthMock.mockResolvedValue({
      user: { id: "u-1", role, companyId: "c-1", branchId: BRANCH_CONDESA },
      tenantId: "c-1",
      branchId: BRANCH_CONDESA,
    });

    const res = await GET(new NextRequest("http://localhost/api/budgets?month=2026-11"));
    expect(res.status).toBe(403);
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  it.each<Role>(["SUPER_ADMIN", "OWNER", "ADMIN"])(
    "allows %s even with assigned session branchId to query ALL branches when no branchId param is sent",
    async (role) => {
      requireTenantAuthMock.mockResolvedValue({
        user: { id: "u-1", role, companyId: "c-1", branchId: BRANCH_CONDESA },
        tenantId: "c-1",
        branchId: BRANCH_CONDESA,
      });

      let branchWhereArg: unknown;
      let callIndex = 0;
      dbSelectMock.mockImplementation(() => {
        const idx = callIndex++;
        if (idx === 0) {
          return {
            from: () => ({
              where: (cond: unknown) => {
                branchWhereArg = cond;
                return {
                  orderBy: async () => [
                    { id: BRANCH_CONDESA, name: "Condesa", code: "CON" },
                    { id: BRANCH_POLANCO, name: "Polanco", code: "POL" },
                  ],
                };
              },
            }),
          };
        }
        if (idx === 1) {
          return {
            from: () => ({
              where: () => ({
                orderBy: async () => [
                  { id: "cc-1", code: "CC-ALM", name: "Alimentos", accountingLine: "COGS" },
                ],
              }),
            }),
          };
        }
        return { from: () => ({ where: async () => [] }) };
      });

      const res = await GET(new NextRequest("http://localhost/api/budgets?month=2026-11"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rows).toHaveLength(2);
      // Verify the WHERE clause did NOT include a branchId filter for Condesa
      expect(collectStrings(branchWhereArg)).not.toContain(BRANCH_CONDESA);
    },
  );

  it("allows SUPER_ADMIN to filter by explicit ?branchId= parameter", async () => {
    requireTenantAuthMock.mockResolvedValue({
      user: { id: "u-1", role: "SUPER_ADMIN", companyId: "c-1", branchId: BRANCH_CONDESA },
      tenantId: "c-1",
      branchId: BRANCH_CONDESA,
    });

    let branchWhereArg: unknown;
    let callIndex = 0;
    dbSelectMock.mockImplementation(() => {
      const idx = callIndex++;
      if (idx === 0) {
        return {
          from: () => ({
            where: (cond: unknown) => {
              branchWhereArg = cond;
              return {
                orderBy: async () => [{ id: BRANCH_POLANCO, name: "Polanco", code: "POL" }],
              };
            },
          }),
        };
      }
      if (idx === 1) {
        return {
          from: () => ({
            where: () => ({
              orderBy: async () => [
                { id: "cc-1", code: "CC-ALM", name: "Alimentos", accountingLine: "COGS" },
              ],
            }),
          }),
        };
      }
      return { from: () => ({ where: async () => [] }) };
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/budgets?month=2026-11&branchId=${BRANCH_POLANCO}`),
    );
    expect(res.status).toBe(200);
    const params = collectStrings(branchWhereArg);
    expect(params).toContain(BRANCH_POLANCO);
    expect(params).not.toContain(BRANCH_CONDESA);
  });

  it("forces GERENTE to their assigned branch even when requesting another branchId", async () => {
    requireTenantAuthMock.mockResolvedValue({
      user: { id: "u-3", role: "GERENTE", companyId: "c-1", branchId: BRANCH_CONDESA },
      tenantId: "c-1",
      branchId: BRANCH_CONDESA,
    });

    let branchWhereArg: unknown;
    let callIndex = 0;
    dbSelectMock.mockImplementation(() => {
      const idx = callIndex++;
      if (idx === 0) {
        return {
          from: () => ({
            where: (cond: unknown) => {
              branchWhereArg = cond;
              return {
                orderBy: async () => [{ id: BRANCH_CONDESA, name: "Condesa", code: "CON" }],
              };
            },
          }),
        };
      }
      if (idx === 1) {
        return {
          from: () => ({
            where: () => ({
              orderBy: async () => [
                { id: "cc-1", code: "CC-ALM", name: "Alimentos", accountingLine: "COGS" },
              ],
            }),
          }),
        };
      }
      return { from: () => ({ where: async () => [] }) };
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/budgets?month=2026-11&branchId=${BRANCH_POLANCO}`),
    );
    expect(res.status).toBe(200);
    const params = collectStrings(branchWhereArg);
    expect(params).toContain(BRANCH_CONDESA);
    expect(params).not.toContain(BRANCH_POLANCO);
  });

  it("returns empty rows fail-closed when GERENTE has no assigned branch", async () => {
    requireTenantAuthMock.mockResolvedValue({
      user: { id: "u-3", role: "GERENTE", companyId: "c-1", branchId: null },
      tenantId: "c-1",
      branchId: null,
    });
    mockDbBranchesAndCostCenters([]);

    const res = await GET(new NextRequest("http://localhost/api/budgets?month=2026-11"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(dbSelectMock).not.toHaveBeenCalled();
  });
});
