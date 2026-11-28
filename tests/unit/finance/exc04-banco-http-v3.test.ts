import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";
import {
  BANK_EXCEPTION_SUBJECT_TYPE,
  buildBankExceptionInput,
  computeBankAgingDays,
  evaluateReconciliationDifferencePolicy,
} from "@/lib/services/bank-exception-rules";

const {
  mockRequirePermissionApi,
  mockListBankExceptions,
  mockSyncCompanyBankExceptions,
  mockRecordBankDiscrepancyException,
  mockResolveBankExceptionOnReconciliation,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockListBankExceptions: vi.fn(),
  mockSyncCompanyBankExceptions: vi.fn(),
  mockRecordBankDiscrepancyException: vi.fn(),
  mockResolveBankExceptionOnReconciliation: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/bank-exception-service", () => ({
  listBankExceptions: mockListBankExceptions,
  syncCompanyBankExceptions: mockSyncCompanyBankExceptions,
  recordBankDiscrepancyException: mockRecordBankDiscrepancyException,
  resolveBankExceptionOnReconciliation: mockResolveBankExceptionOnReconciliation,
}));

import {
  GET as getBankExceptions,
  POST as postBankExceptions,
} from "@/app/api/finance/bank-transactions/exceptions/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const BANK_TX_ID = "22222222-2222-4222-8222-222222222222";
const GW_ID = "33333333-3333-4333-8333-333333333333";
const ACCT_ID = "44444444-4444-4444-8444-444444444444";

describe("EXC-04.banco V3 — Reglas de fuente/antigüedad/diferencias y contrato HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conserva fuente, antigüedad y diferencia; nunca permite ocultar diferencia sin disposición auditada", () => {
    const now1 = new Date("2026-11-20T12:00:00Z");
    const now2 = new Date("2026-11-27T12:00:00Z");

    expect(computeBankAgingDays("2026-11-12", now1)).toBe(8);
    expect(computeBankAgingDays("2026-11-12", now2)).toBe(15);

    const first = buildBankExceptionInput({
      companyId: COMPANY_ID,
      source: {
        sourceKind: "BANK_DEPOSIT",
        sourceTable: "bank_transactions",
        sourceId: BANK_TX_ID,
        sourceBankAccountId: ACCT_ID,
        direction: "INFLOW",
        valueDate: "2026-11-12",
        amountCents: 98_500,
        expectedAmountCents: 100_000,
        differenceCents: -1_500,
        discrepancyCode: "AMOUNT_DIFFERENCE",
        reference: "DEP-881",
        description: "Abono terminal Clip",
      },
      now: now1,
      ownerId: "admin-1",
    });

    expect(first.subjectType).toBe(BANK_EXCEPTION_SUBJECT_TYPE);
    expect(first.subjectId).toBe(`bank_tx:${BANK_TX_ID}`);
    const meta1 = first.metadata as Record<string, unknown>;
    expect(meta1.valueDate).toBe("2026-11-12");
    expect(meta1.ageDays).toBe(8);
    expect(meta1.differenceCents).toBe(-1_500);

    // Reevaluar 7 días después actualiza antigüedad conservando valueDate, firstDetectedAt, ownerId y diferencia
    const second = buildBankExceptionInput({
      companyId: COMPANY_ID,
      source: {
        sourceKind: "BANK_DEPOSIT",
        sourceTable: "bank_transactions",
        sourceId: BANK_TX_ID,
        sourceBankAccountId: ACCT_ID,
        direction: "INFLOW",
        valueDate: "2026-11-25", // intento de pisar fecha original: debe ignorarse
        amountCents: 98_500,
        expectedAmountCents: 100_000,
        differenceCents: 0, // intento de ocultar diferencia previa: debe conservarse
        discrepancyCode: "PENDING_OVERDUE",
        reference: "DEP-881",
        description: "Abono terminal Clip",
      },
      now: now2,
      ownerId: "other-admin",
      existingMetadata: meta1,
      existingOwnerId: "admin-1",
    });

    const meta2 = second.metadata as Record<string, unknown>;
    expect(second.ownerId).toBe("admin-1");
    expect(meta2.valueDate).toBe("2026-11-12");
    expect(meta2.ageDays).toBe(15);
    expect(meta2.firstDetectedAt).toBe(meta1.firstDetectedAt);
    expect(meta2.differenceCents).toBe(-1_500);

    // Política de no ocultamiento de diferencia
    const blocked = evaluateReconciliationDifferencePolicy({
      bankAmountCents: 98_500,
      targetAmountCents: 100_000,
      disposition: "EXACT_MATCH",
      reason: "cierre silencioso",
    });
    expect(blocked.canClose).toBe(false);
    expect(blocked.differenceCents).toBe(-1_500);

    const allowedWithDisposition = evaluateReconciliationDifferencePolicy({
      bankAmountCents: 98_500,
      targetAmountCents: 100_000,
      disposition: "EXPLAINED_FEE",
      reason: "Comisión bancaria no reportada en archivo CSV de pasarela",
    });
    expect(allowedWithDisposition.canClose).toBe(true);
    expect(allowedWithDisposition.differenceCents).toBe(-1_500);
    expect(allowedWithDisposition.effectiveDisposition).toBe("EXPLAINED_FEE");
  });

  it("GET y POST /api/finance/bank-transactions/exceptions exigen RBAC, conservan fuente/antigüedad y devuelven 409 si se intenta ocultar diferencia", async () => {
    // 1. Sin permiso -> 403
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso financiero"));
    const denied = await getBankExceptions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions/exceptions"),
    );
    expect(denied.status).toBe(403);

    // 2. GET autorizado expone fuente, antigüedad, diferencia y traza
    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1" },
    });
    mockListBankExceptions.mockResolvedValueOnce([
      {
        id: "exc-bank-1",
        status: "OPEN",
        sourceKind: "BANK_DEPOSIT",
        sourceId: BANK_TX_ID,
        valueDate: "2026-11-12",
        ageDays: 15,
        amountCents: 98_500,
        expectedAmountCents: 100_000,
        differenceCents: -1_500,
        discrepancyCode: "AMOUNT_DIFFERENCE",
        reconciliationTrace: null,
      },
    ]);
    const listRes = await getBankExceptions(
      new NextRequest(
        "http://localhost:3000/api/finance/bank-transactions/exceptions?sourceKind=BANK_DEPOSIT",
      ),
    );
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.data.items).toHaveLength(1);
    expect(listJson.data.items[0]).toMatchObject({
      sourceKind: "BANK_DEPOSIT",
      valueDate: "2026-11-12",
      ageDays: 15,
      differenceCents: -1_500,
    });

    // 3. POST SYNC autorizado
    mockSyncCompanyBankExceptions.mockResolvedValueOnce({
      raised: 2,
      autoClosedExact: 1,
      keptOpenWithDifference: 1,
      evaluatedAt: "2026-11-27T12:00:00.000Z",
    });
    const syncRes = await postBankExceptions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions/exceptions", {
        method: "POST",
        body: JSON.stringify({
          action: "SYNC",
          nowIso: "2026-11-27T12:00:00.000Z",
          pendingThresholdDays: 3,
        }),
      }),
    );
    expect(syncRes.status).toBe(200);
    const syncJson = await syncRes.json();
    expect(syncJson.data.keptOpenWithDifference).toBe(1);

    // 4. POST RESOLVE_WITH_TRACE intentando ocultar diferencia -> 409 Conflict
    mockResolveBankExceptionOnReconciliation.mockRejectedValueOnce(
      ApiError.conflict("Diferencia bancaria de $-15.00 MXN no puede ocultarse"),
    );
    const hiddenDiffRes = await postBankExceptions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions/exceptions", {
        method: "POST",
        body: JSON.stringify({
          action: "RESOLVE_WITH_TRACE",
          sourceKind: "BANK_DEPOSIT",
          sourceId: BANK_TX_ID,
          matchedTargetType: "GATEWAY_TRANSACTION",
          matchedTargetId: GW_ID,
          bankAmountCents: 98_500,
          targetAmountCents: 100_000,
          disposition: "EXACT_MATCH",
        }),
      }),
    );
    expect(hiddenDiffRes.status).toBe(409);

    // 5. POST RESOLVE_WITH_TRACE con disposición explícita + motivo -> 200 preservando diferencia en traza
    mockResolveBankExceptionOnReconciliation.mockResolvedValueOnce({
      closed: true,
      differenceCents: -1_500,
      exception: { id: "exc-bank-1", status: "CANCELLED" },
      trace: {
        reconciledAt: "2026-11-27T12:05:00.000Z",
        reconciledBy: "admin-1",
        matchedTargetType: "GATEWAY_TRANSACTION",
        matchedTargetId: GW_ID,
        bankAmountCents: 98_500,
        targetAmountCents: 100_000,
        differenceCents: -1_500,
        disposition: "EXPLAINED_FEE",
        notes: "Comisión extra descontada por banco adquirente",
      },
    });
    const okRes = await postBankExceptions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions/exceptions", {
        method: "POST",
        body: JSON.stringify({
          action: "RESOLVE_WITH_TRACE",
          sourceKind: "BANK_DEPOSIT",
          sourceId: BANK_TX_ID,
          matchedTargetType: "GATEWAY_TRANSACTION",
          matchedTargetId: GW_ID,
          bankAmountCents: 98_500,
          targetAmountCents: 100_000,
          disposition: "EXPLAINED_FEE",
          notes: "Comisión extra descontada por banco adquirente",
        }),
      }),
    );
    expect(okRes.status).toBe(200);
    const okJson = await okRes.json();
    expect(okJson.data.differenceCents).toBe(-1_500);
    expect(okJson.data.trace.disposition).toBe("EXPLAINED_FEE");
  });
});
