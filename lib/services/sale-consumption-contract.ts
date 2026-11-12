/** INV-01.a: identidad estable y hechos de consumo; no escribe ventas ni stock. */
export interface SaleConsumptionIdentity {
  companyId: string;
  branchId: string;
  /** Namespace estable del origen (p. ej. pos:main), no el nombre del archivo. */
  source: string;
  /** Clave opaca del producto en el origen, independiente de su receta actual. */
  productKey: string;
  /** Día civil operativo ya resuelto, YYYY-MM-DD; no timestamp UTC. */
  saleDay: string;
}

export interface AppliedSaleAllocation {
  itemId: string;
  batchId: string;
  /** Movimiento USAGE original, para devolver a su asignación y no a FEFO actual. */
  movementId: string;
  /** Saldo aplicado de ese movimiento, positivo, en la unidad física y a 4 decimales. */
  remainingQuantity: string;
  unit: string;
}

export interface SaleConsumptionMovement {
  movementId: string;
  itemId: string;
  batchId: string;
  quantityChange: string;
  unit: string;
  /** Presente al devolver consumo: movimiento original al que se compensa. */
  reversesMovementId: string | null;
}

export interface SaleRecipeSnapshot {
  schemaVersion: 1;
  recipeId: string;
  /** Versión o huella del contenido servido, conservada incluso si cambia recipes. */
  versionKey: string;
  definition: Record<string, unknown>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeSaleProductKey(input: string): string {
  const key = typeof input === "string" ? input.trim() : "";
  if (!key || [...key].length > 256 || key.includes("\u0000")) throw new Error("Clave de producto inválida");
  return key;
}
export function validateSaleDay(day: string): string {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000")
    || !Number.isFinite(Date.parse(`${day}T00:00:00.000Z`)) || new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day) throw new Error("Día civil de venta inválido");
  return day;
}
export function normalizeSaleConsumptionIdentity(input: SaleConsumptionIdentity): SaleConsumptionIdentity {
  if (!input || !uuid.test(input.companyId) || !uuid.test(input.branchId)) throw new Error("Empresa y sucursal deben ser UUID válidos");
  const source = typeof input.source === "string" ? input.source.trim().toLowerCase() : "";
  const productKey = normalizeSaleProductKey(input.productKey);
  if (!/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(source)) throw new Error("Fuente de venta inválida");
  const day = validateSaleDay(input.saleDay);
  return { companyId: input.companyId.toLowerCase(), branchId: input.branchId.toLowerCase(), source, productKey, saleDay: day };
}

/** Tupla sin concatenación ambigua; la unicidad persistida usa las cinco columnas. */
export function saleConsumptionIdentityKey(input: SaleConsumptionIdentity): string {
  const id = normalizeSaleConsumptionIdentity(input);
  return JSON.stringify([id.companyId, id.branchId, id.source, id.productKey, id.saleDay]);
}

/** numeric(10,2) de sales_entries, exacto: jamás redondea una venta silenciosamente. */
export function soldQuantity(input: string): string {
  if (typeof input !== "string") throw new Error("Cantidad de venta decimal requerida");
  const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input);
  if (!parts) throw new Error("Cantidad de venta no negativa con hasta dos decimales requerida");
  const integer = parts[1].replace(/^0+(?=\d)/, "");
  if (integer.length > 8) throw new Error("Cantidad de venta fuera de rango");
  return `${integer}.${(parts[2] || "").padEnd(2, "0")}`;
}

/** El llamador decide si hubo cambio; un reintento idéntico no debe llamar a este constructor. */
export function nextSaleConsumptionRevision(previous: { revision: number; quantitySold: string } | null, quantity: string) {
  if (previous !== null && (!previous || !Number.isInteger(previous.revision) || previous.revision < 1 || previous.revision >= 2147483647)) throw new Error("Revisión previa fuera de rango o desconocida");
  return {
    revision: previous ? previous.revision + 1 : 1,
    previousRevision: previous?.revision ?? null,
    previousQuantitySold: soldQuantity(previous === null ? "0" : previous.quantitySold),
    quantitySold: soldQuantity(quantity),
  };
}
