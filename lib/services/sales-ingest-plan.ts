import { normalizeSaleProductKey, soldQuantity, validateSaleDay } from "./sale-consumption-contract";
import type { NormalizedSaleRow, SalesRowError } from "./sales-ingest-pure";

export interface PlannedSaleImport {
  productKey: string;
  recipeRef: string;
  saleDay: string;
  quantitySold: string;
  totalRevenueCents: number | null;
  rowNumbers: number[];
}

/** Valida también callers no CSV. Un grupo inválido jamás entrega un subtotal. */
export function planSalesImport(rows: NormalizedSaleRow[]): { groups: PlannedSaleImport[]; errors: SalesRowError[] } {
  const candidates = new Map<string, NormalizedSaleRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.productKey?.trim() ?? row.recipeRef?.trim(), row.saleDay]);
    const group = candidates.get(key) ?? [];
    group.push(row);
    candidates.set(key, group);
  }
  const groups: PlannedSaleImport[] = [];
  const errors: SalesRowError[] = [];
  for (const members of candidates.values()) {
    try {
      const first = members[0];
      const productKey = normalizeSaleProductKey(first.productKey ?? first.recipeRef);
      const recipeRef = normalizeSaleProductKey(first.recipeRef);
      const saleDay = validateSaleDay(first.saleDay);
      let quantityHundredths = 0;
      let revenue = 0;
      let revenueComplete = true;
      for (const row of members) {
        if (normalizeSaleProductKey(row.recipeRef) !== recipeRef) throw new Error("Un producto/día tiene referencias de receta incompatibles");
        quantityHundredths += Number(soldQuantity(String(row.quantitySold)).replace(".", ""));
        if (quantityHundredths > 9999999999) throw new Error("Cantidad agregada fuera de rango");
        if (row.totalRevenueCents === null) revenueComplete = false;
        else {
          if (!Number.isInteger(row.totalRevenueCents) || row.totalRevenueCents < 0) throw new Error("Importe en centavos inválido");
          revenue += row.totalRevenueCents;
          if (revenue > 2147483647) throw new Error("Importe agregado fuera de rango");
        }
      }
      const quantitySold = `${Math.floor(quantityHundredths / 100)}.${String(quantityHundredths % 100).padStart(2, "0")}`;
      groups.push({ productKey, recipeRef, saleDay, quantitySold, totalRevenueCents: revenueComplete ? revenue : null, rowNumbers: members.map(row => row.rowNumber) });
    } catch (error) {
      for (const row of members) errors.push({ rowNumber: row.rowNumber, message: error instanceof Error ? error.message : "Grupo de venta inválido" });
    }
  }
  return { groups, errors };
}
