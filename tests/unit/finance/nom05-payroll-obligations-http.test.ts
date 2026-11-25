import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const {
  mockRequirePermissionApi,
  mockListPayrollObligations,
  mockSyncPayrollObligations,
  mockRecordPayrollPayment,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockListPayrollObligations: vi.fn(),
  mockSyncPayrollObligations: vi.fn(),
  mockRecordPayrollPayment: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/payroll-treasury-service", () => ({
  listPayrollObligations: mockListPayrollObligations,
  syncPayrollObligationsFromApprovedSnapshot: mockSyncPayrollObligations,
  recordPayrollObligationPayment: mockRecordPayrollPayment,
}));

import {
  GET as getObligations,
  POST as postObligations,
} from "@/app/api/finance/treasury/payroll/obligations/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const OBL_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";

describe("NOM-05 V3 — HTTP obligaciones netas de nómina y tesorería", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deniega con 403 si faltan permisos FINANCIAL en GET/POST", async () => {
    mockRequirePermissionApi.mockRejectedValue(ApiError.forbidden("Sin permiso"));

    const r1 = await getObligations(
      new NextRequest(`http://localhost:3000/api/finance/treasury/payroll/obligations?runId=${RUN_ID}`)
    );
    const r2 = await postObligations(
      new NextRequest("http://localhost:3000/api/finance/treasury/payroll/obligations", {
        method: "POST",
        body: JSON.stringify({ action: "SYNC_FROM_SNAPSHOT", runId: RUN_ID }),
      })
    );

    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
  });

  it("sincroniza obligaciones desde snapshot aprobado, registra pago parcial e informa estados independientes", async () => {
    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1" },
    });

    mockSyncPayrollObligations.mockResolvedValueOnce({
      runId: RUN_ID,
      snapshotVersion: 2,
      createdCount: 1,
      existingCount: 0,
      obligations: [
        {
          id: OBL_ID,
          companyId: COMPANY_ID,
          payrollRunId: RUN_ID,
          payslipId: "ps-1",
          userId: "usr-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-15",
          snapshotVersion: 2,
          netAmountCents: 658_500,
          paidAmountCents: 0,
          remainingAmountCents: 658_500,
          paymentStatus: "OPEN",
          cfdiStatus: null,
          cfdiUuid: null,
          bankReconciledCents: 0,
          bankReconciliationStatus: "UNMATCHED",
        },
      ],
    });

    const syncRes = await postObligations(
      new NextRequest("http://localhost:3000/api/finance/treasury/payroll/obligations", {
        method: "POST",
        body: JSON.stringify({ action: "SYNC_FROM_SNAPSHOT", runId: RUN_ID }),
      })
    );
    expect(syncRes.status).toBe(200);
    const syncJson = await syncRes.json();
    expect(syncJson.data.obligations[0]).toMatchObject({
      paymentStatus: "OPEN",
      cfdiStatus: null,
      remainingAmountCents: 658_500,
    });

    mockRecordPayrollPayment.mockResolvedValueOnce({
      idempotent: false,
      allocationId: "alloc-1",
      obligation: {
        id: OBL_ID,
        companyId: COMPANY_ID,
        payrollRunId: RUN_ID,
        payslipId: "ps-1",
        userId: "usr-1",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-15",
        snapshotVersion: 2,
        netAmountCents: 658_500,
        paidAmountCents: 300_000,
        remainingAmountCents: 358_500,
        paymentStatus: "PARTIALLY_PAID",
        cfdiStatus: null,
        cfdiUuid: null,
        bankReconciledCents: 0,
        bankReconciliationStatus: "UNMATCHED",
      },
    });

    const payRes = await postObligations(
      new NextRequest("http://localhost:3000/api/finance/treasury/payroll/obligations", {
        method: "POST",
        body: JSON.stringify({
          action: "RECORD_PAYMENT",
          obligationId: OBL_ID,
          paymentRunItemId: ITEM_ID,
          amountCents: 300_000,
          idempotencyKey: "pay-1",
        }),
      })
    );
    expect(payRes.status).toBe(200);
    const payJson = await payRes.json();
    expect(payJson.data.obligation).toMatchObject({
      paymentStatus: "PARTIALLY_PAID",
      paidAmountCents: 300_000,
      remainingAmountCents: 358_500,
      cfdiStatus: null,
    });

    // Sobrepago devuelve 409 Conflict
    mockRecordPayrollPayment.mockRejectedValueOnce(ApiError.conflict("Sobrepago rechazado"));
    const overRes = await postObligations(
      new NextRequest("http://localhost:3000/api/finance/treasury/payroll/obligations", {
        method: "POST",
        body: JSON.stringify({
          action: "RECORD_PAYMENT",
          obligationId: OBL_ID,
          paymentRunItemId: ITEM_ID,
          amountCents: 500_000,
          idempotencyKey: "pay-2",
        }),
      })
    );
    expect(overRes.status).toBe(409);

    // GET acotado por ctx.userCompanyId
    mockListPayrollObligations.mockResolvedValueOnce([]);
    const listRes = await getObligations(
      new NextRequest(`http://localhost:3000/api/finance/treasury/payroll/obligations?runId=${RUN_ID}&paymentStatus=PARTIALLY_PAID`)
    );
    expect(listRes.status).toBe(200);
    expect(mockListPayrollObligations).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      runId: RUN_ID,
      paymentStatus: "PARTIALLY_PAID",
    });
  });
});
