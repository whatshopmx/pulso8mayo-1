// lib/services/__tests__/invoice-matching-exception.test.ts
import { describe, it, expect } from "vitest";

describe("Invoice 3-Way Match Discrepancy & Exception Rules (Módulo 5.2)", () => {
  it("detects price discrepancy beyond tolerance percent", () => {
    const poUnitCost = 10000; // $100.00 MXN in cents
    const invoicedUnitCost = 11500; // $115.00 MXN in cents (+15%)
    const tolerancePercent = 5;

    const diffPct = Math.abs(poUnitCost - invoicedUnitCost) / poUnitCost * 100;
    const hasPriceDiscrepancy = diffPct > tolerancePercent;

    expect(diffPct).toBe(15);
    expect(hasPriceDiscrepancy).toBe(true);
  });

  it("detects quantity discrepancy beyond tolerance percent", () => {
    const orderedQty = 50; // 50 kg ordered
    const invoicedQty = 60; // 60 kg invoiced (+20%)
    const tolerancePercent = 5;

    const diffPct = Math.abs(orderedQty - invoicedQty) / orderedQty * 100;
    const hasQtyDiscrepancy = diffPct > tolerancePercent;

    expect(diffPct).toBe(20);
    expect(hasQtyDiscrepancy).toBe(true);
  });

  it("allows payment run only for MATCHED or EXCEPTION_APPROVED invoices", () => {
    const invoices = [
      { id: "inv-1", matchStatus: "MATCHED", total: 50000, paymentStatus: "PENDING" },
      { id: "inv-2", matchStatus: "DISCREPANCY", total: 80000, paymentStatus: "PENDING" },
      { id: "inv-3", matchStatus: "EXCEPTION_APPROVED", total: 80000, paymentStatus: "PENDING" },
      { id: "inv-4", matchStatus: "PENDING", total: 30000, paymentStatus: "PENDING" },
    ];

    const eligibleForPayment = invoices.filter(
      (inv) => ["MATCHED", "EXCEPTION_APPROVED"].includes(inv.matchStatus) && inv.paymentStatus === "PENDING"
    );

    expect(eligibleForPayment.map((i) => i.id)).toEqual(["inv-1", "inv-3"]);
    expect(eligibleForPayment.find((i) => i.id === "inv-2")).toBeUndefined();
  });

  it("validates exception justification requires minimum length", () => {
    const isValidReason = (reason: string) => reason.trim().length >= 5;

    expect(isValidReason("ok")).toBe(false);
    expect(isValidReason("   ")).toBe(false);
    expect(isValidReason("Aprobado por Dirección de Operaciones")).toBe(true);
  });
});
