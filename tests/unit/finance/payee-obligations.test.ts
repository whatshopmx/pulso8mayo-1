import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountsPayable } from "@/lib/services/accounts-payable-service";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));

function rows(value: unknown[]) {
  const chain = { from: vi.fn(), leftJoin: vi.fn(), where: vi.fn() };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue(value);
  return chain;
}

describe("obligaciones de una contraparte", () => {
  beforeEach(() => vi.clearAllMocks());

  it("agrupa la factura y otro gasto del mismo beneficiario en un solo saldo", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(rows([{ id: "invoice", total: 450000, supplierId: "supplier", payeeId: "payee", payeeName: "CFE" }]) as never)
      .mockReturnValueOnce(rows([{ id: "expense", amount: 100000, payeeId: "payee", payeeName: "CFE" }]) as never)
      .mockReturnValueOnce(rows([]) as never)
      .mockReturnValueOnce(rows([]) as never)
      .mockReturnValueOnce(rows([]) as never);
    const result = await getAccountsPayable({ companyId: "company" });
    expect(result.byCounterparty).toHaveLength(1);
    expect(result.byCounterparty[0]).toMatchObject({ payeeId: "payee", totalCents: 550000, count: 2 });
  });
});
