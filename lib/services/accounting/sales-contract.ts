import { z } from "zod";

const cents = z.number().int().min(0).max(2_147_483_647);
const day = z.iso.date().refine(value => value >= "0001-01-01", "Fecha inválida.");
export const salesAmountFields = ["totalCents", "cashCents", "cardCents", "platformCents", "otherCents",
  "revenueCents", "discountCents", "taxCents", "tipsCents"] as const;
const amounts = { totalCents: cents.min(1), cashCents: cents, cardCents: cents, platformCents: cents, otherCents: cents,
  revenueCents: cents, discountCents: cents, taxCents: cents, tipsCents: cents };
const evidence = { documentId: z.uuid(), documentReference: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(5).max(500) };
type Amounts = { [K in typeof salesAmountFields[number]]: number };
function balanced(value: Amounts) {
  return value.revenueCents >= value.discountCents
    && value.totalCents === value.cashCents + value.cardCents + value.platformCents + value.otherCents
    && value.totalCents === value.revenueCents - value.discountCents + value.taxCents + value.tipsCents;
}
export const saleDeclarationSchema = z.object({ ...amounts, ...evidence,
  cutId: z.uuid(), totalIncludesTaxAndTips: z.literal(true),
  version: z.number().int().min(1).max(2_147_483_647).default(1), originalId: z.uuid().nullable().optional(),
}).strict().refine(balanced, "El bruto, medios de cobro, impuesto, propinas y descuento no cuadran.")
  .refine(value => (value.version === 1) === !value.originalId, "La versión corregida debe referir a su venta anterior.");
export const refundDeclarationSchema = z.object({ ...amounts, ...evidence, originalId: z.uuid(), accountingDate: day })
  .strict().refine(balanced, "El desglose de la devolución no cuadra.");
export type SaleDeclaration = z.input<typeof saleDeclarationSchema>;
export type RefundDeclaration = z.input<typeof refundDeclarationSchema>;

/** Gross includes tax/tips after discount. Never subtract the discount twice. */
export function salesComponents(value: Amounts) {
  return [
    { role: "CASH", amount: value.cashCents, debit: true },
    { role: "CARD_RECEIVABLE", amount: value.cardCents, debit: true },
    { role: "PLATFORM_RECEIVABLE", amount: value.platformCents, debit: true },
    { role: "OTHER_RECEIVABLE", amount: value.otherCents, debit: true },
    // FC-02 oracle books net revenue. The explicit discount stays on the
    // immutable document; it must not inflate ledger turnovers a second time.
    { role: "SALES_REVENUE", amount: value.revenueCents - value.discountCents, debit: false },
    { role: "SALES_TAX", amount: value.taxCents, debit: false },
    { role: "TIPS_PAYABLE", amount: value.tipsCents, debit: false },
  ].filter(component => component.amount > 0);
}
