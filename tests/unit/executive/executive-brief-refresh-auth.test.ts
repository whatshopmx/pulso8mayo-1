import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";

const requireRoleApiMock = vi.fn();
const twinRecalculateMock = vi.fn();
const briefGetLatestMock = vi.fn();
const briefGetByDateMock = vi.fn();
const briefGetHistoryMock = vi.fn();
const featureGateMock = vi.fn();
const inngestSendMock = vi.fn();

vi.mock("@/lib/rbac/require-role", () => ({
  requireRoleApi: (...args: unknown[]) => requireRoleApiMock(...args),
}));
vi.mock("@/lib/services/executive-twin-engine", () => ({
  ExecutiveTwinEngine: {
    recalculate: (...args: unknown[]) => twinRecalculateMock(...args),
  },
}));
vi.mock("@/lib/services/morning-brief-service", () => ({
  MorningBriefService: {
    getLatest: (...args: unknown[]) => briefGetLatestMock(...args),
    getByDate: (...args: unknown[]) => briefGetByDateMock(...args),
    getHistory: (...args: unknown[]) => briefGetHistoryMock(...args),
  },
}));
vi.mock("@/lib/services/tier-service", () => ({
  TierService: {
    getFeatureGate: (...args: unknown[]) => featureGateMock(...args),
  },
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => inngestSendMock(...args) },
}));

import { GET as getBriefLatest } from "@/app/api/executive/brief/latest/route";
import { GET as getBriefHistory } from "@/app/api/executive/brief/history/route";
import { POST as postTwinRefresh } from "@/app/api/executive/twin/refresh/route";

const DENIED_ROLES: Role[] = ["GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"];
const ALLOWED_ROLES: Role[] = ["SUPER_ADMIN", "OWNER", "ADMIN"];

function mockActor(role: Role) {
  const user = { id: "u-1", role, companyId: "c-1", branchId: "b-1", email: "test@pulso.mx", name: "Test" };
  requireRoleApiMock.mockResolvedValue({
    session: { user },
    userRole: role,
    user,
  });
}

describe("Executive APIs — Task 4 (brief/latest, brief/history, twin/refresh)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureGateMock.mockResolvedValue({ allowed: true });
    briefGetLatestMock.mockResolvedValue({ briefDate: "2026-11-27", brief: {} });
    briefGetByDateMock.mockResolvedValue(null);
    briefGetHistoryMock.mockResolvedValue([]);
    twinRecalculateMock.mockResolvedValue({ id: "t-1", healthScore: 85 });
  });

  it.each(DENIED_ROLES)("returns 403 for %s without querying brief or recalculating twin", async (role) => {
    mockActor(role);

    expect((await getBriefLatest()).status).toBe(403);
    expect((await getBriefHistory(new NextRequest("http://localhost/api/executive/brief/history"))).status).toBe(403);
    expect((await postTwinRefresh()).status).toBe(403);

    expect(briefGetLatestMock).not.toHaveBeenCalled();
    expect(briefGetHistoryMock).not.toHaveBeenCalled();
    expect(twinRecalculateMock).not.toHaveBeenCalled();
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it.each(ALLOWED_ROLES)("returns 200 for %s across brief/latest, brief/history and twin/refresh", async (role) => {
    mockActor(role);

    expect((await getBriefLatest()).status).toBe(200);
    expect((await getBriefHistory(new NextRequest("http://localhost/api/executive/brief/history"))).status).toBe(200);
    expect((await postTwinRefresh()).status).toBe(200);
  });
});
