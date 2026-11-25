import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const {
  mockRequirePermissionApi,
  mockListBankTransactions,
  mockSuggestMatches,
  mockSuggestDepositMatches,
  mockConfirmDepositMatch,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockListBankTransactions: vi.fn(),
  mockSuggestMatches: vi.fn(),
  mockSuggestDepositMatches: vi.fn(),
  mockConfirmDepositMatch: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/bank-statement-service", () => ({
  listBankTransactions: mockListBankTransactions,
  importBankStatement: vi.fn(),
  suggestMatches: mockSuggestMatches,
  suggestDepositMatches: mockSuggestDepositMatches,
  confirmMatch: vi.fn(),
  confirmDepositMatch: mockConfirmDepositMatch,
  unmatchTransaction: vi.fn(),
  unmatchDepositTransaction: vi.fn(),
  ignoreTransaction: vi.fn(),
}));

import {
  GET as getBankTransactions,
  PATCH as patchBankTransactions,
} from "@/app/api/finance/bank-transactions/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const TX_ID = "22222222-2222-4222-8222-222222222222";
const GW_ID = "33333333-3333-4333-8333-333333333333";

describe("BAN-06.a V3 — HTTP conciliación de depósitos (sugerir no confirma, validar, 409 y depósito agrupado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/finance/bank-transactions devuelve sugerencias sin confirmar y expone depósito agrupado pendiente", async () => {
    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1" },
    });
    mockListBankTransactions.mockResolvedValueOnce({ items: [], total: 0, summary: {} });
    mockSuggestMatches.mockResolvedValueOnce([]);
    mockSuggestDepositMatches.mockResolvedValueOnce([
      {
        transactionId: TX_ID,
        candidates: [],
        pendingReason: "GROUPED_DEPOSIT_UNSUPPORTED",
      },
    ]);

    const res = await getBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.depositSuggestions).toEqual([
      {
        transactionId: TX_ID,
        candidates: [],
        pendingReason: "GROUPED_DEPOSIT_UNSUPPORTED",
      },
    ]);
    expect(mockConfirmDepositMatch).not.toHaveBeenCalled();
  });

  it("PATCH CONFIRM_DEPOSIT_MATCH exige permiso (403), valida destino/neto (400), confirma (200) y propaga 409 al repetir", async () => {
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso"));
    const denied = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CONFIRM_DEPOSIT_MATCH",
          transactionId: TX_ID,
          gatewayTransactionId: GW_ID,
        }),
      })
    );
    expect(denied.status).toBe(403);

    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1" },
    });

    // Destino/neto inválido -> 400
    mockConfirmDepositMatch.mockRejectedValueOnce(
      ApiError.badRequest("La fila de pasarela no declara aterrizar en la cuenta de este depósito.")
    );
    const bad = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CONFIRM_DEPOSIT_MATCH",
          transactionId: TX_ID,
          gatewayTransactionId: GW_ID,
        }),
      })
    );
    expect(bad.status).toBe(400);

    // Confirmación válida -> 200
    mockConfirmDepositMatch.mockResolvedValueOnce(undefined);
    const ok = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CONFIRM_DEPOSIT_MATCH",
          transactionId: TX_ID,
          gatewayTransactionId: GW_ID,
          notes: "Depósito Clip verificado",
        }),
      })
    );
    expect(ok.status).toBe(200);

    // Repetición -> 409 Conflict
    mockConfirmDepositMatch.mockRejectedValueOnce(
      ApiError.conflict("Este movimiento ya fue cruzado o ignorado.")
    );
    const conflict = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CONFIRM_DEPOSIT_MATCH",
          transactionId: TX_ID,
          gatewayTransactionId: GW_ID,
        }),
      })
    );
    expect(conflict.status).toBe(409);
  });
});
