import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetCommissionsByBranch,
  mockGetPlatformCrossReport,
  mockGetPnLByBranch,
  mockRequirePermissionApi,
  mockBranchesSelect,
} = vi.hoisted(() => ({
  mockGetCommissionsByBranch: vi.fn(),
  mockGetPlatformCrossReport: vi.fn(),
  mockGetPnLByBranch: vi.fn(),
  mockRequirePermissionApi: vi.fn(),
  mockBranchesSelect: vi.fn(),
}));

const authState = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  user: {
    id: "user-admin",
    role: "ADMIN",
    branchId: null as string | null,
  },
};

vi.mock("@/lib/api/with-auth", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withTenantAuth: (handler: any) => async (req: NextRequest) => {
    try {
      return await handler(req, { auth: authState });
    } catch (error) {
      const { ApiHandler } = await import("@/lib/api/response");
      return ApiHandler.error(error);
    }
  },
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/rbac/masking", () => ({
  maskSensitive: <T,>(payload: T) => payload,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockBranchesSelect,
  },
}));

vi.mock("@/lib/services/commission-service", () => ({
  getCommissionsByBranch: mockGetCommissionsByBranch,
}));

vi.mock("@/lib/services/gateway-report-service", () => ({
  GatewayReportService: {
    getPlatformCrossReport: mockGetPlatformCrossReport,
  },
}));

vi.mock("@/lib/services/pnl-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/pnl-service")>();
  return {
    ...actual,
    getPnLByBranch: mockGetPnLByBranch,
  };
});

import { GET as getCommissionsRoute } from "@/app/api/finance/commissions/route";
import { GET as getPlatformReportRoute } from "@/app/api/finance/reconciliation/platform-report/route";
import { GET as getPnlRoute } from "@/app/api/finance/pnl/route";
import { buildPnlCommissionPresentation } from "@/lib/services/pnl-service";
import { line } from "@/lib/services/pnl-types";

describe("FIN-06.b — Aceptación HTTP V3 de comisiones e ingresos por canal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user.role = "ADMIN";
    authState.user.branchId = null;

    mockRequirePermissionApi.mockResolvedValue({
      ctx: {
        userCompanyId: authState.tenantId,
        userRole: "ADMIN",
        userBranchId: null,
      },
      decision: { allow: true },
    });
  });

  it("GET /api/finance/commissions expone tarifa estimada, reportada, conciliada, cuadre neto/bruto/IVA y bloquea alcance NONE (403)", async () => {
    mockBranchesSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "br-est", name: "Suc Estimada" },
          { id: "br-rec", name: "Suc Conciliada" },
          { id: "br-miss", name: "Suc Sin Cortes" },
        ]),
      }),
    });

    mockGetCommissionsByBranch.mockResolvedValue([
      {
        branchId: "br-est",
        channels: [
          {
            channel: "rappi",
            baseSalesCents: 100_000,
            commissionCents: 31_900,
            feeBaseCents: 27_500,
            feeVatCents: 4_400,
            expectedNetCents: 68_100,
            bankMatchedCents: 0,
            measuredCents: 0,
            reportedCents: 0,
            reconciledCents: 0,
            estimatedCents: 31_900,
            discrepancyCents: 0,
            rateBps: 2750,
            vatBps: 1600,
            source: "ESTIMATED",
            amountSource: "RATE_ESTIMATE",
            reconciliationStatus: "PENDING",
            amountSourceLabel: "Tarifa estimada",
            reconciliationStatusLabel: "Pendiente de conciliar",
            documentedZero: false,
            cutsCount: 1,
          },
        ],
        totalCommissionCents: 31_900,
        totalFeeBaseCents: 27_500,
        totalFeeVatCents: 4_400,
        totalExpectedNetCents: 68_100,
        totalBankMatchedCents: 0,
        reportedCommissionCents: 0,
        reconciledCommissionCents: 0,
        estimatedCommissionCents: 31_900,
        discrepancyCents: 0,
        coveredSalesCents: 100_000,
        uncoveredSalesCents: 0,
        source: "ESTIMATED",
        amountSource: "RATE_ESTIMATE",
        reconciliationStatus: "PENDING",
        amountSourceLabel: "Tarifa estimada",
        reconciliationStatusLabel: "Pendiente de conciliar",
        documentedZero: false,
        coveragePercent: 100,
        note: "Tarifa estimada · Pendiente de conciliar (Rappi 27.50%).",
      },
      {
        branchId: "br-rec",
        channels: [
          {
            channel: "tpv",
            baseSalesCents: 100_000,
            commissionCents: 2_900,
            feeBaseCents: 2_500,
            feeVatCents: 400,
            expectedNetCents: 97_100,
            bankMatchedCents: 97_100,
            measuredCents: 2_900,
            reportedCents: 0,
            reconciledCents: 2_900,
            estimatedCents: 0,
            discrepancyCents: 0,
            rateBps: null,
            vatBps: null,
            source: "MEASURED",
            amountSource: "BANK_RECONCILED",
            reconciliationStatus: "CONFIRMED",
            amountSourceLabel: "Conciliada en banco",
            reconciliationStatusLabel: "Confirmada",
            documentedZero: false,
            cutsCount: 1,
          },
        ],
        totalCommissionCents: 2_900,
        totalFeeBaseCents: 2_500,
        totalFeeVatCents: 400,
        totalExpectedNetCents: 97_100,
        totalBankMatchedCents: 97_100,
        reportedCommissionCents: 0,
        reconciledCommissionCents: 2_900,
        estimatedCommissionCents: 0,
        discrepancyCents: 0,
        coveredSalesCents: 100_000,
        uncoveredSalesCents: 0,
        source: "MEASURED",
        amountSource: "BANK_RECONCILED",
        reconciliationStatus: "CONFIRMED",
        amountSourceLabel: "Conciliada en banco",
        reconciliationStatusLabel: "Confirmada",
        documentedZero: false,
        coveragePercent: 100,
        note: "Conciliada en banco · Confirmada (TPV (tarjeta)).",
      },
    ]);

    const req = new NextRequest(
      "http://localhost:3000/api/finance/commissions?from=2026-11-01&to=2026-11-30",
    );
    const res = await getCommissionsRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.branches).toHaveLength(3);

    const [est, rec, miss] = body.data.branches;
    expect(est).toMatchObject({
      amountSource: "RATE_ESTIMATE",
      reconciliationStatus: "PENDING",
      totalFeeBaseCents: 27_500,
      totalFeeVatCents: 4_400,
      totalExpectedNetCents: 68_100,
      totalBankMatchedCents: 0,
    });
    expect(rec).toMatchObject({
      amountSource: "BANK_RECONCILED",
      reconciliationStatus: "CONFIRMED",
      totalFeeBaseCents: 2_500,
      totalFeeVatCents: 400,
      totalExpectedNetCents: 97_100,
      totalBankMatchedCents: 97_100,
    });
    expect(miss).toMatchObject({
      source: "NO_DATA",
      amountSource: "NO_DATA",
      reconciliationStatus: "PENDING",
      documentedZero: false,
    });

    // Gerente sin sucursal asignada -> 403 Forbidden
    authState.user.role = "MANAGER";
    authState.user.branchId = null;
    const forbiddenRes = await getCommissionsRoute(req);
    expect(forbiddenRes.status).toBe(403);
  });

  it("GET /api/finance/reconciliation/platform-report y GET /api/finance/pnl exponen diferencias y no presentan faltantes como costo firme", async () => {
    mockGetPlatformCrossReport.mockResolvedValue([
      {
        acquirer: "CLIP",
        transactionCount: 2,
        matchedCount: 1,
        unmatchedCount: 1,
        grossCents: 200_000,
        feeCents: 5_000,
        feeVatCents: 800,
        totalCommissionCents: 5_800,
        netCents: 194_200,
        bankMatchedCents: 97_100,
        bankDifferenceCents: -97_100,
        arithmeticDifferenceCents: 0,
        documentedZero: false,
        amountSource: "GATEWAY_REPORTED",
        reconciliationStatus: "PENDING",
        amountSourceLabel: "Reportada por pasarela",
        reconciliationStatusLabel: "Pendiente de conciliar",
        effectiveRateBps: 250,
      },
    ]);

    const crossReq = new NextRequest(
      "http://localhost:3000/api/finance/reconciliation/platform-report?startDate=2026-11-01&endDate=2026-11-30",
    );
    const crossRes = await getPlatformReportRoute(crossReq);
    expect(crossRes.status).toBe(200);
    const crossJson = await crossRes.json();
    expect(crossJson.data[0]).toMatchObject({
      acquirer: "CLIP",
      matchedCount: 1,
      unmatchedCount: 1,
      bankDifferenceCents: -97_100,
      reconciliationStatus: "PENDING",
    });

    const missingPresentation = buildPnlCommissionPresentation(undefined, 100_000);
    mockGetPnLByBranch.mockResolvedValue([
      {
        branchId: "br-miss",
        branchName: "Suc Faltante",
        sales: line(100_000, 100_000, "MEASURED", 100, "ok"),
        foodCost: line(30_000, 100_000, "MEASURED", 100, "ok"),
        waste: line(0, 100_000, "MEASURED", 100, "ok"),
        labor: line(20_000, 100_000, "MEASURED", 100, "ok"),
        operatingExpenses: line(10_000, 100_000, "MEASURED", 100, "ok"),
        commissions: missingPresentation.commissionsLine,
        commissionsByChannel: missingPresentation.commissionsByChannel,
        operatingProfit: line(40_000, 100_000, "DERIVED", 100, "Aproximado"),
        weakestLine: "NO_DATA",
      },
    ]);

    const pnlReq = new NextRequest(
      "http://localhost:3000/api/finance/pnl?startDate=2026-11-01&endDate=2026-11-30",
    );
    const pnlRes = await getPnlRoute(pnlReq);
    expect(pnlRes.status).toBe(200);
    const pnlJson = await pnlRes.json();
    expect(pnlJson.data.branches[0].commissions.source).toBe("NO_DATA");
    expect(pnlJson.data.branches[0].commissions.documentedZero).toBe(false);
    expect(pnlJson.data.meta.containsEstimates).toBe(true);
    expect(pnlJson.data.meta.warning).toContain("NO_DATA");
  });
});
