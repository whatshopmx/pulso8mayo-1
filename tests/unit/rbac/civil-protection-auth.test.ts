import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";

const requireTenantAuthMock = vi.fn();
const getCivilProtectionKpisMock = vi.fn();
const listDrillsMock = vi.fn();
const createDrillMock = vi.fn();
const listExtinguishersMock = vi.fn();
const listExpiringExtinguishersMock = vi.fn();
const createExtinguisherMock = vi.fn();
const listExitChecklistMock = vi.fn();
const createExitChecklistItemMock = vi.fn();

vi.mock("@/lib/api/with-auth", () => ({
  requireTenantAuth: (...args: unknown[]) => requireTenantAuthMock(...args),
}));

vi.mock("@/lib/services/civil-protection-service", () => ({
  getCivilProtectionKpis: (...args: unknown[]) => getCivilProtectionKpisMock(...args),
  listDrills: (...args: unknown[]) => listDrillsMock(...args),
  createDrill: (...args: unknown[]) => createDrillMock(...args),
  listExtinguishers: (...args: unknown[]) => listExtinguishersMock(...args),
  listExpiringExtinguishers: (...args: unknown[]) => listExpiringExtinguishersMock(...args),
  createExtinguisher: (...args: unknown[]) => createExtinguisherMock(...args),
  listExitChecklist: (...args: unknown[]) => listExitChecklistMock(...args),
  createExitChecklistItem: (...args: unknown[]) => createExitChecklistItemMock(...args),
}));

import { GET as kpisGET } from "@/app/api/civil-protection/kpis/route";
import { GET as drillsGET, POST as drillsPOST } from "@/app/api/civil-protection/drills/route";
import {
  GET as extinguishersGET,
  POST as extinguishersPOST,
} from "@/app/api/civil-protection/extinguishers/route";
import { GET as exitsGET, POST as exitsPOST } from "@/app/api/civil-protection/exits/route";

const COMPANY_ID = "c1000001-0000-4000-8000-000000000001";
const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
const BRANCH_POLANCO = "b1000001-0000-4000-8000-000000000002";

function mockAuth(role: Role, branchId: string | null = BRANCH_CONDESA) {
  requireTenantAuthMock.mockResolvedValue({
    user: { id: "u-1", role, companyId: COMPANY_ID, branchId },
    tenantId: COMPANY_ID,
    branchId,
  });
}

describe("Task 9a: /api/civil-protection/* role & branch scope guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCivilProtectionKpisMock.mockResolvedValue({ totalDrills: 2 });
    listDrillsMock.mockResolvedValue([]);
    createDrillMock.mockResolvedValue({ id: "d-1" });
    listExtinguishersMock.mockResolvedValue([]);
    listExpiringExtinguishersMock.mockResolvedValue([
      { id: "ext-1", branchId: BRANCH_CONDESA },
      { id: "ext-2", branchId: BRANCH_POLANCO },
    ]);
    createExtinguisherMock.mockResolvedValue({ id: "ext-new" });
    listExitChecklistMock.mockResolvedValue([]);
    createExitChecklistItemMock.mockResolvedValue({ id: "ex-1" });
  });

  it("denies EMPLEADO with 403 across all GET endpoints before calling services", async () => {
    mockAuth("EMPLEADO", BRANCH_CONDESA);
    expect((await kpisGET(new NextRequest("http://localhost/api/civil-protection/kpis"))).status).toBe(403);
    expect((await drillsGET(new NextRequest("http://localhost/api/civil-protection/drills"))).status).toBe(403);
    expect((await extinguishersGET(new NextRequest("http://localhost/api/civil-protection/extinguishers"))).status).toBe(403);
    expect((await exitsGET(new NextRequest("http://localhost/api/civil-protection/exits"))).status).toBe(403);
    expect(getCivilProtectionKpisMock).not.toHaveBeenCalled();
    expect(listDrillsMock).not.toHaveBeenCalled();
    expect(listExtinguishersMock).not.toHaveBeenCalled();
    expect(listExitChecklistMock).not.toHaveBeenCalled();
  });

  it.each<Role>(["EMPLEADO", "READONLY"])(
    "denies %s with 403 on all POST endpoints",
    async (role) => {
      mockAuth(role, BRANCH_CONDESA);
      const r1 = await drillsPOST(
        new NextRequest("http://localhost/api/civil-protection/drills", {
          method: "POST",
          body: JSON.stringify({
            branchId: BRANCH_CONDESA,
            drillType: "SISMO",
            drillDate: "2026-11-28",
          }),
        }),
      );
      const r2 = await extinguishersPOST(
        new NextRequest("http://localhost/api/civil-protection/extinguishers", {
          method: "POST",
          body: JSON.stringify({
            branchId: BRANCH_CONDESA,
            extinguisherId: "EXT-01",
            location: "Cocina",
            inspectionDate: "2026-11-28",
          }),
        }),
      );
      const r3 = await exitsPOST(
        new NextRequest("http://localhost/api/civil-protection/exits", {
          method: "POST",
          body: JSON.stringify({
            branchId: BRANCH_CONDESA,
            exitLocation: "Salida trasera",
            isClear: true,
            signageOk: true,
            emergencyLightOk: true,
            doorOpensOk: true,
          }),
        }),
      );
      expect(r1.status).toBe(403);
      expect(r2.status).toBe(403);
      expect(r3.status).toBe(403);
      expect(createDrillMock).not.toHaveBeenCalled();
      expect(createExtinguisherMock).not.toHaveBeenCalled();
      expect(createExitChecklistItemMock).not.toHaveBeenCalled();
    },
  );

  it("forces GERENTE/SUPERVISOR to own branch on GET (including expiring extinguishers) and blocks cross-branch POST", async () => {
    mockAuth("SUPERVISOR", BRANCH_POLANCO);

    const kpisRes = await kpisGET(
      new NextRequest(`http://localhost/api/civil-protection/kpis?branchId=${BRANCH_CONDESA}`),
    );
    expect(kpisRes.status).toBe(200);
    expect(getCivilProtectionKpisMock).toHaveBeenCalledWith(COMPANY_ID, BRANCH_POLANCO);

    const drillsRes = await drillsGET(
      new NextRequest(`http://localhost/api/civil-protection/drills?branchId=${BRANCH_CONDESA}`),
    );
    expect(drillsRes.status).toBe(200);
    expect(listDrillsMock).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ branchId: BRANCH_POLANCO }),
    );

    const expRes = await extinguishersGET(
      new NextRequest("http://localhost/api/civil-protection/extinguishers?expiring=true"),
    );
    expect(expRes.status).toBe(200);
    const expBody = await expRes.json();
    expect(expBody.data).toEqual([{ id: "ext-2", branchId: BRANCH_POLANCO }]);

    const crossPost = await drillsPOST(
      new NextRequest("http://localhost/api/civil-protection/drills", {
        method: "POST",
        body: JSON.stringify({
          branchId: BRANCH_CONDESA,
          drillType: "SISMO",
          drillDate: "2026-11-28",
        }),
      }),
    );
    expect(crossPost.status).toBe(403);
    expect(createDrillMock).not.toHaveBeenCalled();
  });

  it("allows SUPER_ADMIN to query all branches when no ?branchId= is sent", async () => {
    mockAuth("SUPER_ADMIN", BRANCH_CONDESA);
    const res = await kpisGET(new NextRequest("http://localhost/api/civil-protection/kpis"));
    expect(res.status).toBe(200);
    expect(getCivilProtectionKpisMock).toHaveBeenCalledWith(COMPANY_ID, undefined);
  });
});
