import { createHash } from "node:crypto";
import { z } from "zod";
import { soldQuantity, type SaleRecipeSnapshot } from "./sale-consumption-contract";
import type { SaleIngredientDemand } from "./sale-consumption-delta";

export interface SaleRecipeDefinition {
  id: string; companyId: string; baseYield: string; unit: string;
  items: { id: string; itemId: string; quantity: string; unit: string; isSubRecipe: boolean; yieldPercent: number | null }[];
}
export interface SaleUnitConversion { id: string; companyId: string; fromUnit: string; toUnit: string; factor: string }
export interface SaleRecipeReader {
  recipe(id: string, companyId: string): Promise<SaleRecipeDefinition | null>;
  ingredient(id: string, companyId: string): Promise<{ id: string; companyId: string; unit: string } | null>;
  conversions(from: string, to: string, companyId: string): Promise<SaleUnitConversion[]>;
}
type Fraction = { n: bigint; d: bigint };
const zero = BigInt(0), one = BigInt(1), two = BigInt(2), scale = BigInt(10000);
function fraction(n: bigint, d = one): Fraction {
  if (n < zero || d <= zero) throw new Error("Fracción de consumo inválida");
  let a = n, b = d;
  while (b !== zero) { const rest = a % b; a = b; b = rest; }
  const result = { n: n / a, d: d / a };
  if (String(result.n).length > 512 || String(result.d).length > 512) throw new Error("Complejidad de fracción de consumo excedida");
  return result;
}
function quantity(input: string, precision: number, integerDigits: number): Fraction {
  const match = typeof input === "string" && /^(\d+)(?:\.(\d+))?$/.exec(input);
  if (!match || match[1].length > integerDigits || (match[2]?.length ?? 0) > precision) throw new Error("Cantidad de receta/conversión inválida");
  return fraction(BigInt(match[1] + (match[2] || "")), BigInt(10) ** BigInt(match[2]?.length ?? 0));
}
const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);
const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const divide = (a: Fraction, b: Fraction) => fraction(a.n * b.d, a.d * b.n);
const ordered = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function unit(value: string) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error("Unidad de receta requerida");
}
/** JSONB puede reordenar claves: la huella usa claves ordenadas recursivamente. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const fingerprint = (definition: Record<string, unknown>) => createHash("sha256").update(canonical(definition)).digest("hex");
const calculation = "sale-recipe-demand:v1-half-up";

/** Sólo el reader del servidor suministra recetas/artículos/conversiones con alcance. */
export async function buildSaleRecipeSnapshot(companyId: string, recipeId: string, reader: SaleRecipeReader): Promise<SaleRecipeSnapshot> {
  if (!companyId || !recipeId) throw new Error("Empresa y receta requeridas");
  const definitions = new Map<string, SaleRecipeDefinition>();
  const conversions = new Map<string, SaleUnitConversion>();
  const ingredients = new Map<string, { id: string; companyId: string; unit: string }>();
  const expanded = new Map<string, Map<string, Fraction>>();
  const visiting = new Set<string>();
  let lines = 0;
  async function convert(from: string, to: string): Promise<Fraction> {
    unit(from); unit(to);
    if (from === to) return fraction(one);
    const rows = await reader.conversions(from, to, companyId);
    if (rows.some(row => row.companyId !== companyId)) throw new Error("Conversión de otra empresa");
    const direct = rows.filter(row => row.fromUnit === from && row.toUnit === to);
    const reverse = rows.filter(row => row.fromUnit === to && row.toUnit === from);
    if (direct.length > 1 || reverse.length > 1 || direct.length + reverse.length !== rows.length || !rows.length) throw new Error("Conversión faltante o ambigua");
    const factor = direct.length ? quantity(direct[0].factor, 6, 6) : divide(fraction(one), quantity(reverse[0].factor, 6, 6));
    if (factor.n === zero) throw new Error("Conversión debe ser positiva");
    if (direct.length && reverse.length) {
      const product = multiply(factor, quantity(reverse[0].factor, 6, 6));
      if (product.n !== product.d) throw new Error("Conversión inversa inconsistente");
    }
    for (const row of rows) conversions.set(row.id, { ...row });
    return factor;
  }
  async function expand(id: string): Promise<Map<string, Fraction>> {
    if (visiting.has(id)) throw new Error("Ciclo de subrecetas");
    if (expanded.has(id)) return expanded.get(id)!;
    if (visiting.size >= 32 || definitions.size >= 1000) throw new Error("Límite de expansión de recetas excedido");
    const row = await reader.recipe(id, companyId);
    if (!row || row.companyId !== companyId || row.id !== id) throw new Error("Receta inexistente o de otra empresa");
    unit(row.unit);
    const base = quantity(row.baseYield, 2, 8);
    if (base.n === zero) throw new Error("Rendimiento base debe ser positivo");
    const recipe = structuredClone(row);
    recipe.items.sort(ordered);
    if (!recipe.items.length) throw new Error("Receta sin ingredientes: consumo sin definir");
    if (new Set(recipe.items.map(item => item.id)).size !== recipe.items.length) throw new Error("Líneas de receta duplicadas");
    definitions.set(id, recipe); visiting.add(id);
    const result = new Map<string, Fraction>();
    for (const line of recipe.items) {
      if (++lines > 10000) throw new Error("Límite de ingredientes excedido");
      const yieldPercent = line.yieldPercent ?? 100;
      if (!Number.isInteger(yieldPercent) || yieldPercent < 1 || yieldPercent > 100) throw new Error("Rendimiento de ingrediente inválido");
      const perOutput = multiply(divide(quantity(line.quantity, 4, 6), base), fraction(BigInt(100), BigInt(yieldPercent)));
      if (line.isSubRecipe) {
        const child = await expand(line.itemId);
        const factor = multiply(perOutput, await convert(line.unit, definitions.get(line.itemId)!.unit));
        for (const [itemId, amount] of child) result.set(itemId, add(result.get(itemId) ?? fraction(zero), multiply(factor, amount)));
      } else {
        let ingredient = ingredients.get(line.itemId);
        if (!ingredient) {
          ingredient = await reader.ingredient(line.itemId, companyId);
          if (!ingredient || ingredient.companyId !== companyId || ingredient.id !== line.itemId) throw new Error("Ingrediente inexistente o de otra empresa");
          unit(ingredient.unit); ingredients.set(line.itemId, { ...ingredient });
        }
        const amount = multiply(perOutput, await convert(line.unit, ingredient.unit));
        result.set(line.itemId, add(result.get(line.itemId) ?? fraction(zero), amount));
      }
    }
    visiting.delete(id); expanded.set(id, result);
    return result;
  }
  const amounts = await expand(recipeId);
  const definition = {
    calculation, companyId, rootRecipeId: recipeId,
    recipes: [...definitions.values()].sort(ordered), conversions: [...conversions.values()].sort(ordered),
    ingredients: [...ingredients.values()].sort(ordered).map(item => ({ itemId: item.id, unit: item.unit, numerator: String(amounts.get(item.id)?.n ?? zero), denominator: String(amounts.get(item.id)?.d ?? one) })),
  };
  return { schemaVersion: 1, recipeId, versionKey: fingerprint(definition), definition };
}

const natural = z.string().regex(/^\d{1,512}$/);
const storedDemand = z.object({ calculation: z.literal(calculation), companyId: z.string().min(1), rootRecipeId: z.string().min(1),
  ingredients: z.array(z.object({ itemId: z.string().min(1), unit: z.string().min(1), numerator: natural, denominator: natural })).max(10000) });

/** Recalcula el TOTAL exacto por cantidad vendida y redondea half-up una sola vez por ingrediente. */
export function saleSnapshotDemand(snapshot: SaleRecipeSnapshot, sold: string): SaleIngredientDemand[] {
  if (snapshot.schemaVersion !== 1 || fingerprint(snapshot.definition) !== snapshot.versionKey) throw new Error("Snapshot de receta alterado o desconocido");
  const definition = storedDemand.parse(snapshot.definition);
  if (definition.rootRecipeId !== snapshot.recipeId) throw new Error("Receta de snapshot inconsistente");
  const quantitySold = quantity(soldQuantity(sold), 2, 8);
  const seen = new Set<string>();
  return definition.ingredients.flatMap(row => {
    if (seen.has(row.itemId)) throw new Error("Ingrediente de snapshot duplicado");
    seen.add(row.itemId);
    const amount = multiply(fraction(BigInt(row.numerator), BigInt(row.denominator)), quantitySold);
    const ticks = (amount.n * scale * two + amount.d) / (amount.d * two);
    if (ticks > BigInt("999999999999")) throw new Error("Demanda física fuera de rango");
    return ticks === zero ? [] : [{ itemId: row.itemId, unit: row.unit, quantity: `${ticks / scale}.${String(ticks % scale).padStart(4, "0")}` }];
  });
}
