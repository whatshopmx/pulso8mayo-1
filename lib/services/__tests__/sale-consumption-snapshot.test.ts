import { describe, expect, it } from "vitest";
import { buildSaleRecipeSnapshot, saleSnapshotDemand, type SaleRecipeReader } from "../sale-consumption-snapshot";

const companyId = "tenant-a";
function fixture() {
  const recipes = new Map([
    ["dish", { id: "dish", companyId, baseYield: "1.00", unit: "PORTION", items: [{ id: "line-1", itemId: "rice", quantity: "100.0000", unit: "G", isSubRecipe: false, yieldPercent: 100 }] }],
    ["prep", { id: "prep", companyId, baseYield: "3.00", unit: "KG", items: [{ id: "line-2", itemId: "rice", quantity: "1.0000", unit: "KG", isSubRecipe: false, yieldPercent: 100 }] }],
  ]);
  const ingredients = new Map([["rice", { id: "rice", companyId, unit: "KG" }]]);
  const conversions = [{ id: "g-kg", companyId, fromUnit: "G", toUnit: "KG", factor: "0.001000" }];
  const reader: SaleRecipeReader = {
    recipe: async (id, company) => { expect(company).toBe(companyId); return recipes.get(id) ?? null; },
    ingredient: async (id, company) => { expect(company).toBe(companyId); return ingredients.get(id) ?? null; },
    conversions: async (from, to, company) => { expect(company).toBe(companyId); return conversions.filter(c => (c.fromUnit === from && c.toUnit === to) || (c.fromUnit === to && c.toUnit === from)); },
  };
  return { recipes, ingredients, conversions, reader };
}

describe("INV-01.b: snapshot de demanda construido en servidor", () => {
  it("convierte gramos a unidad física y aplica 10→12→8 sin escalar el consumo previo", async () => {
    const f = fixture();
    const snapshot = await buildSaleRecipeSnapshot(companyId, "dish", f.reader);
    for (const [quantity, expected] of [["10", "1.0000"], ["12", "1.2000"], ["8", "0.8000"]]) {
      expect(saleSnapshotDemand(snapshot, quantity)).toEqual([{ itemId: "rice", unit: "KG", quantity: expected }]);
    }
    expect(saleSnapshotDemand(snapshot, "0")).toEqual([]);
  });
  it("congela definición y conversión: editar datos después no cambia el snapshot", async () => {
    const f = fixture();
    const before = await buildSaleRecipeSnapshot(companyId, "dish", f.reader);
    f.recipes.get("dish")!.items[0].quantity = "200.0000";
    f.conversions[0].factor = "0.002000";
    expect(saleSnapshotDemand(before, "10")[0].quantity).toBe("1.0000");
    const after = await buildSaleRecipeSnapshot(companyId, "dish", f.reader);
    expect(after.versionKey).not.toBe(before.versionKey);
    expect(saleSnapshotDemand(after, "10")[0].quantity).toBe("4.0000");
  });
  it("expande subrecetas, convierte su unidad y aplica merma en cada nivel", async () => {
    const f = fixture();
    f.recipes.get("dish")!.items = [{ id: "sub", itemId: "prep", quantity: "1500.0000", unit: "G", isSubRecipe: true, yieldPercent: 50 }];
    f.recipes.get("prep")!.items[0].yieldPercent = 50;
    const snapshot = await buildSaleRecipeSnapshot(companyId, "dish", f.reader);
    expect(saleSnapshotDemand(snapshot, "1")).toEqual([{ itemId: "rice", unit: "KG", quantity: "2.0000" }]);
  });
  it("suma fracciones antes de redondear y conserva la fracción en el snapshot", async () => {
    const f = fixture();
    f.recipes.get("prep")!.items.push({ ...f.recipes.get("prep")!.items[0], id: "third" });
    const snapshot = await buildSaleRecipeSnapshot(companyId, "prep", f.reader);
    expect(saleSnapshotDemand(snapshot, "1")[0].quantity).toBe("0.6667");
    expect(saleSnapshotDemand(snapshot, "3")[0].quantity).toBe("2.0000");
  });
  it("usa conversión inversa exacta", async () => {
    const f = fixture();
    f.conversions[0] = { ...f.conversions[0], fromUnit: "KG", toUnit: "G", factor: "1000.000000" };
    expect(saleSnapshotDemand(await buildSaleRecipeSnapshot(companyId, "dish", f.reader), "1")[0].quantity).toBe("0.1000");
  });
  it("rechaza receta/ingrediente de otra empresa o inexistentes", async () => {
    for (const kind of ["recipe", "ingredient"] as const) {
      const f = fixture();
      if (kind === "recipe") f.recipes.get("dish")!.companyId = "other";
      else f.ingredients.get("rice")!.companyId = "other";
      await expect(buildSaleRecipeSnapshot(companyId, "dish", f.reader)).rejects.toThrow(/empresa/i);
    }
    const f = fixture(); f.ingredients.clear();
    await expect(buildSaleRecipeSnapshot(companyId, "dish", f.reader)).rejects.toThrow();
  });
  it("rechaza ciclos de subrecetas", async () => {
    const f = fixture();
    f.recipes.get("dish")!.items[0] = { ...f.recipes.get("dish")!.items[0], itemId: "dish", isSubRecipe: true };
    await expect(buildSaleRecipeSnapshot(companyId, "dish", f.reader)).rejects.toThrow(/ciclo/i);
  });
  it.each([0, -1, 101, 1.5])("rechaza rendimiento inválido %s", async yieldPercent => {
    const f = fixture(); f.recipes.get("dish")!.items[0].yieldPercent = yieldPercent;
    await expect(buildSaleRecipeSnapshot(companyId, "dish", f.reader)).rejects.toThrow(/rendimiento/i);
  });
  it("bloquea conversión faltante, ambigua o ajena en vez de asumir equivalencia", async () => {
    const missing = fixture(); missing.conversions.length = 0;
    await expect(buildSaleRecipeSnapshot(companyId, "dish", missing.reader)).rejects.toThrow(/conversión/i);
    const ambiguous = fixture(); ambiguous.conversions.push({ ...ambiguous.conversions[0], id: "duplicate" });
    await expect(buildSaleRecipeSnapshot(companyId, "dish", ambiguous.reader)).rejects.toThrow(/conversión/i);
    const foreign = fixture(); foreign.conversions[0].companyId = "other";
    await expect(buildSaleRecipeSnapshot(companyId, "dish", foreign.reader)).rejects.toThrow(/empresa/i);
  });
  it("rechaza base cero y cantidades inválidas sin producir demanda parcial", async () => {
    const f = fixture(); f.recipes.get("dish")!.baseYield = "0";
    await expect(buildSaleRecipeSnapshot(companyId, "dish", f.reader)).rejects.toThrow();
    f.recipes.get("dish")!.baseYield = "1"; f.recipes.get("dish")!.items[0].quantity = "NaN";
    await expect(buildSaleRecipeSnapshot(companyId, "dish", f.reader)).rejects.toThrow();
  });
  it("conserva huella y demanda al reordenar claves como JSONB", async () => {
    const f = fixture();
    const snapshot = await buildSaleRecipeSnapshot(companyId, "dish", f.reader);
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
    const roundTrip = JSON.parse(JSON.stringify(reorder(snapshot)));
    expect(saleSnapshotDemand(roundTrip, "12")).toEqual(saleSnapshotDemand(snapshot, "12"));
    roundTrip.definition.ingredients[0].numerator = "2";
    expect(() => saleSnapshotDemand(roundTrip, "12")).toThrow(/alterado/i);
  });
  it("huella independiente del orden de lectura de ingredientes", async () => {
    const f = fixture();
    const recipe = f.recipes.get("dish")!;
    recipe.items.push({ ...recipe.items[0], id: "earlier", quantity: "200.0000" });
    const first = await buildSaleRecipeSnapshot(companyId, "dish", f.reader);
    recipe.items.reverse();
    expect((await buildSaleRecipeSnapshot(companyId, "dish", f.reader)).versionKey).toBe(first.versionKey);
  });
  it("redondea empates half-up, omite demanda física cero y bloquea desbordamientos", async () => {
    const f = fixture();
    f.recipes.get("dish")!.items[0] = { ...f.recipes.get("dish")!.items[0], quantity: "0.0001", unit: "KG" };
    const snapshot = await buildSaleRecipeSnapshot(companyId, "dish", f.reader);
    expect(saleSnapshotDemand(snapshot, "0.50")[0].quantity).toBe("0.0001");
    expect(saleSnapshotDemand(snapshot, "0.49")).toEqual([]);
    f.recipes.get("dish")!.items[0].quantity = "999999.9999";
    const large = await buildSaleRecipeSnapshot(companyId, "dish", f.reader);
    expect(() => saleSnapshotDemand(large, "99999999.99")).toThrow(/rango/i);
  });
  it("rechaza receta sin ingredientes y conversión no positiva/inconsistente", async () => {
    const empty = fixture(); empty.recipes.get("dish")!.items = [];
    await expect(buildSaleRecipeSnapshot(companyId, "dish", empty.reader)).rejects.toThrow(/sin ingredientes/i);
    const invalid = fixture(); invalid.conversions[0].factor = "0";
    await expect(buildSaleRecipeSnapshot(companyId, "dish", invalid.reader)).rejects.toThrow(/positiva/i);
    const contradictory = fixture(); contradictory.conversions.push({ id: "inverse", companyId, fromUnit: "KG", toUnit: "G", factor: "999.00" });
    await expect(buildSaleRecipeSnapshot(companyId, "dish", contradictory.reader)).rejects.toThrow(/inconsistente/i);
  });
  it("rechaza expansiones demasiado profundas y conversiones inversas nulas", async () => {
    const f = fixture();
    for (let index = 0; index < 35; index++) {
      f.recipes.set(`deep-${index}`, { id: `deep-${index}`, companyId, baseYield: "1", unit: "KG",
        items: [{ id: `line-${index}`, itemId: index === 34 ? "rice" : `deep-${index + 1}`, quantity: "1", unit: "KG", isSubRecipe: index !== 34, yieldPercent: 100 }] });
    }
    await expect(buildSaleRecipeSnapshot(companyId, "deep-0", f.reader)).rejects.toThrow(/límite/i);
    f.conversions[0] = { ...f.conversions[0], fromUnit: "KG", toUnit: "G", factor: "0" };
    await expect(buildSaleRecipeSnapshot(companyId, "dish", f.reader)).rejects.toThrow();
  });
});
