import 'dotenv/config';
import { db } from '@/lib/db';
import { companies, recipes, recipeItems, inventoryItems } from '@/lib/db/schema';
import { eq, asc, isNotNull, and } from 'drizzle-orm';
import { RecipeService } from '@/lib/services/recipe-service';

/**
 * One-off demo seed for the recipes module (tasks/recipes T5 parity harness).
 *
 * Creates 6 demo recipes in the demo tenant using existing inventory items,
 * structured to exercise the costing engine: leaf recipes, one-level nesting,
 * diamond sub-recipe graphs (R4 -> R3 -> R1 & R4 -> R1) and baseYield != 1.
 * Then calculates costs with the CURRENT engine so the results can be used
 * as the parity baseline (scripts/compare-recipe-costs.ts --snapshot).
 *
 * Safety: aborts if the tenant already has recipes.
 * Reversible: DELETE FROM recipes WHERE company_id = <demo tenant>.
 */

const DEMO_RECIPES = [
    {
        key: 'R1', name: 'Salsa Roja Base (Demo)', baseYield: '1.00', priceSelling: 0,
        lines: [
            { itemIdx: 0, quantity: '0.2000' },
            { itemIdx: 1, quantity: '0.1000' },
            { itemIdx: 2, quantity: '0.0500' },
        ],
    },
    {
        key: 'R2', name: 'Caldo de Pollo Base (Demo)', baseYield: '2.00', priceSelling: 0,
        lines: [
            { itemIdx: 3, quantity: '0.5000' },
            { itemIdx: 4, quantity: '0.3000' },
        ],
    },
    {
        key: 'R3', name: 'Sopa Azteca (Demo)', baseYield: '1.00', priceSelling: 8900,
        lines: [
            { itemIdx: 5, quantity: '0.1500' },
            { sub: 'R1', quantity: '0.4000' },
        ],
    },
    {
        key: 'R4', name: 'Enchiladas (Demo)', baseYield: '1.00', priceSelling: 12500,
        lines: [
            { itemIdx: 6, quantity: '0.2000' },
            { sub: 'R1', quantity: '0.3000' },
            { sub: 'R3', quantity: '0.5000' },
        ],
    },
    {
        key: 'R5', name: 'Pollo en Caldo (Demo)', baseYield: '1.00', priceSelling: 11000,
        lines: [
            { itemIdx: 7, quantity: '0.3500' },
            { sub: 'R2', quantity: '0.8000' },
        ],
    },
    {
        key: 'R6', name: 'Combo Degustación (Demo)', baseYield: '1.00', priceSelling: 25000,
        lines: [
            { sub: 'R4', quantity: '1.0000' },
            { sub: 'R5', quantity: '1.0000' },
        ],
    },
] as const;

async function main() {
    // Resolve demo tenant (fall back to first company)
    const allCompanies = await db.select().from(companies).orderBy(asc(companies.name));
    if (allCompanies.length === 0) {
        console.error('no companies found; run the base seeds first');
        process.exit(1);
    }
    const company = allCompanies.find((c) => c.name.includes('Demo')) ?? allCompanies[0];
    console.log(`tenant: ${company.name} (${company.id})`);

    // Safety guard: never run over existing recipes
    const existing = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.companyId, company.id));
    if (existing.length > 0) {
        console.error(`tenant already has ${existing.length} recipes; aborting (reversible seed only runs on empty state)`);
        process.exit(1);
    }

    // Prefer items with a real cost so the baseline exercises non-zero math
    const costed = await db
        .select()
        .from(inventoryItems)
        .where(and(eq(inventoryItems.companyId, company.id), isNotNull(inventoryItems.lastCost)))
        .orderBy(asc(inventoryItems.name));
    const fallback = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.companyId, company.id))
        .orderBy(asc(inventoryItems.name));
    const items = costed.length >= 8 ? costed : fallback;
    if (items.length < 8) {
        console.error(`need at least 8 inventory items, found ${items.length}`);
        process.exit(1);
    }
    console.log(`using ${items.length} inventory items (${costed.length} with lastCost)`);

    // Insert headers first (need ids for sub-recipe lines)
    const idsByKey = new Map<string, string>();
    for (const def of DEMO_RECIPES) {
        const [row] = await db
            .insert(recipes)
            .values({
                companyId: company.id,
                name: def.name,
                baseYield: def.baseYield,
                priceSelling: def.priceSelling,
            })
            .returning({ id: recipes.id });
        idsByKey.set(def.key, row.id);
    }

    // Then lines
    let lineCount = 0;
    for (const def of DEMO_RECIPES) {
        const recipeId = idsByKey.get(def.key)!;
        for (const line of def.lines) {
            const isSub = 'sub' in line;
            const itemId = isSub ? idsByKey.get(line.sub)! : items[line.itemIdx].id;
            await db.insert(recipeItems).values({
                recipeId,
                itemId,
                quantity: line.quantity,
                unit: isSub ? 'PORTION' : (items[(line as { itemIdx: number }).itemIdx].unit ?? 'KG'),
                isSubRecipe: isSub,
            });
            lineCount++;
        }
    }
    console.log(`inserted ${DEMO_RECIPES.length} recipes, ${lineCount} lines`);

    // Calculate costs with the CURRENT engine (pre-T5) to produce baseline values
    for (const def of DEMO_RECIPES) {
        const id = idsByKey.get(def.key)!;
        const cost = await RecipeService.calculateRecipeCost(id, 'LAST_COST');
        console.log(`  ${def.key} ${def.name}: ${cost} cents`);
    }

    console.log('demo recipes seeded and costed');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
