import { describe, expect, it } from 'vitest';
import { buildSaleRecipeSnapshot, saleSnapshotDemand, type SaleRecipeDefinition, type SaleRecipeReader } from '../sale-consumption-snapshot';
import type { RecipeConsumptionPolicy } from '../recipe-consumption-policy';

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const companyId = id(1), root = id(10), prep = id(20), rice = id(30), finished = id(40);
type Published = SaleRecipeDefinition & { publication: {
  policy: RecipeConsumptionPolicy; recipeVersionId: string; versionNumber: number; saleDay: string;
} };
function fixture() {
  const direct: RecipeConsumptionPolicy = { schemaVersion: 1, id: id(201), companyId, recipeId: root,
    recipeVersionId: id(101), effectiveFrom: '2026-11-01', mode: 'INGREDIENTS_ON_SALE' };
  const terminal: RecipeConsumptionPolicy = { schemaVersion: 1, id: id(203), companyId, recipeId: prep,
    recipeVersionId: id(103), effectiveFrom: '2026-12-01', mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: finished, unit: 'KG' };
  const line = (lineId: string, itemId: string, quantity: string, unit: string, isSubRecipe = false) => ({
    id: lineId, itemId, quantity, unit, isSubRecipe, yieldPercent: 100,
  });
  const recipes = new Map<string, Published>([
    [root, { id: root, companyId, baseYield: '10.00', unit: 'PORTION', items: [line('sub', prep, '500.0000', 'G', true), line('raw', rice, '20.0000', 'G')],
      publication: { policy: direct, recipeVersionId: id(101), versionNumber: 1, saleDay: '2026-12-02' } }],
    [prep, { id: prep, companyId, baseYield: '2.00', unit: 'KG', items: [line('base', rice, '1.0000', 'KG')],
      publication: { policy: terminal, recipeVersionId: id(103), versionNumber: 3, saleDay: '2026-12-02' } }],
  ]);
  const ingredients = new Map([[rice, { id: rice, companyId, unit: 'KG' }], [finished, { id: finished, companyId, unit: 'KG' }]]);
  const recipeReads: string[] = [], ingredientReads: string[] = [];
  const reader: SaleRecipeReader = {
    recipe: async key => { recipeReads.push(key); return recipes.get(key) ?? null; },
    ingredient: async key => { ingredientReads.push(key); return ingredients.get(key) ?? null; },
    conversions: async () => [{ id: id(301), companyId, fromUnit: 'G', toUnit: 'KG', factor: '0.001000' }],
  };
  return { recipes, ingredients, reader, recipeReads, ingredientReads };
}
const snapshot = (f: ReturnType<typeof fixture>, recipeId = root) => buildSaleRecipeSnapshot(companyId, recipeId, f.reader);

describe('INV-02.snapshot: versión publicada y terminal elaborado', () => {
  it('una subreceta elaborada detiene expansión y conserva los insumos directos del padre', async () => {
    const f = fixture(); const result = await snapshot(f);
    // 10 porciones: 500 G de elaborado + 20 G de arroz, sin los 250 G
    // de arroz que ya corresponderían a fabricar ese elaborado.
    expect(saleSnapshotDemand(result, '10')).toEqual([
      { itemId: rice, unit: 'KG', quantity: '0.0200' }, { itemId: finished, unit: 'KG', quantity: '0.5000' },
    ]);
    expect(JSON.stringify(result.definition)).toContain(id(203));
    expect(JSON.stringify(result.definition)).toContain(id(103));
  });
  it('venta del elaborado no vuelve a dividir por el rendimiento de fabricación', async () => {
    const f = fixture();
    expect(saleSnapshotDemand(await snapshot(f, prep), '3')).toEqual([{ itemId: finished, unit: 'KG', quantity: '3.0000' }]);
    expect(f.recipeReads).toEqual([prep]); expect(f.ingredientReads).toEqual([finished]);
  });
  it('no sigue hijos de un terminal, aunque la ficha tenga un ciclo sin usar', async () => {
    const f = fixture(); f.recipes.get(prep)!.items[0] = { ...f.recipes.get(prep)!.items[0], itemId: prep, isSubRecipe: true };
    expect(saleSnapshotDemand(await snapshot(f, prep), '1')).toEqual([{ itemId: finished, unit: 'KG', quantity: '1.0000' }]);
  });
  it('convierte exactamente la unidad de salida al SKU elaborado', async () => {
    const f = fixture(); f.ingredients.get(finished)!.unit = 'G';
    f.recipes.get(prep)!.publication.policy = { ...f.recipes.get(prep)!.publication.policy,
      mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: finished, unit: 'G' };
    expect(saleSnapshotDemand(await snapshot(f, prep), '3')).toEqual([{ itemId: finished, unit: 'G', quantity: '3000.0000' }]);
  });
  it('congela ambos modos: publicar elaborado después no reinterpreta demanda previa', async () => {
    const f = fixture(); const terminal = f.recipes.get(prep)!.publication;
    f.recipes.get(prep)!.publication = { ...terminal, recipeVersionId: id(102), versionNumber: 2,
      policy: { schemaVersion: 1, id: id(202), companyId, recipeId: prep, recipeVersionId: id(102),
        effectiveFrom: '2026-11-01', mode: 'INGREDIENTS_ON_SALE' } };
    const before = await snapshot(f); f.recipes.get(prep)!.publication = terminal;
    const after = await snapshot(f);
    expect(saleSnapshotDemand(before, '10')).toEqual([{ itemId: rice, unit: 'KG', quantity: '0.2700' }]);
    expect(saleSnapshotDemand(before, '8')).toEqual([{ itemId: rice, unit: 'KG', quantity: '0.2160' }]);
    expect(saleSnapshotDemand(after, '8')).toEqual([
      { itemId: rice, unit: 'KG', quantity: '0.0160' }, { itemId: finished, unit: 'KG', quantity: '0.4000' },
    ]);
    expect(after.versionKey).not.toBe(before.versionKey);
  });
  it.each(['company', 'version', 'day', 'future', 'mutable', 'unit'] as const)('rechaza metadatos incoherentes: %s', async problem => {
    const f = fixture(); const row = f.recipes.get(prep)!;
    if (problem === 'company') row.publication.policy = { ...row.publication.policy, companyId: id(999) };
    if (problem === 'version') row.publication.recipeVersionId = id(999);
    if (problem === 'day') row.publication.saleDay = '2026-12-03';
    if (problem === 'future') row.publication.policy = { ...row.publication.policy, effectiveFrom: '2026-12-03' };
    if (problem === 'mutable') delete (row as SaleRecipeDefinition).publication;
    if (problem === 'unit') f.ingredients.get(finished)!.unit = 'L';
    await expect(snapshot(f)).rejects.toThrow();
  });
  it('mantiene la huella histórica sin metadatos de publicación', async () => {
    const legacy = await buildSaleRecipeSnapshot('tenant-a', 'dish', {
      recipe: async () => ({ id: 'dish', companyId: 'tenant-a', baseYield: '1.00', unit: 'PORTION', items: [
        { id: 'line-1', itemId: 'rice', quantity: '100.0000', unit: 'G', isSubRecipe: false, yieldPercent: 100 },
      ] }),
      ingredient: async () => ({ id: 'rice', companyId: 'tenant-a', unit: 'KG' }),
      conversions: async () => [{ id: 'g-kg', companyId: 'tenant-a', fromUnit: 'G', toUnit: 'KG', factor: '0.001000' }],
    });
    expect(legacy.versionKey).toBe('fa02da6052bd33a46395cc5d2dfd71fb8e6e735bcf9d001796f8c1fa7cd3b3eb');
  });
});
