import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";

const requireTenantAuthMock = vi.fn();
const findManyMock = vi.fn();
const findFirstRequestMock = vi.fn();
const findFirstShiftMock = vi.fn();
const findFirstUserMock = vi.fn();
const dbUpdateMock = vi.fn();

vi.mock("@/lib/api/with-auth", () => ({
  requireTenantAuth: (...args: unknown[]) => requireTenantAuthMock(...args),
}));

vi.mock("@/lib/services/notification-dispatcher", () => ({
  NotificationDispatcher: {
    sendNotification: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      shiftChangeRequests: {
        findMany: (...args: unknown[]) => findManyMock(...args),
        findFirst: (...args: unknown[]) => findFirstRequestMock(...args),
      },
      plannedShifts: {
        findFirst: (...args: unknown[]) => findFirstShiftMock(...args),
      },
      users: {
        findFirst: (...args: unknown[]) => findFirstUserMock(...args),
      },
    },
    update: (...args: unknown[]) => dbUpdateMock(...args),
  },
}));

import { GET, PUT } from "@/app/api/shift-change-requests/route";

const COMPANY_ID = "c1000001-0000-4000-8000-000000000001";
const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
const BRANCH_POLANCO = "b1000001-0000-4000-8000-000000000002";

function mockAuth(role: Role, userId = "u-1", branchId: string | null = BRANCH_CONDESA) {
  requireTenantAuthMock.mockResolvedValue({
    user: { id: userId, role, companyId: COMPANY_ID, branchId },
    tenantId: COMPANY_ID,
    branchId,
  });
}

describe("Shift change requests RBAC & self-service security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([
      {
        id: "req-1",
        companyId: COMPANY_ID,
        branchId: BRANCH_CONDESA,
        requestedBy: "u-pedro",
        counterpartyId: "u-luisa",
        requestedShiftId: "s-1",
        counterpartyShiftId: null,
        status: "PENDING",
      },
    ]);
    findFirstShiftMock.mockResolvedValue({
      id: "s-1",
      userId: "u-pedro",
      user: { id: "u-pedro", name: "Pedro", pinCode: "1234" },
    });
    findFirstUserMock.mockResolvedValue({
      id: "u-pedro",
      name: "Pedro",
      pinCode: "1234",
    });
    findFirstRequestMock.mockResolvedValue({
      id: "req-1",
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: "u-pedro",
      counterpartyId: "u-luisa",
      requestedShiftId: "s-1",
      counterpartyShiftId: null,
      status: "PENDING",
    });
    dbUpdateMock.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: async () => [{ id: "req-1", status: "APPROVED" }],
        }),
      }),
    });
  });

  it("strips pinCode from enriched users in GET /api/shift-change-requests", async () => {
    mockAuth("EMPLEADO", "u-pedro", BRANCH_CONDESA);
    const res = await GET(new NextRequest("http://localhost/api/shift-change-requests"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].requestedByUser.pinCode).toBeUndefined();
    expect(body.data[0].counterparty.pinCode).toBeUndefined();
    expect(body.data[0].requestedShift.user.pinCode).toBeUndefined();
  });

  it.each<Role>(["EMPLEADO", "READONLY"])(
    "denies %s from executing manager_decision with 403",
    async (role) => {
      mockAuth(role, "u-pedro", BRANCH_CONDESA);
      const res = await PUT(
        new NextRequest("http://localhost/api/shift-change-requests", {
          method: "PUT",
          body: JSON.stringify({ id: "req-1", action: "manager_decision", approved: true }),
        }),
      );
      expect(res.status).toBe(403);
      expect(dbUpdateMock).not.toHaveBeenCalled();
    },
  );

  it("denies SUPERVISOR from approving a shift-change request from another branch", async () => {
    mockAuth("SUPERVISOR", "u-ana", BRANCH_POLANCO);
    const res = await PUT(
      new NextRequest("http://localhost/api/shift-change-requests", {
        method: "PUT",
        body: JSON.stringify({ id: "req-1", action: "manager_decision", approved: true }),
      }),
    );
    expect(res.status).toBe(403);
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("allows SUPERVISOR to approve a shift-change request within their own branch", async () => {
    mockAuth("SUPERVISOR", "u-sup", BRANCH_CONDESA);
    const res = await PUT(
      new NextRequest("http://localhost/api/shift-change-requests", {
        method: "PUT",
        body: JSON.stringify({ id: "req-1", action: "manager_decision", approved: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(dbUpdateMock).toHaveBeenCalledTimes(1);
  });
});
