import { describe, expect, it } from "vitest";
import {
  aggregateBudgetExecution,
  computeBudgetExecution,
  computeEmergencyShare,
  computePriceSpread,
  withSupplierShare,
  DEFAULT_CONTROL_TARGETS,
} from "./control-kpi-types";

describe("computeBudgetExecution", () => {
  it("marca OK mientras el consumo no llegue al umbral de aviso", () => {
    const r = computeBudgetExecution(100_000, 50_000);
    expect(r.consumedPercent).toBe(50);
    expect(r.availableCents).toBe(50_000);
    expect(r.deviationCents).toBe(-50_000);
    expect(r.status).toBe("OK");
    expect(r.unbudgeted).toBe(false);
  });

  it("enciende ámbar exactamente en el umbral de 90%", () => {
    expect(computeBudgetExecution(100_000, 90_000).status).toBe("OK");
    expect(computeBudgetExecution(100_000, 90_001).status).toBe("WARNING");
  });

  it("un consumo de 100% exacto todavía es WARNING, no sobregiro", () => {
    const r = computeBudgetExecution(100_000, 100_000);
    expect(r.status).toBe("WARNING");
    expect(r.deviationCents).toBe(0);
  });

  it("el sobregiro es CRITICAL y deja disponible negativo", () => {
    const r = computeBudgetExecution(100_000, 130_000);
    expect(r.status).toBe("CRITICAL");
    expect(r.consumedPercent).toBe(130);
    expect(r.availableCents).toBe(-30_000);
    expect(r.deviationCents).toBe(30_000);
  });

  it("gasto sin presupuesto capturado es CRITICAL y se marca unbudgeted", () => {
    const r = computeBudgetExecution(null, 20_000);
    expect(r.unbudgeted).toBe(true);
    expect(r.status).toBe("CRITICAL");
    // Sin techo no hay porcentaje: un 0% o un 100% mentirían igual.
    expect(r.consumedPercent).toBeNull();
    expect(r.deviationCents).toBe(20_000);
  });

  it("sin presupuesto y sin gasto no dice nada (status null)", () => {
    const r = computeBudgetExecution(null, 0);
    expect(r.status).toBeNull();
    expect(r.unbudgeted).toBe(false);
    expect(r.consumedPercent).toBeNull();
  });

  it("normaliza presupuestos y comprometidos negativos a cero", () => {
    const r = computeBudgetExecution(-500, -900);
    expect(r.budgetedCents).toBe(0);
    expect(r.committedCents).toBe(0);
    expect(r.status).toBeNull();
  });
});

describe("computeEmergencyShare", () => {
  const base = { emergencyCount: 1, totalCount: 10 };

  it("por debajo de la meta del 5% es OK", () => {
    const r = computeEmergencyShare({ emergencyCents: 4_000, totalCents: 100_000, ...base });
    expect(r.percent).toBe(4);
    expect(r.status).toBe("OK");
  });

  it("entre meta y tolerancia es WARNING", () => {
    expect(
      computeEmergencyShare({ emergencyCents: 8_000, totalCents: 100_000, ...base }).status,
    ).toBe("WARNING");
  });

  it("arriba de la tolerancia es CRITICAL", () => {
    expect(
      computeEmergencyShare({ emergencyCents: 15_000, totalCents: 100_000, ...base }).status,
    ).toBe("CRITICAL");
  });

  it("sin gasto comprometido no hay porcentaje ni semáforo", () => {
    const r = computeEmergencyShare({ emergencyCents: 0, totalCents: 0, ...base });
    expect(r.percent).toBeNull();
    expect(r.status).toBeNull();
  });

  it("respeta metas personalizadas", () => {
    const strict = { ...DEFAULT_CONTROL_TARGETS, emergencyTargetPercent: 1, emergencyWarnPercent: 2 };
    expect(
      computeEmergencyShare({ emergencyCents: 4_000, totalCents: 100_000, ...base }, strict).status,
    ).toBe("CRITICAL");
  });
});

describe("aggregateBudgetExecution", () => {
  it("suma celdas y recalcula el semáforo sobre el total", () => {
    const rows = [
      computeBudgetExecution(100_000, 30_000),
      computeBudgetExecution(100_000, 40_000),
    ];
    const total = aggregateBudgetExecution(rows);
    expect(total.budgetedCents).toBe(200_000);
    expect(total.committedCents).toBe(70_000);
    expect(total.status).toBe("OK");
  });

  it("conserva la bandera unbudgeted aunque el total quede dentro de presupuesto", () => {
    const rows = [
      computeBudgetExecution(100_000, 10_000),
      computeBudgetExecution(null, 5_000), // centro sin techo
    ];
    const total = aggregateBudgetExecution(rows);
    expect(total.status).toBe("OK");
    expect(total.unbudgeted).toBe(true);
  });

  it("sin filas devuelve un total vacío sin semáforo", () => {
    const total = aggregateBudgetExecution([]);
    expect(total.budgetedCents).toBe(0);
    expect(total.status).toBeNull();
  });
});

describe("computePriceSpread", () => {
  it("mide la dispersión contra el precio más bajo, no contra el promedio", () => {
    const r = computePriceSpread([10_000, 12_000]);
    expect(r.minCents).toBe(10_000);
    expect(r.maxCents).toBe(12_000);
    expect(r.spreadPercent).toBe(20);
  });

  it("precios idénticos entre sucursales son 0% y OK", () => {
    const r = computePriceSpread([11_000, 11_000, 11_000]);
    expect(r.spreadPercent).toBe(0);
    expect(r.status).toBe("OK");
  });

  it("hasta 5% es OK, hasta 10% es WARNING, arriba es CRITICAL", () => {
    expect(computePriceSpread([100, 105]).status).toBe("OK");
    expect(computePriceSpread([100, 110]).status).toBe("WARNING");
    expect(computePriceSpread([100, 111]).status).toBe("CRITICAL");
  });

  it("una sola sucursal no tiene con qué compararse: dispersión 0", () => {
    const r = computePriceSpread([7_500]);
    expect(r.spreadPercent).toBe(0);
    expect(r.minCents).toBe(7_500);
  });

  it("ignora precios cero o negativos en vez de inventar una dispersión infinita", () => {
    const r = computePriceSpread([0, 10_000, -50]);
    expect(r.minCents).toBe(10_000);
    expect(r.spreadPercent).toBe(0);
  });

  it("sin precios válidos no hay dispersión ni semáforo", () => {
    const r = computePriceSpread([0, 0]);
    expect(r.spreadPercent).toBeNull();
    expect(r.status).toBeNull();
  });
});

describe("withSupplierShare", () => {
  const base = { purchaseOrders: 1, serviceOrders: 0 };

  it("ordena por monto descendente y reparte la participación", () => {
    const rows = withSupplierShare([
      { supplierId: "a", supplierName: "A", totalCents: 25_000, ...base },
      { supplierId: "b", supplierName: "B", totalCents: 75_000, ...base },
    ]);
    expect(rows.map((r) => r.supplierId)).toEqual(["b", "a"]);
    expect(rows[0].sharePercent).toBe(75);
    expect(rows[1].sharePercent).toBe(25);
  });

  it("sin gasto no divide entre cero", () => {
    const rows = withSupplierShare([
      { supplierId: "a", supplierName: "A", totalCents: 0, ...base },
    ]);
    expect(rows[0].sharePercent).toBe(0);
  });

  it("sin proveedores devuelve lista vacía", () => {
    expect(withSupplierShare([])).toEqual([]);
  });
});
