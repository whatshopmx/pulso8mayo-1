import { describe, expect, it } from "vitest";
import { classifyReceivingDelta } from "@/lib/inventory/receiving-overcount";

describe("REC-03: clasificación de diferencia saldo↔ledger", () => {
  it("saldo que cuadra con el ledger no se toca", () => {
    expect(
      classifyReceivingDelta({ observed: 10, ledger: 10, receivingQuantity: 10, receivingCount: 1 })
    ).toBe("OK");
  });

  it("el doble incremento de recepción es atribuible con exactitud", () => {
    // Recibimos 10: lote nació en 10 y el movimiento sumó 10 → saldo 20, ledger 10.
    expect(
      classifyReceivingDelta({ observed: 20, ledger: 10, receivingQuantity: 10, receivingCount: 1 })
    ).toBe("ATTRIBUTABLE");
  });

  it("soporta cantidades fraccionarias", () => {
    expect(
      classifyReceivingDelta({ observed: 7.5, ledger: 3.75, receivingQuantity: 3.75, receivingCount: 1 })
    ).toBe("ATTRIBUTABLE");
  });

  it("saldos usados o transferidos sin explicación quedan ambiguos", () => {
    // El delta no coincide con lo recibido: hay consumo/transferencia de por medio.
    expect(
      classifyReceivingDelta({ observed: 15, ledger: 4, receivingQuantity: 10, receivingCount: 1 })
    ).toBe("AMBIGUOUS");
    expect(
      classifyReceivingDelta({ observed: 8, ledger: 10, receivingQuantity: 10, receivingCount: 1 })
    ).toBe("AMBIGUOUS");
  });

  it("lote sin movimiento RECEIVING no se puede atribuir", () => {
    expect(
      classifyReceivingDelta({ observed: 10, ledger: 0, receivingQuantity: 0, receivingCount: 0 })
    ).toBe("NO_HISTORY");
  });
});
