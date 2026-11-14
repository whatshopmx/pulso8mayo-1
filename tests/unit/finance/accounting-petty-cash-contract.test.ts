import { describe, expect, it } from "vitest";
import { month } from "../../fixtures/accounting/month";
import {
  isPettyCashOpeningConcept,
  normalizeAccountingVoucherKey,
  pettyCashPlan,
} from "@/lib/services/accounting/petty-cash-contract";

describe("FC-15e petty cash accounting contract", () => {
  it("matches the FC-02 oracle for petty cash expense with documented tax", () => {
    const oracle = month.journals.find(journal => journal.id === "petty-cash-expense")!;
    expect(pettyCashPlan({ kind: "OUT", amountCents: 1_160, taxCents: 160 })).toEqual([
      { role: "EXPENSE", debitCents: oracle.lines[0].debit, creditCents: 0 },
      { role: "RECOVERABLE_TAX", debitCents: oracle.lines[1].debit, creditCents: 0 },
      { role: "PETTY_CASH", debitCents: 0, creditCents: oracle.lines[2].credit },
    ]);
  });

  it("omits zero tax line when documented tax is explicitly zero", () => {
    expect(pettyCashPlan({ kind: "OUT", amountCents: 850, taxCents: 0 })).toEqual([
      { role: "EXPENSE", debitCents: 850, creditCents: 0 },
      { role: "PETTY_CASH", debitCents: 0, creditCents: 850 },
    ]);
  });

  it("matches the FC-02 oracle for petty cash replenishment without creating expense", () => {
    const oracle = month.journals.find(journal => journal.id === "petty-cash-replenishment")!;
    const plan = pettyCashPlan({ kind: "REPLENISHMENT", amountCents: 1_160 });
    expect(plan).toEqual([
      { role: "PETTY_CASH", debitCents: oracle.lines[0].debit, creditCents: 0 },
      { role: "PAYMENT_SOURCE", debitCents: 0, creditCents: oracle.lines[1].credit },
    ]);
    expect(plan.some(line => line.role === "EXPENSE" || line.role === "RECOVERABLE_TAX")).toBe(false);
  });

  it("excludes fund opening/reopening and rejects invalid or undocumented amounts", () => {
    expect(isPettyCashOpeningConcept("Apertura del fondo de caja chica")).toBe(true);
    expect(isPettyCashOpeningConcept("  Reapertura del fondo de caja chica ")).toBe(true);
    expect(isPettyCashOpeningConcept("Reposición de fondo de caja chica")).toBe(false);

    expect(() => pettyCashPlan({ kind: "REPLENISHMENT", amountCents: 500_000, isOpening: true })).toThrow(/apertura/i);
    expect(() => pettyCashPlan({ kind: "REPLENISHMENT", amountCents: 0 })).toThrow(/positiva/i);
    expect(() => pettyCashPlan({ kind: "OUT", amountCents: 0, taxCents: 0 })).toThrow(/positiva/i);
    expect(() => pettyCashPlan({ kind: "OUT", amountCents: 1_000, taxCents: 1_000 })).toThrow(/menor/i);
    expect(() => pettyCashPlan({ kind: "OUT", amountCents: 1_000, taxCents: -1 })).toThrow();
    expect(() => pettyCashPlan({ kind: "OUT", amountCents: 1_000, taxCents: undefined as unknown as number })).toThrow();
  });

  it("normalizes shared voucher identities and rejects storage URLs or filenames as identity", () => {
    expect(normalizeAccountingVoucherKey("  cfdi:550e8400-e29b-41d4-a716-446655440000 ")).toBe(
      "CFDI:550E8400-E29B-41D4-A716-446655440000",
    );
    expect(normalizeAccountingVoucherKey("rfc:ekU9003173c9 | folio: a-102")).toBe(
      "RFC:EKU9003173C9 | FOLIO: A-102",
    );
    expect(() => normalizeAccountingVoucherKey("https://r2.pulso.local/tickets/123.jpg")).toThrow(/URL/i);
    expect(() => normalizeAccountingVoucherKey("/uploads/ticket-123.pdf")).toThrow(/URL|ruta/i);
    expect(() => normalizeAccountingVoucherKey("ticket.png")).toThrow(/URL|ruta/i);
    expect(() => normalizeAccountingVoucherKey("  ")).toThrow(/Falta/i);
  });
});
