import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const {
  mockRequirePermissionApi,
  mockCorrectAccountedDepositMatch,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockCorrectAccountedDepositMatch: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/bank-statement-service", () => ({
  listBankTransactions: vi.fn(),
  importBankStatement: vi.fn(),
  suggestMatches: vi.fn(),
  suggestDepositMatches: vi.fn(),
  confirmMatch: vi.fn(),
  confirmDepositMatch: vi.fn(),
  correctAccountedDepositMatch: mockCorrectAccountedDepositMatch,
  unmatchTransaction: vi.fn(),
  unmatchDepositTransaction: vi.fn(),
  ignoreTransaction: vi.fn(),
}));

import { PATCH as patchBankTransactions } from "@/app/api/finance/bank-transactions/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const TX_ID = "22222222-2222-4222-8222-222222222222";

describe("BAN-06.b V3 — HTTP corrección auditada de depósito contabilizado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deniega 403 sin permiso y 400 si falta motivo obligatorio", async () => {
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso"));
    const denied = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CORRECT_DEPOSIT_MATCH",
          transactionId: TX_ID,
          reason: "Depósito asignado a terminal equivocada",
        }),
      })
    );
    expect(denied.status).toBe(403);

    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1" },
    });
    const shortReason = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CORRECT_DEPOSIT_MATCH",
          transactionId: TX_ID,
          reason: "err",
        }),
      })
    );
    expect(shortReason.status).toBe(400);
    expect(mockCorrectAccountedDepositMatch).not.toHaveBeenCalled();
  });

  it("ejecuta corrección auditada (200) y propaga 409 en repetición/conflicto de versión", async () => {
    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1" },
    });

    mockCorrectAccountedDepositMatch.mockResolvedValueOnce({
      bankTransactionId: TX_ID,
      gatewayTransactionId: "gw-1",
      originalJournalId: "j-orig",
      originalJournalVersion: 2,
      reversalJournalId: "j-rev",
      auditLogId: "aud-1",
      preservedAccountingEventIds: ["ev-1"],
    });

    const ok = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CORRECT_DEPOSIT_MATCH",
          transactionId: TX_ID,
          reason: "Cruce incorrecto de depósito Clip contra sucursal equivocada",
          expectedVersion: 2,
        }),
      })
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.data).toMatchObject({
      reversalJournalId: "j-rev",
      auditLogId: "aud-1",
      preservedAccountingEventIds: ["ev-1"],
    });

    mockCorrectAccountedDepositMatch.mockRejectedValueOnce(
      ApiError.conflict("La póliza del depósito ya tiene una reversa registrada.")
    );
    const conflict = await patchBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "PATCH",
        body: JSON.stringify({
          action: "CORRECT_DEPOSIT_MATCH",
          transactionId: TX_ID,
          reason: "Reintento de corrección sobre póliza ya revertida",
        }),
      })
    );
    expect(conflict.status).toBe(409);
  });
});
