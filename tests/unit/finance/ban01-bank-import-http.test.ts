import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockRequirePermissionApi,
  mockCreateCompanyBankAccount,
  mockImportBankStatement,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockCreateCompanyBankAccount: vi.fn(),
  mockImportBankStatement: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/company-bank-account-service", () => ({
  listCompanyBankAccounts: vi.fn(),
  createCompanyBankAccount: mockCreateCompanyBankAccount,
  deactivateCompanyBankAccount: vi.fn(),
  getComputedAccountBalances: vi.fn(),
  setCompanyBankAccountAnchor: vi.fn(),
  setCompanyBankAccountPurpose: vi.fn(),
}));

vi.mock("@/lib/services/bank-statement-service", () => ({
  listBankTransactions: vi.fn(),
  importBankStatement: mockImportBankStatement,
  suggestMatches: vi.fn(),
  suggestDepositMatches: vi.fn(),
  confirmMatch: vi.fn(),
  confirmDepositMatch: vi.fn(),
  unmatchTransaction: vi.fn(),
  unmatchDepositTransaction: vi.fn(),
  ignoreTransaction: vi.fn(),
}));

import { POST as postBankAccount } from "@/app/api/finance/bank-accounts/route";
import { POST as postBankTransactions } from "@/app/api/finance/bank-transactions/route";

describe("BAN-01 V3 — HTTP cuentas protegidas e importación bancaria con errores visibles por línea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermissionApi.mockResolvedValue({
      ctx: {
        userCompanyId: "11111111-1111-4111-8111-111111111111",
        userId: "admin-1",
      },
    });
  });

  it("POST /api/finance/bank-accounts devuelve solo últimos 4 dígitos sin exponer número ni CLABE en claro", async () => {
    mockCreateCompanyBankAccount.mockResolvedValueOnce({
      id: "acct-1",
      label: "BBVA Operativa",
      accountLastFour: "7890",
      bankCode: "012",
      bankName: "BBVA",
      clabeLastFour: "0123",
      currency: "MXN",
      active: true,
      purpose: "MIXTO",
      registeredByName: "Admin",
      notes: null,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    });

    const res = await postBankAccount(
      new NextRequest("http://localhost:3000/api/finance/bank-accounts", {
        method: "POST",
        body: JSON.stringify({
          label: "BBVA Operativa",
          accountNumber: "01234567890",
          bankCode: "012",
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.accountLastFour).toBe("7890");
    expect(json.data.accountNumber).toBeUndefined();
    expect(json.data.clabe).toBeUndefined();
  });

  it("POST /api/finance/bank-transactions expone errores por línea y conteo de duplicados en la respuesta", async () => {
    mockImportBankStatement.mockResolvedValueOnce({
      importedCount: 2,
      duplicateCount: 1,
      errorCount: 2,
      errors: [
        { line: 4, raw: "31/02/2026,Pago proveedor,-1500.00,REF4", message: "Fecha ilegible" },
        { line: 5, raw: "02/06/2026,Comision,NO_NUM,REF5", message: "Monto ilegible" },
      ],
    });

    const res = await postBankTransactions(
      new NextRequest("http://localhost:3000/api/finance/bank-transactions", {
        method: "POST",
        body: JSON.stringify({
          csvText: "Fecha,Descripcion,Monto,Referencia\n01/06/2026,SPEI,-100.00,REF1",
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.importedCount).toBe(2);
    expect(json.data.duplicateCount).toBe(1);
    expect(json.data.errorCount).toBe(2);
    expect(json.data.errors).toHaveLength(2);
    expect(json.data.errors[0]).toMatchObject({ line: 4, message: "Fecha ilegible" });
    expect(json.data.errors[1]).toMatchObject({ line: 5, message: "Monto ilegible" });
  });
});
