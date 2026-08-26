// Task 5 (plan-loteprod-gaps §6.4): ciclo de vencimiento del tiempo de retención.
import { describe, expect, it } from "vitest";
import {
  buildHoldTimeAlert,
  classifyHoldStatus,
  holdTimeLossCents,
  HOLD_TIME_AUTO_WASTE_GRACE_MINUTES,
  minutesOverdue,
  minutesRemaining,
  shouldAutoRegisterWaste,
  validateHoldTimeDiscard,
} from "../hold-time";

const NOW = new Date("2026-08-26T14:00:00.000Z");
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe("classifyHoldStatus", () => {
  it("dentro de ventana con holgura es OK", () => {
    expect(classifyHoldStatus(min(20), NOW)).toBe("OK");
  });

  it("a 5 min o menos entra en por vencer", () => {
    expect(classifyHoldStatus(min(5), NOW)).toBe("EXPIRING");
    expect(classifyHoldStatus(min(1), NOW)).toBe("EXPIRING");
  });

  it("exactamente en la hora de vencimiento ya es vencido", () => {
    expect(classifyHoldStatus(min(0), NOW)).toBe("EXPIRED");
    expect(classifyHoldStatus(min(-30), NOW)).toBe("EXPIRED");
  });

  it("receta sin hold time no se clasifica", () => {
    expect(classifyHoldStatus(null, NOW)).toBeNull();
  });

  it("respeta una ventana de aviso distinta", () => {
    expect(classifyHoldStatus(min(8), NOW, 10)).toBe("EXPIRING");
    expect(classifyHoldStatus(min(8), NOW, 5)).toBe("OK");
  });
});

describe("minutesOverdue", () => {
  it("cuenta minutos completos vencidos", () => {
    expect(minutesOverdue(min(-90), NOW)).toBe(90);
  });

  it("no vencida devuelve 0, nunca negativo", () => {
    expect(minutesOverdue(min(15), NOW)).toBe(0);
  });
});

describe("minutesRemaining", () => {
  it("redondea hacia arriba lo que queda en línea", () => {
    expect(minutesRemaining(new Date(NOW.getTime() + 90_000), NOW)).toBe(2);
  });

  it("ya vencida devuelve 0, nunca negativo", () => {
    expect(minutesRemaining(min(-15), NOW)).toBe(0);
  });
});

describe("shouldAutoRegisterWaste", () => {
  it("no cierra sola una tanda recién vencida: el turno todavía puede confirmar", () => {
    expect(shouldAutoRegisterWaste(min(-10), NOW)).toBe(false);
    expect(shouldAutoRegisterWaste(min(-(HOLD_TIME_AUTO_WASTE_GRACE_MINUTES - 1)), NOW)).toBe(false);
  });

  it("cumplida la gracia el cron la cierra", () => {
    expect(shouldAutoRegisterWaste(min(-HOLD_TIME_AUTO_WASTE_GRACE_MINUTES), NOW)).toBe(true);
    expect(shouldAutoRegisterWaste(min(-600), NOW)).toBe(true);
  });
});

describe("holdTimeLossCents", () => {
  it("prorratea el costo de insumos de la tanda", () => {
    // 20 porciones costaron $100.00 → $5.00 la porción; se tiran 3.
    expect(
      holdTimeLossCents({ ingredientCost: 10000, producedQuantity: 20, discardedQuantity: 3 })
    ).toEqual({ costPerUnitCents: 500, totalLossCents: 1500 });
  });

  it("redondea una sola vez al final, no por unidad", () => {
    // 3 porciones costaron 100¢ → 33.33¢ c/u; tirar las 3 son 100¢, no 99.
    expect(
      holdTimeLossCents({ ingredientCost: 100, producedQuantity: 3, discardedQuantity: 3 })
    ).toEqual({ costPerUnitCents: 33, totalLossCents: 100 });
  });

  it("sin costo de insumos no inventa una pérdida", () => {
    expect(
      holdTimeLossCents({ ingredientCost: 0, producedQuantity: 10, discardedQuantity: 2 })
    ).toEqual({ costPerUnitCents: null, totalLossCents: null });
    expect(
      holdTimeLossCents({ ingredientCost: null, producedQuantity: 10, discardedQuantity: 2 })
    ).toEqual({ costPerUnitCents: null, totalLossCents: null });
  });

  it("producción cero no divide entre cero", () => {
    expect(
      holdTimeLossCents({ ingredientCost: 5000, producedQuantity: 0, discardedQuantity: 0 })
    ).toEqual({ costPerUnitCents: null, totalLossCents: null });
  });
});

describe("validateHoldTimeDiscard", () => {
  const base = {
    expiresAt: min(-30),
    discardedAt: null as Date | null,
    producedQuantity: 10,
    discardedQuantity: 4,
    now: NOW,
  };

  it("acepta el descarte de una tanda vencida", () => {
    expect(validateHoldTimeDiscard(base)).toEqual({ ok: true });
  });

  it("acepta cantidad 0 — venció en el sistema pero se vendió", () => {
    expect(validateHoldTimeDiscard({ ...base, discardedQuantity: 0 })).toEqual({ ok: true });
  });

  it("rechaza una tanda todavía en ventana", () => {
    expect(validateHoldTimeDiscard({ ...base, expiresAt: min(10) }).code).toBe("NOT_EXPIRED");
  });

  it("rechaza receta sin hold time", () => {
    expect(validateHoldTimeDiscard({ ...base, expiresAt: null }).code).toBe("NOT_EXPIRED");
  });

  it("rechaza una tanda ya cerrada (idempotencia visible en la API)", () => {
    expect(validateHoldTimeDiscard({ ...base, discardedAt: min(-5) }).code).toBe(
      "ALREADY_DISCARDED"
    );
  });

  it("rechaza tirar más de lo producido", () => {
    expect(validateHoldTimeDiscard({ ...base, discardedQuantity: 11 }).code).toBe("OVER_QUANTITY");
  });

  it("rechaza cantidades negativas o no numéricas", () => {
    expect(validateHoldTimeDiscard({ ...base, discardedQuantity: -1 }).code).toBe(
      "INVALID_QUANTITY"
    );
    expect(validateHoldTimeDiscard({ ...base, discardedQuantity: Number.NaN }).code).toBe(
      "INVALID_QUANTITY"
    );
  });

  it("la tanda cerrada gana sobre la cantidad inválida: no reabre el caso", () => {
    expect(
      validateHoldTimeDiscard({ ...base, discardedAt: min(-5), discardedQuantity: 99 }).code
    ).toBe("ALREADY_DISCARDED");
  });
});

describe("buildHoldTimeAlert", () => {
  it("una sola tanda es ALTA y lista el producto con sus minutos vencidos", () => {
    const alert = buildHoldTimeAlert("Sucursal Centro", [
      { recipeName: "Pollo cocido", quantity: 12, unit: "PORTION", minutesOverdue: 22 },
    ]);
    expect(alert.severity).toBe("ALTA");
    expect(alert.message).toContain("Sucursal Centro");
    expect(alert.message).toContain("Pollo cocido: 12 PORTION (venció hace 22 min)");
  });

  it("varias tandas a la vez son CRITICA (línea desatendida, §9.3)", () => {
    const alert = buildHoldTimeAlert("Sucursal Norte", [
      { recipeName: "Papas fritas", quantity: 6, unit: "PORTION", minutesOverdue: 8 },
      { recipeName: "Hamburguesa armada", quantity: 3, unit: "PORTION", minutesOverdue: 15 },
    ]);
    expect(alert.severity).toBe("CRITICA");
    expect(alert.message).toContain("Papas fritas");
    expect(alert.message).toContain("Hamburguesa armada");
  });

  it("explica la salida de 'se vendió' para no forzar mermas falsas", () => {
    const alert = buildHoldTimeAlert("Centro", [
      { recipeName: "Ensamble frío", quantity: 2, unit: "PORTION", minutesOverdue: 3 },
    ]);
    expect(alert.message).toContain("cantidad 0");
  });
});
