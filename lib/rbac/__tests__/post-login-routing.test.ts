import { beforeEach, describe, expect, it, vi } from "vitest";
import { postLoginPath } from "@/lib/ui/auth-feedback";
import type { UserRole } from "@/lib/rbac/permissions";

const getSessionMock = vi.fn();
const resolveRequestBranchScopeMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

vi.mock("@/lib/server/effective-branch", () => ({
  resolveRequestBranchScope: (...args: unknown[]) => resolveRequestBranchScopeMock(...args),
  scopeBranchId: () => null,
}));

vi.mock("@/components/dashboard/recent-activity", () => ({ RecentActivity: () => null }));
vi.mock("@/components/dashboard/pinned-announcements", () => ({ PinnedAnnouncements: () => null }));
vi.mock("@/components/compliance/report-generator", () => ({ ComplianceReportGenerator: () => null }));
vi.mock("@/components/dashboard/group-area-overview", () => ({ GroupAreaOverview: () => null }));
vi.mock("@/components/dashboard/live/live-command-section", () => ({
  LiveCommandSection: () => null,
  LiveCommandSkeleton: () => null,
}));

import DashboardHomePage from "@/app/dashboard/page";

describe("Task 10: post-login routing & safe /dashboard guard for EMPLEADO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("postLoginPath", () => {
    it("routes EMPLEADO to /dashboard/workflows by default and when callbackUrl is /dashboard", () => {
      expect(postLoginPath(null, "EMPLEADO")).toBe("/dashboard/workflows");
      expect(postLoginPath("/dashboard", "EMPLEADO")).toBe("/dashboard/workflows");
    });

    it("routes READONLY to /dashboard/analytics by default", () => {
      expect(postLoginPath(null, "READONLY")).toBe("/dashboard/analytics");
    });

    it.each<UserRole>(["SUPER_ADMIN", "OWNER", "ADMIN", "GERENTE", "SUPERVISOR"])(
      "routes %s to /dashboard by default",
      (role) => {
        expect(postLoginPath(null, role)).toBe("/dashboard");
      },
    );

    it("honors authorized callbackUrl and rejects unauthorized or external callbackUrl", () => {
      expect(postLoginPath("/dashboard/labor/vacations", "EMPLEADO")).toBe(
        "/dashboard/labor/vacations",
      );
      expect(postLoginPath("/dashboard/executive", "EMPLEADO")).toBe("/dashboard/workflows");
      expect(postLoginPath("/dashboard/executive", "GERENTE")).toBe("/dashboard");
      expect(postLoginPath("/dashboard/executive", "SUPER_ADMIN")).toBe("/dashboard/executive");
      expect(postLoginPath("https://evil.example/phish", "ADMIN")).toBe("/dashboard");
      expect(postLoginPath("//evil.example/phish", "ADMIN")).toBe("/dashboard");
    });
  });

  describe("app/dashboard/page.tsx", () => {
    it("redirects EMPLEADO to /dashboard/workflows before querying network scope or widgets", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "u-pedro", role: "EMPLEADO", companyId: "c-1", branchId: "b-1" },
      });

      await expect(
        DashboardHomePage({ searchParams: Promise.resolve({}) }),
      ).rejects.toThrow("NEXT_REDIRECT:/dashboard/workflows");

      expect(redirectMock).toHaveBeenCalledWith("/dashboard/workflows");
      expect(resolveRequestBranchScopeMock).not.toHaveBeenCalled();
    });

    it("renders /dashboard normally for GERENTE without redirecting", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "u-juan", role: "GERENTE", companyId: "c-1", branchId: "b-1" },
      });
      resolveRequestBranchScopeMock.mockResolvedValue({ kind: "BRANCH", branchId: "b-1" });

      const element = await DashboardHomePage({ searchParams: Promise.resolve({}) });
      expect(element).toBeTruthy();
      expect(redirectMock).not.toHaveBeenCalled();
      expect(resolveRequestBranchScopeMock).toHaveBeenCalledTimes(1);
    });
  });
});
