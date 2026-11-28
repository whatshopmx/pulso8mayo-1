import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";

const requireTenantAuthMock = vi.fn();
const requireTenantMock = vi.fn();
const requireAuthMock = vi.fn();
const getBranchQSRRankingMock = vi.fn();
const listOpenExceptionsMock = vi.fn();
const getTenantOperatingConfigMock = vi.fn();
const dbSelectMock = vi.fn();

vi.mock("@/lib/api/with-auth", () => ({
  requireTenantAuth: (...args: unknown[]) => requireTenantAuthMock(...args),
  withTenantAuth:
    (handler: (req: NextRequest, ctx: { auth: unknown }) => unknown) =>
    async (req: NextRequest) => {
    const auth = await requireTenantAuthMock();
    return handler(req, { auth });
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  requireTenant: (...args: unknown[]) => requireTenantMock(...args),
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}));

vi.mock("@/lib/services/cross-branch-service", () => ({
  CrossBranchService: {
    getBranchQSRRanking: (...args: unknown[]) => getBranchQSRRankingMock(...args),
  },
}));

vi.mock("@/lib/services/group-exceptions-service", () => ({
  GroupExceptionsService: {
    listOpen: (...args: unknown[]) => listOpenExceptionsMock(...args),
  },
}));

vi.mock("@/lib/services/tenant-config-service", () => ({
  getTenantOperatingConfig: (...args: unknown[]) => getTenantOperatingConfigMock(...args),
  upsertTenantOperatingConfig: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => dbSelectMock(...args),
  },
}));

import { GET as branchesQsrGET } from "@/app/api/group/branches-qsr/route";
import { GET as exceptionsGET } from "@/app/api/group/exceptions/route";
import { GET as operatingConfigGET } from "@/app/api/company/operating-config/route";

const COMPANY_ID = "c1000001-0000-4000-8000-000000000001";
const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";

function mockRole(role: Role) {
  requireTenantAuthMock.mockResolvedValue({
    user: { id: "u-1", role, companyId: COMPANY_ID, branchId: BRANCH_CONDESA },
    tenantId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
  });
  requireTenantMock.mockResolvedValue({ id: COMPANY_ID, name: "Pulso" });
  requireAuthMock.mockResolvedValue({
    user: { id: "u-1", role, companyId: COMPANY_ID, branchId: BRANCH_CONDESA },
  });
}

describe("Task 9b: /api/group/branches-qsr, /api/group/exceptions, /api/company/operating-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBranchQSRRankingMock.mockResolvedValue({ branches: [], alcance: "BRANCH" });
    listOpenExceptionsMock.mockResolvedValue([]);
    getTenantOperatingConfigMock.mockResolvedValue({ tenantType: "GRUPO_PROPIO" });
    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ courtesyWasteMonthlyCapCents: 10000 }],
        }),
      }),
    });
  });

  it("denies EMPLEADO with 403 on /api/group/branches-qsr and /api/group/exceptions", async () => {
    mockRole("EMPLEADO");
    const r1 = await branchesQsrGET(new NextRequest("http://localhost/api/group/branches-qsr"));
    const r2 = await exceptionsGET(new NextRequest("http://localhost/api/group/exceptions"));
    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
    expect(getBranchQSRRankingMock).not.toHaveBeenCalled();
    expect(listOpenExceptionsMock).not.toHaveBeenCalled();
  });

  it.each<Role>(["SUPER_ADMIN", "OWNER", "ADMIN", "GERENTE", "SUPERVISOR", "READONLY"])(
    "allows %s on /api/group/branches-qsr and /api/group/exceptions",
    async (role) => {
      mockRole(role);
      const r1 = await branchesQsrGET(new NextRequest("http://localhost/api/group/branches-qsr"));
      const r2 = await exceptionsGET(new NextRequest("http://localhost/api/group/exceptions"));
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    },
  );

  it.each<Role>(["EMPLEADO", "SUPERVISOR"])(
    "denies %s with 403 on GET /api/company/operating-config",
    async (role) => {
      mockRole(role);
      const res = await operatingConfigGET();
      expect(res.status).toBe(403);
      expect(getTenantOperatingConfigMock).not.toHaveBeenCalled();
    },
  );

  it.each<Role>(["SUPER_ADMIN", "OWNER", "ADMIN", "GERENTE", "READONLY"])(
    "allows %s on GET /api/company/operating-config",
    async (role) => {
      mockRole(role);
      const res = await operatingConfigGET();
      expect(res.status).toBe(200);
      expect(getTenantOperatingConfigMock).toHaveBeenCalledWith(COMPANY_ID);
    },
  );
});
