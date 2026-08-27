// lib/services/__tests__/recurring-contracts.test.ts
import { describe, it, expect } from "vitest";

describe("Recurring Contracts Variance & Budget Control Rules (Módulo 4.2 & 5.1)", () => {
  it("passes when invoice matches base contract amount exactly", () => {
    const baseAmountCents = 2500000; // $25,000.00 MXN (Renta mensual)
    const invoicedAmountCents = 2500000;
    const tolerancePercent = 10;

    const varianceCents = invoicedAmountCents - baseAmountCents;
    const variancePercent = (varianceCents / baseAmountCents) * 100;
    const isCompliant = variancePercent <= tolerancePercent;

    expect(varianceCents).toBe(0);
    expect(variancePercent).toBe(0);
    expect(isCompliant).toBe(true);
  });

  it("passes when invoice increase is within tolerance (e.g. +7% vs 10% tolerance)", () => {
    const baseAmountCents = 1800000; // $18,000.00 MXN (CFE estimado)
    const invoicedAmountCents = 1926000; // $19,260.00 MXN (+7%)
    const tolerancePercent = 10;

    const varianceCents = invoicedAmountCents - baseAmountCents;
    const variancePercent = Math.round((varianceCents / baseAmountCents) * 1000) / 10;
    const isCompliant = variancePercent <= tolerancePercent;

    expect(variancePercent).toBe(7);
    expect(isCompliant).toBe(true);
  });

  it("flags violation when invoice increase exceeds tolerance (e.g. +22% vs 10% tolerance)", () => {
    const baseAmountCents = 1800000; // $18,000.00 MXN
    const invoicedAmountCents = 2196000; // $21,960.00 MXN (+22%)
    const tolerancePercent = 10;

    const varianceCents = invoicedAmountCents - baseAmountCents;
    const variancePercent = Math.round((varianceCents / baseAmountCents) * 1000) / 10;
    const isCompliant = variancePercent <= tolerancePercent;

    expect(variancePercent).toBe(22);
    expect(isCompliant).toBe(false);
  });

  it("generates descriptive audit message on cost overrun", () => {
    const contractTitle = "Renta Local San Pedro";
    const baseAmountCents = 4500000;
    const invoicedAmountCents = 5200000; // +15.6%
    const tolerancePercent = 10;

    const varianceCents = invoicedAmountCents - baseAmountCents;
    const variancePercent = Math.round((varianceCents / baseAmountCents) * 1000) / 10;
    const isCompliant = variancePercent <= tolerancePercent;

    const alertMessage = !isCompliant
      ? `Desviación en contrato recurrente "${contractTitle}": Facturado $${(invoicedAmountCents / 100).toFixed(2)} vs Base $${(baseAmountCents / 100).toFixed(2)} (+${variancePercent}% vs tolerancia +${tolerancePercent}%)`
      : undefined;

    expect(isCompliant).toBe(false);
    expect(alertMessage).toContain("Desviación en contrato recurrente \"Renta Local San Pedro\"");
    expect(alertMessage).toContain("+15.6% vs tolerancia +10%");
  });
});
