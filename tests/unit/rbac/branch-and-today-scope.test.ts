import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";

const requireTenantAuthMock = vi.fn();
const listBranchesMock = vi.fn();
const getSessionMock = vi.fn();
const getTodayMock = vi.fn();
const assertBranchOfCompanyMock = vi.fn();
const isPeriodClosedMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/api/with-auth", () => ({
  requireTenantAuth: (...args: unknown[]) => requireTenantAuthMock(...args),
  withRoleAuth:
    (allowedRoles: readonly Role[], handler: Function) =>
    async (req: NextRequest) => {
      const auth = await requireTenantAuthMock();
      if (!allowedRoles.includes(auth.user.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }
      return handler(req, { auth });
    },
}));

vi.mock("@/lib/services/branch-service", () => ({
  BranchService: {
    listBranches: (...args: unknown[]) => listBranchesMock(...args),
    createBranch: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

vi.mock("@/lib/services/workflow-today-service", () => ({
  WorkflowTodayService: {
    getToday: (...args: unknown[]) => getTodayMock(...args),
  },
}));

vi.mock("@/lib/branch-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/branch-scope")>();
  return {
    ...actual,
    assertBranchOfCompany: (...args: unknown[]) => assertBranchOfCompanyMock(...args),
  };
});

vi.mock("@/lib/services/financial-period-service", () => ({
  isPeriodClosed: (...args: unknown[]) => isPeriodClosedMock(...args),
}));

vi.mock("@/lib/services/cash-variance-alert-service", () => ({
  checkCashVarianceAndAlertSafe: vi.fn(),
}));

vi.mock("@/lib/services/accounting/sales-cut-capture", () => ({
  persistSalesCutInScope: vi.fn(),
}));

import { GET as branchesGET } from "@/app/api/branches/route";
import { GET as todayGET } from "@/app/api/workflows/today/route";
import { POST as salesCutsPOST } from "@/app/api/sales/cuts/route";

const COMPANY_ID = "c1000001-0000-4000-8000-000000000001";
const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
const BRANCH_POLANCO = "b1000001-0000-4000-8000-000000000002";
const BRANCH_ROMA = "b1000001-0000-4000-8000-000000000003";

const SAMPLE_BRANCHES = [
  {
    id: BRANCH_CONDESA,
    name: "Condesa",
    inviteToken: "inv-condesa",
    managerInviteToken: "mgr-condesa",
  },
  {
    id: BRANCH_POLANCO,
    name: "Polanco",
    inviteToken: "inv-polanco",
    managerInviteToken: "mgr-polanco",
  },
  {
    id: BRANCH_ROMA,
    name: "Roma",
    inviteToken: "inv-roma",
    managerInviteToken: "mgr-roma",
  },
];

describe("Task 8: /api/branches tokens, /api/workflows/today scope, POST /api/sales/cuts scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listBranchesMock.mockResolvedValue(SAMPLE_BRANCHES);
    getTodayMock.mockResolvedValue({ generatedAt: "2026-11-28T00:00:00Z", branches: [] });
    assertBranchOfCompanyMock.mockResolvedValue(undefined);
    isPeriodClosedMock.mockResolvedValue(false);
  });

  describe("GET /api/branches", () => {
    it.each<Role>(["EMPLEADO", "SUPERVISOR", "READONLY"])(
      "never exposes inviteToken or managerInviteToken to %s and filters to own branch",
      async (role) => {
        requireTenantAuthMock.mockResolvedValue({
          user: { id: "u-1", role, companyId: COMPANY_ID, branchId: BRANCH_POLANCO },
          tenantId: COMPANY_ID,
          branchId: BRANCH_POLANCO,
        });

        const res = await branchesGET(new NextRequest("http://localhost/api/branches"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data).toHaveLength(1);
        expect(body.data[0].id).toBe(BRANCH_POLANCO);
        expect(body.data[0].inviteToken).toBeUndefined();
        expect(body.data[0].managerInviteToken).toBeUndefined();
      },
    );

    it("gives GERENTE only their branch with inviteToken (and NO managerInviteToken)", async () => {
      requireTenantAuthMock.mockResolvedValue({
        user: { id: "u-ger", role: "GERENTE", companyId: COMPANY_ID, branchId: BRANCH_CONDESA },
        tenantId: COMPANY_ID,
        branchId: BRANCH_CONDESA,
      });

      const res = await branchesGET(new NextRequest("http://localhost/api/branches"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(BRANCH_CONDESA);
      expect(body.data[0].inviteToken).toBe("inv-condesa");
      expect(body.data[0].managerInviteToken).toBeUndefined();
    });

    it.each<Role>(["SUPER_ADMIN", "OWNER", "ADMIN"])(
      "gives %s all branches including both invite tokens",
      async (role) => {
        requireTenantAuthMock.mockResolvedValue({
          user: { id: "u-adm", role, companyId: COMPANY_ID, branchId: BRANCH_CONDESA },
          tenantId: COMPANY_ID,
          branchId: BRANCH_CONDESA,
        });

        const res = await branchesGET(new NextRequest("http://localhost/api/branches"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data).toHaveLength(3);
        expect(body.data[0].inviteToken).toBe("inv-condesa");
        expect(body.data[0].managerInviteToken).toBe("mgr-condesa");
      },
    );
  });

  describe("GET /api/workflows/today", () => {
    it.each<Role>(["GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"])(
      "forces %s to own branch even when no ?branchId= or another ?branchId= is sent",
      async (role) => {
        getSessionMock.mockResolvedValue({
          user: { id: "u-1", role, companyId: COMPANY_ID, branchId: BRANCH_POLANCO },
        });

        const res1 = await todayGET(new NextRequest("http://localhost/api/workflows/today"));
        expect(res1.status).toBe(200);
        expect(getTodayMock).toHaveBeenLastCalledWith(COMPANY_ID, BRANCH_POLANCO);

        const res2 = await todayGET(
          new NextRequest(`http://localhost/api/workflows/today?branchId=${BRANCH_CONDESA}`),
        );
        expect(res2.status).toBe(200);
        expect(getTodayMock).toHaveBeenLastCalledWith(COMPANY_ID, BRANCH_POLANCO);
      },
    );

    it.each<Role>(["SUPER_ADMIN", "OWNER", "ADMIN"])(
      "allows %s to query all branches when no ?branchId= is passed",
      async (role) => {
        getSessionMock.mockResolvedValue({
          user: { id: "u-1", role, companyId: COMPANY_ID, branchId: BRANCH_CONDESA },
        });

        const res = await todayGET(new NextRequest("http://localhost/api/workflows/today"));
        expect(res.status).toBe(200);
        expect(getTodayMock).toHaveBeenCalledWith(COMPANY_ID, null);
      },
    );

    it("returns empty fail-closed when GERENTE has no assigned branch", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "u-ger", role: "GERENTE", companyId: COMPANY_ID, branchId: null },
      });

      const res = await todayGET(new NextRequest("http://localhost/api/workflows/today"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.branches).toEqual([]);
      expect(getTodayMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/sales/cuts", () => {
    it.each<Role>(["GERENTE", "SUPERVISOR"])(
      "rejects %s attempting to submit a sales cut for another branch with 403",
      async (role) => {
        requireTenantAuthMock.mockResolvedValue({
          user: { id: "u-1", role, companyId: COMPANY_ID, branchId: BRANCH_CONDESA },
          tenantId: COMPANY_ID,
          branchId: BRANCH_CONDESA,
        });

        const res = await salesCutsPOST(
          new NextRequest("http://localhost/api/sales/cuts", {
            method: "POST",
            body: JSON.stringify({
              branchId: BRANCH_POLANCO,
              businessDate: "2026-11-28",
              shift: "COMPLETO",
              totalSales: 500000,
            }),
          }),
        );
        expect(res.status).toBe(403);
        expect(assertBranchOfCompanyMock).not.toHaveBeenCalled();
      },
    );

    it("rejects GERENTE without assigned branch fail-closed with 403", async () => {
      requireTenantAuthMock.mockResolvedValue({
        user: { id: "u-1", role: "GERENTE", companyId: COMPANY_ID, branchId: null },
        tenantId: COMPANY_ID,
        branchId: null,
      });

      const res = await salesCutsPOST(
        new NextRequest("http://localhost/api/sales/cuts", {
          method: "POST",
          body: JSON.stringify({
            branchId: BRANCH_CONDESA,
            businessDate: "2026-11-28",
            shift: "COMPLETO",
            totalSales: 500000,
          }),
        }),
      );
      expect(res.status).toBe(403);
      expect(assertBranchOfCompanyMock).not.toHaveBeenCalled();
    });
  });
});
