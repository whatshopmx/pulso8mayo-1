import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";
import { ApiError } from "@/lib/api/error";

const requireRoleApiMock = vi.fn();
const twinGetLatestMock = vi.fn();
const twinRecalculateMock = vi.fn();
const briefGetLatestMock = vi.fn();
const briefGetByDateMock = vi.fn();
const briefGetHistoryMock = vi.fn();
const feedMock = vi.fn();
const decisionListMock = vi.fn();
const decisionResolveMock = vi.fn();
const reasonAboutMock = vi.fn();
const featureGateMock = vi.fn();

vi.mock("@/lib/rbac/require-role", () => ({
  requireRoleApi: (...args: unknown[]) => requireRoleApiMock(...args),
}));
vi.mock("@/lib/services/executive-twin-engine", () => ({
  ExecutiveTwinEngine: {
    getLatest: (...args: unknown[]) => twinGetLatestMock(...args),
    recalculate: (...args: unknown[]) => twinRecalculateMock(...args),
  },
}));
vi.mock("@/lib/services/morning-brief-service", () => ({
  MorningBriefService: {
    getLatest: (...args: unknown[]) => briefGetLatestMock(...args),
    getByDate: (...args: unknown[]) => briefGetByDateMock(...args),
    getHistory: (...args: unknown[]) => briefGetHistoryMock(...args),
    getDecisionFeed: (...args: unknown[]) => feedMock(...args),
  },
}));
vi.mock("@/lib/services/executive-decision-service", () => ({
  ExecutiveDecisionService: {
    list: (...args: unknown[]) => decisionListMock(...args),
    resolve: (...args: unknown[]) => decisionResolveMock(...args),
    revoke: vi.fn(),
  },
}));
vi.mock("@/lib/services/intelligence-service", () => ({
  IntelligenceService: {
    reasonAbout: (...args: unknown[]) => reasonAboutMock(...args),
  },
}));
vi.mock("@/lib/services/tier-service", () => ({
  TierService: {
    getFeatureGate: (...args: unknown[]) => featureGateMock(...args),
  },
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

import { GET as getTwin } from "@/app/api/executive/twin/route";
import { GET as getFeed } from "@/app/api/executive/feed/route";
import { GET as getReason, POST as postReason } from "@/app/api/executive/reason/route";
import { GET as getDecisions, POST as postDecisions } from "@/app/api/executive/decisions/route";

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

describe("Executive APIs — Task 3 (twin, feed, reason, decisions)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    twinGetLatestMock.mockResolvedValue({ id: "t-1", healthScore: 84 });
    feedMock.mockResolvedValue([]);
    decisionListMock.mockResolvedValue({});
    decisionResolveMock.mockResolvedValue(undefined);
    featureGateMock.mockResolvedValue({ allowed: true });
    reasonAboutMock.mockResolvedValue({ answer: "ok", sources: [] });
  });

  it.each(DENIED_ROLES)("returns 403 for %s across twin, feed, reason, decisions without invoking services", async (role) => {
    mockActor(role);

    const resTwin = await getTwin();
    expect(resTwin.status).toBe(403);

    const resFeed = await getFeed(new NextRequest("http://localhost/api/executive/feed"));
    expect(resFeed.status).toBe(403);

    const resReasonGet = await getReason();
    expect(resReasonGet.status).toBe(403);

    const resReasonPost = await postReason(
      new NextRequest("http://localhost/api/executive/reason", {
        method: "POST",
        body: JSON.stringify({ question: "¿Cómo va el prime cost?" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resReasonPost.status).toBe(403);

    const resDecisionsGet = await getDecisions();
    expect(resDecisionsGet.status).toBe(403);

    const resDecisionsPost = await postDecisions(
      new Request("http://localhost/api/executive/decisions", {
        method: "POST",
        body: JSON.stringify({ decisionKey: "k-1", resolution: "authorized" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resDecisionsPost.status).toBe(403);

    expect(twinGetLatestMock).not.toHaveBeenCalled();
    expect(feedMock).not.toHaveBeenCalled();
    expect(reasonAboutMock).not.toHaveBeenCalled();
    expect(decisionListMock).not.toHaveBeenCalled();
    expect(decisionResolveMock).not.toHaveBeenCalled();
  });

  it.each(ALLOWED_ROLES)("returns 200 for %s across twin, feed, reason, decisions", async (role) => {
    mockActor(role);

    expect((await getTwin()).status).toBe(200);
    expect((await getFeed(new NextRequest("http://localhost/api/executive/feed"))).status).toBe(200);
    expect((await getReason()).status).toBe(200);
    expect(
      (
        await postReason(
          new NextRequest("http://localhost/api/executive/reason", {
            method: "POST",
            body: JSON.stringify({ question: "¿Cómo va el prime cost?" }),
            headers: { "Content-Type": "application/json" },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await getDecisions()).status).toBe(200);
    expect(
      (
        await postDecisions(
          new Request("http://localhost/api/executive/decisions", {
            method: "POST",
            body: JSON.stringify({ decisionKey: "k-1", resolution: "authorized" }),
            headers: { "Content-Type": "application/json" },
          }),
        )
      ).status,
    ).toBe(200);
  });

  it("returns 401 when unauthenticated", async () => {
    requireRoleApiMock.mockRejectedValue(ApiError.unauthorized());
    expect((await getTwin()).status).toBe(401);
  });
});
