import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const {
  mockRequirePermissionApi,
  mockConfirmMatch,
  mockUnmatchTransaction,
  mockUnmatchDepositTransaction,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockConfirmMatch: vi.fn(),
  mockUnmatchTransaction: vi.fn(),
  mockUnmatchDepositTransaction: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/bank-statement-service", () => ({
  listBankTransactions: vi.fn(),
  importBankStatement: vi.fn(),
  suggestMatches: vi.fn(),
  suggestDepositMatches: vi.fn(),
  confirmMatch: mockConfirmMatch,
  confirmDepositMatch: vi.fn(),
  unmatchTransaction: mockUnmatchTransaction,
  unmatchDepositTransaction: mockUnmatchDepositTransaction,
  ignoreTransaction: vi.fn(),
}));

import { PATCH as patchBankTransactions } from "@/app/api/finance/bank-transactions/route";

const TX_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";

describe("BAN-04 V3 — HTTP matching de egresos (confirmar, conflicto 409, deshacer y permiso)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deniega con 403 sin permiso reports:update FINANCIAL", async () => {
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso"));
    const res = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({ action: "CONFIRM_MATCH", transactionId: TX_ID, paymentRunItemId: ITEM_ID }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("confirma match (200), propaga conflicto en repetición/carrera (409) y deshace cruce de egreso (200)", async () => {
    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1" },
    });

    mockConfirmMatch.mockResolvedValueOnce(undefined);
    const ok = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CONFIRM_MATCH",
          transactionId: TX_ID,
          paymentRunItemId: ITEM_ID,
          notes: "SPEI verificado",
        }),
      })
    );
    expect(ok.status).toBe(200);
    expect(mockConfirmMatch).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      transactionId: TX_ID,
      paymentRunItemId: ITEM_ID,
      userId: "admin-1",
      notes: "SPEI verificado",
    });

    // Repetición / carrera devuelve 409 Conflict
    mockConfirmMatch.mockRejectedValueOnce(ApiError.conflict("Este movimiento ya fue cruzado."));
    const conflict = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CONFIRM_MATCH",
          transactionId: TX_ID,
          paymentRunItemId: ITEM_ID,
        }),
      })
    );
    expect(conflict.status).toBe(409);

    // Deshacer cruce de egreso (sin deposit=true) llama unmatchTransaction
    mockUnmatchTransaction.mockResolvedValueOnce(undefined);
    const unmatched = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({ action: "UNMATCH", transactionId: TX_ID }),
      })
    );
    expect(unmatched.status).toBe(200);
    expect(mockUnmatchTransaction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      transactionId: TX_ID,
    });
    expect(mockUnmatchDepositTransaction).not.toHaveBeenCalled();
  });
});
