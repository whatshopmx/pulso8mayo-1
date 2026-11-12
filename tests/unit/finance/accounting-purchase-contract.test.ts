import { describe, expect, it } from "vitest";
import { purchasePlan, receiptValue } from "@/lib/services/accounting/purchase-contract";
import { totalsOf } from "@/lib/services/accounting/amounts";

describe("FC-13 documented purchase amounts", () => {
  it("freezes received value with one cent rounding across fractional quantities", () => {
    expect(receiptValue([{ quantity: "0.5", unitCostCents: 1, basis: "DOCUMENT", accepted: true },
      { quantity: "0.5", unitCostCents: 1, basis: "PURCHASE_ORDER", accepted: true }])).toBe(1);
    expect(receiptValue([{ quantity: "3.1250", unitCostCents: 100, basis: "DOCUMENT", accepted: true }])).toBe(313);
  });
  it("refuses inferred cost, quarantine, missing value and unsafe amounts", () => {
    const line = { quantity: "1", unitCostCents: 100, basis: "DOCUMENT", accepted: true } as const;
    for (const change of [{ basis: "LAST_COST" }, { accepted: false }, { unitCostCents: null },
      { quantity: "0" }, { quantity: "NaN" }, { quantity: "0.00001" }, { unitCostCents: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(() => receiptValue([{ ...line, ...change }])).toThrow();
    }
    expect(() => receiptValue([])).toThrow();
  });
  it("recognizes inventory only at reception, then clears the same acquisition at invoicing", () => {
    expect(purchasePlan({ kind: "RECEIPT", receivedCents: 60000 })).toEqual([
      { role: "INVENTORY", debitCents: 60000, creditCents: 0 },
      { role: "RECEIVING_PENDING", debitCents: 0, creditCents: 60000 },
    ]);
    expect(purchasePlan({ kind: "INVOICE", receivedCents: 60000, netCents: 60000, taxCents: 0,
      totalCents: 60000, differenceApproved: false })).toEqual([
      { role: "RECEIVING_PENDING", debitCents: 60000, creditCents: 0 },
      { role: "PAYABLE", debitCents: 0, creditCents: 60000 },
    ]);
  });
  it("requires reviewed price differences and an explicit tax total", () => {
    const invoice = { kind: "INVOICE", receivedCents: 60000, netCents: 61000, taxCents: 9760,
      totalCents: 70760, differenceApproved: true } as const;
    const plan = purchasePlan(invoice);
    expect(plan).toContainEqual({ role: "PURCHASE_VARIANCE", debitCents: 1000, creditCents: 0 });
    expect(plan.some(line => line.role === "INVENTORY")).toBe(false);
    expect(totalsOf(plan)).toEqual({ debitCents: 70760, creditCents: 70760, balanced: true });
    expect(() => purchasePlan({ ...invoice, differenceApproved: false })).toThrow(/diferencia/i);
    expect(() => purchasePlan({ ...invoice, taxCents: null as unknown as number })).toThrow();
    expect(() => purchasePlan({ ...invoice, totalCents: 1 })).toThrow();
  });
  it("reverses documented returns at their frozen receipt value and separates a price credit", () => {
    const credit = { kind: "CREDIT", returnedCents: 10000, netCents: 11000, taxCents: 1760, totalCents: 12760 } as const;
    const plan = purchasePlan(credit);
    expect(plan).toContainEqual({ role: "INVENTORY", debitCents: 0, creditCents: 10000 });
    expect(plan).toContainEqual({ role: "PURCHASE_VARIANCE", debitCents: 0, creditCents: 1000 });
    expect(totalsOf(plan).balanced).toBe(true);
    expect(purchasePlan({ ...credit, returnedCents: 0 }).some(line => line.role === "INVENTORY")).toBe(false);
  });
  it("applies a partial payment exclusively to the outstanding supplier obligation", () => {
    expect(purchasePlan({ kind: "PAYMENT", amountCents: 10000 })).toEqual([
      { role: "PAYABLE", debitCents: 10000, creditCents: 0 },
      { role: "PAYMENT_SOURCE", debitCents: 0, creditCents: 10000 },
    ]);
  });
});
