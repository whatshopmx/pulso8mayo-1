import { expect, it } from "vitest";
import { saleDeclarationSchema, refundDeclarationSchema, salesComponents } from "@/lib/services/accounting/sales-contract";

const amounts = { totalCents: 11220, cashCents: 2000, cardCents: 4000, platformCents: 4000, otherCents: 1220,
  revenueCents: 10000, discountCents: 500, taxCents: 1520, tipsCents: 200 };
const document = { ...amounts, documentId: "00000000-0000-4000-8000-000000000001",
  cutId: "00000000-0000-4000-8000-000000000002", totalIncludesTaxAndTips: true,
  documentReference: "SYN-POS-1", reason: "Declaración documentada" };
it("separates documented discounts, tax, tips and unsettled funds in exact cents", () => {
  const parsed = saleDeclarationSchema.parse(document);
  const components = salesComponents(parsed);
  expect(components.filter(c => c.debit).reduce((sum, c) => sum + c.amount, 0)).toBe(11220);
  expect(components.filter(c => !c.debit).reduce((sum, c) => sum + c.amount, 0)).toBe(11220);
  expect(parsed.discountCents).toBe(500);
  expect(components.find(c => c.role === "SALES_REVENUE")).toMatchObject({ amount: 9500, debit: false });
  expect(components.find(c => c.role === "TIPS_PAYABLE")).toMatchObject({ amount: 200, debit: false });
});
it("requires explicit amounts, including zero, and an explicit declaration of the gross basis", () => {
  expect(saleDeclarationSchema.safeParse({ ...document, tipsCents: undefined }).success).toBe(false);
  expect(saleDeclarationSchema.safeParse({ ...document, discountCents: undefined }).success).toBe(false);
  expect(saleDeclarationSchema.safeParse({ ...document, totalIncludesTaxAndTips: undefined }).success).toBe(false);
});
it("rejects fractional money, unequal totals and an invented principal", () => {
  expect(saleDeclarationSchema.safeParse({ ...document, cashCents: 2000.5 }).success).toBe(false);
  expect(saleDeclarationSchema.safeParse({ ...document, totalCents: 11221 }).success).toBe(false);
  expect(saleDeclarationSchema.safeParse({ ...document, companyId: document.cutId }).success).toBe(false);
});
it("requires a linked original, explicit correction date and evidence for a refund", () => {
  const refund = { ...amounts, documentId: document.documentId, originalId: document.cutId,
    accountingDate: "2026-11-01", documentReference: "REF-1", reason: "Devolución documentada" };
  expect(refundDeclarationSchema.safeParse(refund).success).toBe(true);
  expect(refundDeclarationSchema.safeParse({ ...refund, originalId: undefined }).success).toBe(false);
  expect(refundDeclarationSchema.safeParse({ ...refund, accountingDate: "0000-01-01" }).success).toBe(false);
});
