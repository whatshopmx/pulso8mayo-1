import { assertCents, MAX_CENTS } from "./amounts";

export const INVENTORY_KINDS = ["USAGE", "USAGE_RETURN", "WASTE", "TRANSFER_OUT", "TRANSFER_IN", "TRANSFER_WASTE"] as const;
export type InventoryKind = typeof INVENTORY_KINDS[number];
export const isInventoryValuationEnabled = () => process.env.ACCOUNTING_INVENTORY_ENABLED === "1";
const scale = BigInt(10000), zero = BigInt(0);

function ticks(value: string): bigint {
  const match = /^(-?)(\d{1,8})(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) throw new RangeError("La cantidad requiere hasta cuatro decimales y debe caber en numeric(12,4).");
  const amount = BigInt(match[2]) * scale + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] ? -amount : amount;
}
function safe(value: bigint) {
  if (value < zero || value > BigInt(MAX_CENTS)) throw new RangeError("La valoración excede los centavos seguros.");
  return Number(value);
}

/** Exact physical quantity, documented integer cents/unit; a missing cost stays pending. */
export function movementValue(quantity: string, unitCostCents: number | null): number {
  if (unitCostCents === null) throw new RangeError("Falta el costo del movimiento; no se publica un cero estimado.");
  const quantityTicks = ticks(quantity), absolute = quantityTicks < zero ? -quantityTicks : quantityTicks;
  if (!absolute) throw new RangeError("El movimiento requiere una cantidad distinta de cero.");
  return safe((absolute * BigInt(assertCents(unitCostCents)) + scale / BigInt(2)) / scale);
}

/** Cumulative allocation makes the last partial return/receipt conserve every original cent. */
export function proratedMovementValue(original: { quantity: string; amountCents: number },
  applied: { quantity: string; amountCents: number }, quantity: string): number {
  const total = ticks(original.quantity), before = ticks(applied.quantity), delta = ticks(quantity);
  const cents = BigInt(assertCents(original.amountCents)), previous = BigInt(assertCents(applied.amountCents));
  if (total <= zero || before < zero || delta <= zero || before + delta > total) {
    throw new RangeError("La devolución o recepción excede la cantidad original.");
  }
  const rounded = (part: bigint) => (cents * part * BigInt(2) + total) / (total * BigInt(2));
  if (rounded(before) !== previous) throw new RangeError("El valor aplicado no coincide con el original congelado.");
  return safe(rounded(before + delta) - previous);
}

/** Roles only; explicit reviewed rules choose the actual ledger accounts. */
export function inventoryPlan(kind: InventoryKind, amountCents: number) {
  const amount = assertCents(amountCents);
  if (!amount) throw new RangeError("El movimiento redondea a cero centavos; requiere revisión sin una póliza vacía.");
  const roles: Record<InventoryKind, readonly [string, string]> = {
    USAGE: ["COGS", "INVENTORY"], USAGE_RETURN: ["INVENTORY", "COGS"], WASTE: ["WASTE", "INVENTORY"],
    TRANSFER_OUT: ["IN_TRANSIT", "INVENTORY"], TRANSFER_IN: ["INVENTORY", "IN_TRANSIT"], TRANSFER_WASTE: ["WASTE", "IN_TRANSIT"],
  };
  if (!Object.hasOwn(roles, kind)) throw new RangeError("Tipo de movimiento contable desconocido.");
  return [{ role: roles[kind][0], debitCents: amount, creditCents: 0 },
    { role: roles[kind][1], debitCents: 0, creditCents: amount }];
}
