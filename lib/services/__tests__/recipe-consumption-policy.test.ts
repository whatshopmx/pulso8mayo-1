import { describe, expect, it } from 'vitest';
import { resolveRecipeConsumptionPolicy, type RecipeConsumptionPolicy } from '../recipe-consumption-policy';

const companyId = 'aaaaaaaa-0000-4000-8000-000000000001';
const recipeId = 'aaaaaaaa-0000-4000-8000-000000000002';
const version1 = 'aaaaaaaa-0000-4000-8000-000000000003';
const version2 = 'aaaaaaaa-0000-4000-8000-000000000004';
const itemId = 'aaaaaaaa-0000-4000-8000-000000000005';
const direct: RecipeConsumptionPolicy = { schemaVersion: 1, id: 'aaaaaaaa-0000-4000-8000-000000000011',
  companyId, recipeId, recipeVersionId: version1, effectiveFrom: '2026-11-01', mode: 'INGREDIENTS_ON_SALE' };
const finished: RecipeConsumptionPolicy = { schemaVersion: 1, id: 'aaaaaaaa-0000-4000-8000-000000000012',
  companyId, recipeId, recipeVersionId: version2, effectiveFrom: '2026-11-22', mode: 'FINISHED_PRODUCT_ON_SALE',
  inventoryItemId: itemId, unit: 'KG' };
const resolve = (saleDay: string, policies: readonly RecipeConsumptionPolicy[] = [direct, finished]) =>
  resolveRecipeConsumptionPolicy({ companyId, recipeId, saleDay }, policies);

describe('INV-02: contrato de responsable de consumo por vigencia', () => {
  it('antes del cambio conserva la versión y consumo de ingredientes', () => {
    expect(resolve('2026-11-21')).toEqual(direct);
  });
  it('la vigencia incluye su primer día y selecciona únicamente elaborado', () => {
    expect(resolve('2026-11-22')).toEqual(finished);
    expect(resolve('2027-01-01')).toEqual(finished);
  });
  it('no depende del orden de lectura de la base ni modifica la colección', () => {
    const policies = Object.freeze([Object.freeze({ ...finished }), Object.freeze({ ...direct })]);
    expect(resolve('2026-11-21', policies)).toEqual(direct);
    expect(policies[0]).toEqual(finished);
  });
  it('devuelve un valor separado que puede congelarse en el snapshot', () => {
    const oldSnapshot = resolve('2026-11-21');
    oldSnapshot.recipeVersionId = version2;
    expect(direct.recipeVersionId).toBe(version1);
    expect(resolve('2026-11-21')).toEqual(direct);
  });
  it.each(['2026-10-31', '2026-02-30', '2026-11-22T00:00:00Z'])('rechaza día sin cobertura o inválido %s', day => {
    expect(() => resolve(day)).toThrow();
  });
  it('sin política explícita no inventa consumo directo', () => {
    expect(() => resolve('2026-11-22', [])).toThrow(/vigencia/i);
  });
  it('rechaza vigencias ambiguas incluso si el día consultado es anterior', () => {
    expect(() => resolve('2026-11-01', [direct, { ...finished, effectiveFrom: direct.effectiveFrom }])).toThrow(/vigencia/i);
  });
  it('rechaza identidad de política duplicada', () => {
    expect(() => resolve('2026-11-22', [direct, { ...finished, id: direct.id }])).toThrow(/duplicad/i);
  });
  it('una versión publicada no adquiere otro modo bajo una segunda vigencia', () => {
    expect(() => resolve('2026-11-22', [direct, { ...finished, recipeVersionId: version1 }])).toThrow(/versión/i);
  });
  it.each([{ companyId: version2 }, { recipeId: version2 }])('rechaza políticas de otro alcance %j', scope => {
    expect(() => resolve('2026-11-22', [direct, { ...finished, ...scope }])).toThrow(/empresa|receta/i);
  });
  it.each([
    { ...finished, inventoryItemId: undefined }, { ...finished, unit: '' },
    { ...finished, unit: ' KG ' }, { ...direct, inventoryItemId: itemId },
    { ...direct, recipeVersionId: '' }, { ...direct, effectiveFrom: '2026-02-30' },
    { ...direct, mode: 'BOTH' },
  ])('rechaza definición incompleta o ambigua %j', invalid => {
    expect(() => resolve('2026-11-22', [invalid as RecipeConsumptionPolicy])).toThrow();
  });
});
