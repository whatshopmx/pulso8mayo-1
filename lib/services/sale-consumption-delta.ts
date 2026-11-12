import type { AppliedSaleAllocation } from "./sale-consumption-contract";

/** Demanda TOTAL en la unidad física del artículo, calculada desde el snapshot del servidor. */
export interface SaleIngredientDemand { itemId: string; unit: string; quantity: string }
export interface SaleAllocationReturn extends AppliedSaleAllocation { quantity: string }

const zero = BigInt(0), scale = BigInt(10000);
const maxQuantity = BigInt("999999999999"); // numeric(12,4)
function physicalQuantity(input: string): bigint {
  const parts = typeof input === "string" && /^(\d{1,8})(?:\.(\d{1,4}))?$/.exec(input);
  if (!parts) throw new Error("Cantidad física no negativa con hasta cuatro decimales requerida");
  return BigInt(parts[1]) * scale + BigInt((parts[2] || "").padEnd(4, "0"));
}
function decimal(input: bigint): string {
  if (input < zero || input > maxQuantity) throw new Error("Cantidad física fuera de rango");
  return `${input / scale}.${String(input % scale).padStart(4, "0")}`;
}
function required(input: string) {
  if (typeof input !== "string" || !input.trim() || input !== input.trim()) throw new Error("Procedencia y unidad física requeridas");
}

/**
 * Plan sin efectos: retiene consumo vigente y devuelve el excedente contra su
 * movimiento original (última asignación primero). El writer debe verificar la
 * procedencia en DB y aplicar devoluciones, nuevas asignaciones y revisión en
 * una transacción. Aquí no se decide disponibilidad ni se inventa stock.
 *
 * Al cambiar el snapshot de receta se revierte todo y se aplica la demanda
 * nueva, aunque coincida el artículo: la nueva procedencia queda explícita.
 */
export function planSaleConsumptionDelta(
  previous: readonly AppliedSaleAllocation[],
  target: readonly SaleIngredientDemand[],
  recipeChanged = false,
): { retained: AppliedSaleAllocation[]; returns: SaleAllocationReturn[]; consume: SaleIngredientDemand[] } {
  const units = new Map<string, string>();
  const checkUnit = (itemId: string, unit: string) => {
    required(itemId); required(unit);
    if (units.has(itemId) && units.get(itemId) !== unit) throw new Error("Unidad física inconsistente para el artículo");
    units.set(itemId, unit);
  };
  const needed = new Map<string, bigint>();
  for (const row of target) {
    checkUnit(row.itemId, row.unit);
    const total = (needed.get(row.itemId) ?? zero) + physicalQuantity(row.quantity);
    decimal(total); // validar también el agregado
    needed.set(row.itemId, total);
  }
  const movements = new Set<string>();
  const retained = previous.map(row => {
    checkUnit(row.itemId, row.unit); required(row.batchId); required(row.movementId);
    if (movements.has(row.movementId)) throw new Error("Movimiento original duplicado");
    movements.add(row.movementId);
    const quantity = physicalQuantity(row.remainingQuantity);
    if (quantity === zero) throw new Error("Asignación agotada no debe figurar como vigente");
    return { ...row, remainingQuantity: decimal(quantity) };
  });
  const applied = new Map<string, bigint>();
  for (const row of retained) {
    const total = (applied.get(row.itemId) ?? zero) + physicalQuantity(row.remainingQuantity);
    decimal(total);
    applied.set(row.itemId, total);
  }
  const returns: SaleAllocationReturn[] = [];
  for (let index = retained.length - 1; index >= 0; index--) {
    const row = retained[index];
    const total = applied.get(row.itemId)!;
    const excess = recipeChanged ? total : total - (needed.get(row.itemId) ?? zero);
    if (excess <= zero) continue;
    const available = physicalQuantity(row.remainingQuantity);
    const quantity = available < excess ? available : excess;
    returns.push({ ...row, quantity: decimal(quantity) });
    row.remainingQuantity = decimal(available - quantity);
    applied.set(row.itemId, total - quantity);
  }
  const consume: SaleIngredientDemand[] = [];
  for (const [itemId, quantity] of needed) {
    const missing = quantity - (applied.get(itemId) ?? zero);
    if (missing > zero) consume.push({ itemId, unit: units.get(itemId)!, quantity: decimal(missing) });
  }
  return { retained: retained.filter(row => row.remainingQuantity !== "0.0000"), returns, consume };
}
