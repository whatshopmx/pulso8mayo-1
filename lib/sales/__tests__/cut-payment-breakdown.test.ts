// lib/sales/__tests__/cut-payment-breakdown.test.ts
//
// Fase 2 — el corte manual captura el desglose por plataforma.
//
// Lo que se blinda: las plataformas se guardan en `aggregator_sales` y entran al
// cuadre contra el total, pero por "Otros" (una sola vez). Un cero capturado no
// se escribe como si la plataforma hubiera vendido; un campo vacío no se
// convierte en 0.

import { describe, expect, it } from "vitest";
import { computeCutPaymentBreakdown } from "../cut-payment-breakdown";

describe("computeCutPaymentBreakdown", () => {
  it("sin capturar nada: todo nulo, nada que cuadrar", () => {
    const r = computeCutPaymentBreakdown({
      cashCents: null,
      cardCents: null,
      otherBaseCents: null,
      aggregatorCents: {},
    });

    expect(r.aggregatorSales).toEqual({});
    expect(r.aggregatorSumCents).toBe(0);
    expect(r.otherTotalCents).toBeNull();
    expect(r.paymentsSumCents).toBe(0);
    expect(r.anyEntered).toBe(false);
  });

  it("sólo plataformas: se desglosan y entran al cuadre por Otros", () => {
    const r = computeCutPaymentBreakdown({
      cashCents: null,
      cardCents: null,
      otherBaseCents: null,
      aggregatorCents: { rappi: 30_000, uber: 15_000 },
    });

    expect(r.aggregatorSales).toEqual({ rappi: 30_000, uber: 15_000 });
    expect(r.aggregatorSumCents).toBe(45_000);
    expect(r.otherTotalCents).toBe(45_000);
    expect(r.paymentsSumCents).toBe(45_000);
    expect(r.anyEntered).toBe(true);
  });

  it("Otros base + plataformas: other_payments es la suma de los dos", () => {
    const r = computeCutPaymentBreakdown({
      cashCents: 40_000,
      cardCents: 60_000,
      otherBaseCents: 5_000, // vales/transferencias
      aggregatorCents: { rappi: 30_000, didi: 10_000 },
    });

    expect(r.otherTotalCents).toBe(45_000); // 5,000 + 40,000
    // 40,000 + 60,000 + 5,000 + 40,000 = 145,000. Las plataformas cuentan UNA vez.
    expect(r.paymentsSumCents).toBe(145_000);
  });

  it("descarta las plataformas en cero o negativas del desglose", () => {
    const r = computeCutPaymentBreakdown({
      cashCents: null,
      cardCents: null,
      otherBaseCents: null,
      aggregatorCents: { rappi: 0, uber: 15_000, didi: null },
    });

    expect(r.aggregatorSales).toEqual({ uber: 15_000 });
    expect(r.otherTotalCents).toBe(15_000);
  });

  it("un cero capturado a propósito no se pierde como 'sin capturar'", () => {
    // Efectivo en 0 (turno que no cobró efectivo) es un dato, no un vacío: el
    // cuadre debe activarse aunque no haya plataformas.
    const r = computeCutPaymentBreakdown({
      cashCents: 0,
      cardCents: 100_000,
      otherBaseCents: null,
      aggregatorCents: {},
    });

    expect(r.anyEntered).toBe(true);
    expect(r.otherTotalCents).toBeNull();
    expect(r.paymentsSumCents).toBe(100_000);
  });
});
