import { z } from 'zod';
import { validateSaleDay } from './sale-consumption-contract';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform(value => value.toLowerCase());
const day = z.string().refine(value => {
  try { validateSaleDay(value); return true; } catch { return false; }
}, 'Día civil de vigencia inválido');
const identity = {
  schemaVersion: z.literal(1), id: uuid, companyId: uuid, recipeId: uuid,
  recipeVersionId: uuid, effectiveFrom: day,
};
const policy = z.discriminatedUnion('mode', [
  z.object({ ...identity, mode: z.literal('INGREDIENTS_ON_SALE') }).strict(),
  z.object({ ...identity, mode: z.literal('FINISHED_PRODUCT_ON_SALE'), inventoryItemId: uuid,
    unit: z.string().min(1).refine(value => value === value.trim(), 'Unidad sin espacios exteriores requerida'),
  }).strict(),
]);

/** INV-02: una versión tiene UN responsable del consumo; nunca ambos. */
export type RecipeConsumptionPolicy = z.infer<typeof policy>;

/** Valida un registro de servidor sin permitir campos fuera del contrato. */
export function parseRecipeConsumptionPolicy(input: unknown): RecipeConsumptionPolicy {
  return policy.parse(input);
}

/**
 * Resuelve una secuencia de vigencias [desde, siguiente desde) por día civil.
 * Las filas deben proceder del lector de servidor, acotadas a empresa/receta.
 * No inventa un modo para históricos sin política: su snapshot original sigue
 * siendo la fuente de devoluciones/reintentos. El resultado se congela dentro
 * del NUEVO snapshot; nunca se vuelve a resolver al compensar un hecho previo.
 *
 * La validación de FK (versión y producto propios), append-only y prohibición
 * de cambios retroactivos corresponde al writer/DB, no a esta función pura.
 */
export function resolveRecipeConsumptionPolicy(
  scope: { companyId: string; recipeId: string; saleDay: string },
  policies: readonly RecipeConsumptionPolicy[],
): RecipeConsumptionPolicy {
  const companyId = uuid.parse(scope.companyId), recipeId = uuid.parse(scope.recipeId);
  const saleDay = validateSaleDay(scope.saleDay);
  const ids = new Set<string>(), starts = new Set<string>(), versions = new Set<string>();
  let selected: RecipeConsumptionPolicy | undefined;
  for (const input of policies) {
    // parse devuelve una copia: ni ordenar ni mutar las filas del caller.
    const row = policy.parse(input);
    if (row.companyId !== companyId || row.recipeId !== recipeId) {
      throw new Error('Política de consumo de otra empresa o receta');
    }
    if (ids.has(row.id)) throw new Error('Identidad de política duplicada');
    if (starts.has(row.effectiveFrom)) throw new Error('Vigencias de consumo ambiguas');
    if (versions.has(row.recipeVersionId)) throw new Error('Versión de receta publicada más de una vez');
    ids.add(row.id); starts.add(row.effectiveFrom); versions.add(row.recipeVersionId);
    if (row.effectiveFrom <= saleDay && (!selected || row.effectiveFrom > selected.effectiveFrom)) selected = row;
  }
  if (!selected) throw new Error('No hay política de consumo con vigencia para este día');
  return selected;
}
