import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const {
  mockRequirePermissionApi,
  mockListCompanyBankAccounts,
  mockCreateCompanyBankAccount,
  mockListBankTransactions,
  mockImportBankStatement,
  mockSuggestMatches,
  mockSuggestDepositMatches,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockListCompanyBankAccounts: vi.fn(),
  mockCreateCompanyBankAccount: vi.fn(),
  mockListBankTransactions: vi.fn(),
  mockImportBankStatement: vi.fn(),
  mockSuggestMatches: vi.fn(),
  mockSuggestDepositMatches: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/company-bank-account-service", () => ({
  listCompanyBankAccounts: mockListCompanyBankAccounts,
  createCompanyBankAccount: mockCreateCompanyBankAccount,
  deactivateCompanyBankAccount: vi.fn(),
  getComputedAccountBalances: vi.fn(),
  setCompanyBankAccountAnchor: vi.fn(),
  setCompanyBankAccountPurpose: vi.fn(),
}));

vi.mock("@/lib/services/bank-statement-service", () => ({
  listBankTransactions: mockListBankTransactions,
  importBankStatement: mockImportBankStatement,
  suggestMatches: mockSuggestMatches,
  suggestDepositMatches: mockSuggestDepositMatches,
  confirmMatch: vi.fn(),
  confirmDepositMatch: vi.fn(),
  unmatchTransaction: vi.fn(),
  unmatchDepositTransaction: vi.fn(),
  ignoreTransaction: vi.fn(),
}));

import { GET as getBankAccounts, POST as postBankAccounts } from "@/app/api/finance/bank-accounts/route";
import { GET as getBankTransactions, POST as postBankTransactions } from "@/app/api/finance/bank-transactions/route";

describe("SEC-05.tesoreria V3 — Fronteras HTTP de cuentas y movimientos bancarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deniega con 403 si faltan permisos FINANCIAL en bank-accounts y bank-transactions", async () => {
    mockRequirePermissionApi.mockRejectedValue(ApiError.forbidden("Sin permiso FINANCIAL"));

    const r1 = await getBankAccounts(new NextRequest("http://localhost:3000/api/finance/bank-accounts"));
    const r2 = await postBankAccounts(
      new NextRequest("http://localhost:3000/api/finance/bank-accounts", {
        method: "POST",
        body: JSON.stringify({ label: "BBVA", accountNumber: "1234567890" }),
      })
    );
    const r3 = await getBankTransactions(new NextRequest("http://localhost:3000/api/finance/bank-transactions"));
    const r4 = await postBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "POST",
        body: JSON.stringify({ csvText: "fecha,desc,monto\n2026-06-01,Test,-100" }),
      })
    );

    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
    expect(r3.status).toBe(403);
    expect(r4.status).toBe(403);
  });

  it("propaga exclusivamente ctx.userCompanyId desde la sesión a los servicios bancarios", async () => {
    const companyId = "11111111-1111-4111-8111-111111111111";
    const userId = "admin-1";
    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: companyId, userId },
    });
    mockListCompanyBankAccounts.mockResolvedValueOnce([]);
    mockListBankTransactions.mockResolvedValueOnce({ items: [], total: 0 });
    mockSuggestMatches.mockResolvedValueOnce([]);
    mockSuggestDepositMatches.mockResolvedValueOnce([]);

    const r1 = await getBankAccounts(new NextRequest("http://localhost:3000/api/finance/bank-accounts"));
    expect(r1.status).toBe(200);
    expect(mockListCompanyBankAccounts).toHaveBeenCalledWith(companyId, { activeOnly: false });

    const r2 = await getBankTransactions(new NextRequest("http://localhost:3000/api/finance/bank-transactions"));
    expect(r2.status).toBe(200);
    expect(mockListBankTransactions).toHaveBeenCalledWith(expect.objectContaining({ companyId }));
    expect(mockSuggestMatches).toHaveBeenCalledWith({ companyId });
    expect(mockSuggestDepositMatches).toHaveBeenCalledWith({ companyId });
  });
});
