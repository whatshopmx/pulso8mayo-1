import { describe, expect, it } from "vitest";
import { assertCents, MAX_CENTS, sumCents, toCents, totalsOf } from "@/lib/services/accounting/amounts";
import { ledgerDecimal, ledgerMoney } from "@/components/finance/accounting-types";

describe("accounting cents", () => {
  it("preserves cents when editing and displaying the largest safe amount", () => {
    expect(ledgerDecimal(MAX_CENTS)).toBe("90071992547409.91");
    expect(ledgerMoney(MAX_CENTS)).toBe("$90,071,992,547,409.91");
    expect(ledgerMoney(-1)).toBe("-$0.01");
  });
  it("converts decimals exactly without rounding numeric inputs", () => {
    expect(toCents(0.29)).toBe(29);
    expect(toCents("1234.5")).toBe(123450);
    expect(toCents("90071992547409.91")).toBe(MAX_CENTS);
    for (const amount of [1.005, 1.999, -0.001, NaN, Infinity, "1.001", "1e3", "-1"]) {
      expect(() => toCents(amount)).toThrow(RangeError);
    }
  });

  it("rejects fractional, negative and unsafe cents and totals", () => {
    for (const amount of [-1, 0.1, MAX_CENTS + 1, NaN, Infinity]) {
      expect(() => assertCents(amount)).toThrow(RangeError);
    }
    expect(sumCents([MAX_CENTS - 1, 1])).toBe(MAX_CENTS);
    expect(() => sumCents([MAX_CENTS, 1])).toThrow(RangeError);
    expect(() => totalsOf([{ debitCents: MAX_CENTS, creditCents: 0 }, { debitCents: 1, creditCents: 0 }])).toThrow(RangeError);
  });

  it("compares both sides in integer cents", () => {
    expect(totalsOf([{ debitCents: 29, creditCents: 0 }, { debitCents: 0, creditCents: 29 }]))
      .toEqual({ debitCents: 29, creditCents: 29, balanced: true });
    expect(totalsOf([{ debitCents: 29, creditCents: 28 }]).balanced).toBe(false);
  });
});
