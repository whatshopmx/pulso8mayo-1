/** Frozen at launch; the client may supply quantities, never replace this scope. */
export interface StockCountRow {
  itemId: string;
  batchId: string | null;
  name: string;
  sku: string;
  unit: string;
  lotNumber: string | null;
  expirationDate?: string | null;
  systemQuantity: number;
}

export interface StockCountValue {
  kind: 'stock_count';
  rows: (StockCountRow & { countedQuantity: number | null })[];
}

export const stockCountRowKey = (row: { itemId: string; batchId: string | null }) =>
  `${row.itemId}:${row.batchId ?? 'no-batch'}`;

export function readStockCount(raw: unknown): StockCountValue | null {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value?.kind === 'stock_count' && Array.isArray(value.rows) ? value : null;
  } catch {
    return null;
  }
}

export function normalizeStockCount(scope: StockCountRow[], raw: unknown, complete: boolean): StockCountValue {
  let parsed: { rows?: unknown };
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as typeof parsed;
  } catch {
    throw new Error('El conteo tiene un formato inválido.');
  }
  if (!parsed || !Array.isArray(parsed.rows)) throw new Error('El conteo tiene un formato inválido.');
  const allowed = new Set(scope.map(stockCountRowKey));
  const quantities = new Map<string, number | null>();
  for (const row of parsed.rows) {
    if (!row || typeof row !== 'object' || typeof row.itemId !== 'string' ||
        !(row.batchId === null || typeof row.batchId === 'string')) throw new Error('Fila de conteo inválida.');
    const key = stockCountRowKey(row);
    if (!allowed.has(key) || quantities.has(key)) throw new Error('El producto o lote no pertenece al conteo, o está duplicado.');
    const value = row.countedQuantity;
    let qty: number | null = null;
    if (value !== null && value !== undefined && value !== '') {
      if (!(typeof value === 'number' || typeof value === 'string') || String(value).trim() === '') {
        throw new Error('Ingresa una cantidad numérica válida.');
      }
      qty = Number(value);
      if (!Number.isFinite(qty) || qty < 0 || qty >= 100000000) throw new Error('Ingresa una cantidad entre 0 y 99,999,999.9999.');
      qty = Math.round(qty * 10000) / 10000;
      if (qty >= 100000000) throw new Error('La cantidad supera el máximo permitido.');
    }
    quantities.set(key, qty);
  }
  const rows = scope.map(row => ({ ...row, countedQuantity: quantities.get(stockCountRowKey(row)) ?? null }));
  if (complete && (rows.length === 0 || rows.some(r => r.countedQuantity === null))) {
    throw new Error('Hay productos o lotes pendientes de contar. Captura 0 cuando no haya existencias.');
  }
  return { kind: 'stock_count', rows };
}

/** Reports remain per product; incomplete products are never interpreted as zero. */
export function stockCountTotals(count: StockCountValue) {
  const totals = new Map<string, { itemId: string; countedQuantity: number; systemQuantity: number; pending: boolean }>();
  for (const row of count.rows) {
    const total = totals.get(row.itemId) ?? { itemId: row.itemId, countedQuantity: 0, systemQuantity: 0, pending: false };
    total.countedQuantity += row.countedQuantity ?? 0;
    total.systemQuantity += row.systemQuantity;
    total.pending ||= row.countedQuantity === null;
    totals.set(row.itemId, total);
  }
  return [...totals.values()].filter(t => !t.pending).map(t => ({
    itemId: t.itemId,
    countedQuantity: Math.round(t.countedQuantity * 10000) / 10000,
    systemQuantity: Math.round(t.systemQuantity * 10000) / 10000,
  }));
}
