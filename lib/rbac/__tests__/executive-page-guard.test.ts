import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/permissions";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const twinGetLatestMock = vi.fn();
const branchRankingMock = vi.fn();
const briefGetLatestMock = vi.fn();
const decisionListMock = vi.fn();
const dbSelectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSessionMock(...args) } },
}));
vi.mock("@/lib/db", () => ({
  db: { select: (...args: unknown[]) => dbSelectMock(...args) },
}));
vi.mock("@/lib/services/executive-twin-engine", () => ({
  ExecutiveTwinEngine: { getLatest: (...args: unknown[]) => twinGetLatestMock(...args) },
}));
vi.mock("@/lib/services/cross-branch-service", () => ({
  CrossBranchService: { getBranchRanking: (...args: unknown[]) => branchRankingMock(...args) },
}));
vi.mock("@/lib/services/morning-brief-service", () => ({
  MorningBriefService: { getLatest: (...args: unknown[]) => briefGetLatestMock(...args) },
}));
vi.mock("@/lib/services/executive-decision-service", () => ({
  ExecutiveDecisionService: { list: (...args: unknown[]) => decisionListMock(...args) },
}));

import ExecutiveDashboardPage from "@/app/dashboard/executive/page";

describe("ExecutiveDashboardPage — server guard before data fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ name: "Pulso HORECA Demo" }],
        }),
      }),
    });
    twinGetLatestMock.mockResolvedValue(null);
    branchRankingMock.mockResolvedValue({
      branches: [],
      anomalies: [],
      networkAveragePrimeCost: null,
      networkAverageFoodCost: null,
      networkAverageLaborCost: null,
    });
    briefGetLatestMock.mockResolvedValue(null);
    decisionListMock.mockResolvedValue({});
  });

  it.each<[Role, string]>([
    ["GERENTE", "/dashboard"],
    ["SUPERVISOR", "/dashboard"],
    ["EMPLEADO", "/dashboard/workflows"],
    ["READONLY", "/dashboard/analytics"],
  ])("blocks %s and redirects to %s WITHOUT querying executive services", async (role, expectedRedirect) => {
    getSessionMock.mockResolvedValue({
      user: { id: "u-1", role, companyId: "c-1", branchId: "b-1" },
    });

    await expect(ExecutiveDashboardPage({})).rejects.toThrow(`NEXT_REDIRECT:${expectedRedirect}`);

    expect(dbSelectMock).not.toHaveBeenCalled();
    expect(twinGetLatestMock).not.toHaveBeenCalled();
    expect(branchRankingMock).not.toHaveBeenCalled();
    expect(briefGetLatestMock).not.toHaveBeenCalled();
    expect(decisionListMock).not.toHaveBeenCalled();
  });

  it.each<Role>(["SUPER_ADMIN", "OWNER", "ADMIN"])("allows %s and loads executive models", async (role) => {
    getSessionMock.mockResolvedValue({
      user: { id: "u-1", role, companyId: "c-1", branchId: "b-1" },
    });

    const result = await ExecutiveDashboardPage({});
    expect(result).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(twinGetLatestMock).toHaveBeenCalledWith("c-1");
    expect(branchRankingMock).toHaveBeenCalledOnce();
    expect(briefGetLatestMock).toHaveBeenCalledWith("c-1");
    expect(decisionListMock).toHaveBeenCalledWith("c-1");
  });
});
