// lib/sales/__tests__/cut-status.test.ts
//
// El estado del corte decide qué fila exige atención en el registro. La
// precedencia importa: un faltante de caja no puede quedar escondido detrás de
// una diferencia de terminal.

import { describe, expect, it } from "vitest";
import { cutStatus, type CutStatusInput } from "../cut-status";

function cut(overrides: Partial<CutStatusInput> = {}): CutStatusInput {
  return {
    status: "VALIDATED",
    cashSales: null,
    cashCountedCents: null,
    cardSales: null,
    tpvDepositCents: null,
    commissionCents: null,
    ...overrides,
  };
}

describe("cutStatus", () => {
  it("un corte sin efectivo ni diferencias queda cuadrado y sin atención", () => {
    const s = cutStatus(cut());
    expect(s.kind).toBe("cuadrado");
    expect(s.tone).toBe("ok");
    expect(s.needsAttention).toBe(false);
  });

  it("el faltante de caja es lo más grave", () => {
    const s = cutStatus(cut({ cashSales: 40000, cashCountedCents: 30000 }));
    expect(s.kind).toBe("faltante_caja");
    expect(s.tone).toBe("danger");
    expect(s.label).toBe("Faltan $100.00");
    expect(s.needsAttention).toBe(true);
  });

  it("el sobrante de caja es advertencia, no error", () => {
    const s = cutStatus(cut({ cashSales: 40000, cashCountedCents: 50000 }));
    expect(s.kind).toBe("sobrante_caja");
    expect(s.tone).toBe("warning");
  });

  it("una diferencia de terminal no tapa un faltante de caja", () => {
    const s = cutStatus(
      cut({
        cashSales: 40000,
        cashCountedCents: 30000, // caja faltante
        cardSales: 100000,
        tpvDepositCents: 90000,
        commissionCents: 3000, // terminal también descuadra
      }),
    );
    expect(s.kind).toBe("faltante_caja");
  });

  it("diferencia de terminal cuando la caja está cuadrada", () => {
    const s = cutStatus(
      cut({ cashSales: 40000, cashCountedCents: 40000, cardSales: 100000, tpvDepositCents: 90000, commissionCents: 3000 }),
    );
    expect(s.kind).toBe("diferencia_terminal");
    expect(s.tone).toBe("warning");
    expect(s.label).toBe("Terminal: faltan $70.00");
  });

  it("marca la diferencia de terminal que incluye comisión sin capturar", () => {
    const s = cutStatus(cut({ cardSales: 100000, tpvDepositCents: 97000, commissionCents: null }));
    expect(s.kind).toBe("diferencia_terminal");
    expect(s.detail).toBe("incluye comisión sin capturar");
  });

  it("observación cuando el ingest dejó el corte en revisión", () => {
    const s = cutStatus(cut({ status: "PENDING_REVIEW" }));
    expect(s.kind).toBe("observacion");
    expect(s.needsAttention).toBe(true);
  });

  it("la observación no tapa una diferencia de caja", () => {
    const s = cutStatus(cut({ status: "PENDING_REVIEW", cashSales: 40000, cashCountedCents: 30000 }));
    expect(s.kind).toBe("faltante_caja");
  });

  it("tarjeta declarada sin depósito queda 'sin conciliar', sin alarma", () => {
    const s = cutStatus(cut({ cardSales: 100000, tpvDepositCents: null }));
    expect(s.kind).toBe("sin_conciliar");
    expect(s.tone).toBe("pending");
    // No es error: la terminal liquida con rezago.
    expect(s.needsAttention).toBe(false);
  });

  it("un cero capturado en efectivo no es diferencia", () => {
    const s = cutStatus(cut({ cashSales: 0, cashCountedCents: 0 }));
    expect(s.kind).toBe("cuadrado");
  });
});
