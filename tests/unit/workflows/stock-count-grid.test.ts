import { describe, expect, it } from 'vitest';
import { normalizeStockCount, stockCountTotals } from '@/lib/workflows/stock-count-grid';

const rows = [
  { itemId: 'pollo', batchId: 'lote-a', name: 'Pollo', sku: 'P', unit: 'kg', lotNumber: 'A', systemQuantity: 2.2 },
  { itemId: 'pollo', batchId: 'lote-b', name: 'Pollo', sku: 'P', unit: 'kg', lotNumber: 'B', systemQuantity: 3 },
];
const payload = (quantities: unknown[]) => ({ kind: 'stock_count', rows: rows.map((r, i) => ({ ...r, countedQuantity: quantities[i] })) });

describe('conteo por categoría y lote', () => {
  it('suma los lotes sin perder los decimales ni su identidad', () => {
    const count = normalizeStockCount(rows, payload([2.5, 0]), true);
    expect(count.rows.map(r => r.batchId)).toEqual(['lote-a', 'lote-b']);
    expect(stockCountTotals(count)).toEqual([{ itemId: 'pollo', countedQuantity: 2.5, systemQuantity: 5.2 }]);
  });
  it('distingue un pendiente de un cero contado y permite guardar borradores', () => {
    const count = normalizeStockCount(rows, payload(['', 0]), false);
    expect(count.rows.map(r => r.countedQuantity)).toEqual([null, 0]);
    expect(() => normalizeStockCount(rows, payload(['', 0]), true)).toThrow(/pendiente/i);
    expect(stockCountTotals(count)).toEqual([]);
  });
  it('rechaza cantidades negativas, parciales, infinitas y fuera de escala', () => {
    for (const q of [-1, '3kg', Infinity, 100000000, {}, true]) {
      expect(() => normalizeStockCount(rows, payload([q, 0]), false)).toThrow();
    }
  });
  it('no acepta lotes ajenos, duplicados ni filas omitidas al completar', () => {
    expect(() => normalizeStockCount(rows, { rows: [{ itemId: 'pollo', batchId: 'ajeno', countedQuantity: 1 }] }, false)).toThrow();
    const first = payload([1, 2]).rows[0];
    expect(() => normalizeStockCount(rows, { rows: [first, first] }, false)).toThrow();
    expect(() => normalizeStockCount(rows, { rows: [first] }, true)).toThrow(/pendiente/i);
  });
  it('toma los metadatos y el stock del servidor, nunca del cliente', () => {
    const input = payload([2, 3]);
    input.rows[0].systemQuantity = 999;
    input.rows[0].name = 'Manipulado';
    const count = normalizeStockCount(rows, JSON.stringify(input), true);
    expect(count.rows[0]).toMatchObject({ systemQuantity: 2.2, name: 'Pollo' });
  });
  it('conserva todos los productos de una categoría de más de 30 artículos', () => {
    const scope = Array.from({ length: 40 }, (_, i) => ({ ...rows[0], itemId: `item-${i}`, batchId: `lot-${i}` }));
    const count = normalizeStockCount(scope, { rows: scope.map(r => ({ ...r, countedQuantity: 0 })) }, true);
    expect(count.rows).toHaveLength(40);
    expect(stockCountTotals(count)).toHaveLength(40);
  });
});
