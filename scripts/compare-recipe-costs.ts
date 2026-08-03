import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '@/lib/db';
import { recipes, recipeItems } from '@/lib/db/schema';
import { RecipeService } from '@/lib/services/recipe-service';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Parity harness for the T5 recipe-costing engine refactor (tasks/recipes).
 *
 *   --snapshot  Read stored recipe costs + a reference cost-change simulation
 *               from the current DB and save them to a baseline JSON.
 *   --verify    Re-run the same simulation and recalculate every recipe with
 *               the current engine; diff against the baseline.
 *               Exit code 1 on any mismatch.
 *
 * Baseline file: tasks/recipes/cost-baseline.json
 * Run from repo root: npx tsx scripts/compare-recipe-costs.ts --snapshot
 */

const BASELINE_PATH = path.join(process.cwd(), 'tasks', 'recipes', 'cost-baseline.json');
const SIM_PCT = 0.10; // +10% reference simulation

interface RecipeBaseline {
    id: string;
    name: string;
    calculatedCost: number;
    foodCostPercentage: string;
    priceSelling: number;
}

interface SimResultBaseline {
    recipeId: string;
    currentCostCents: number;
    simulatedCostCents: number;
    simulatedFoodCostPct: string;
}

interface CompanyBaseline {
    companyId: string;
    recipes: RecipeBaseline[];
    simulationItemId: string | null;
    simulation: SimResultBaseline[];
}

interface Baseline {
    capturedAt: string;
    percentageChange: number;
    companies: CompanyBaseline[];
}

async function getCompanyIdsWithRecipes(): Promise<string[]> {
    const rows = await db.selectDistinct({ companyId: recipes.companyId }).from(recipes);
    return rows.map((r) => r.companyId).sort();
}

/** Deterministic pick: the inventory item with the most recipe lines in the tenant. */
async function pickSimulationItem(companyId: string): Promise<string | null> {
    const rows = await db
        .select({ itemId: recipeItems.itemId, uses: sql<number>`count(*)::int` })
        .from(recipeItems)
        .innerJoin(recipes, eq(recipeItems.recipeId, recipes.id))
        .where(and(eq(recipes.companyId, companyId), eq(recipeItems.isSubRecipe, false)))
        .groupBy(recipeItems.itemId);

    if (rows.length === 0) return null;
    rows.sort((a, b) => b.uses - a.uses || a.itemId.localeCompare(b.itemId));
    return rows[0].itemId;
}

function toSimBaseline(results: Awaited<ReturnType<typeof RecipeService.simulateIngredientCostChange>>): SimResultBaseline[] {
    return results
        .map((r) => ({
            recipeId: r.recipeId,
            currentCostCents: r.currentCostCents,
            simulatedCostCents: r.simulatedCostCents,
            simulatedFoodCostPct: r.simulatedFoodCostPct,
        }))
        .sort((a, b) => a.recipeId.localeCompare(b.recipeId));
}

async function captureCompany(companyId: string): Promise<CompanyBaseline> {
    const recipeRows = await db
        .select({
            id: recipes.id,
            name: recipes.name,
            calculatedCost: recipes.calculatedCost,
            foodCostPercentage: recipes.foodCostPercentage,
            priceSelling: recipes.priceSelling,
        })
        .from(recipes)
        .where(eq(recipes.companyId, companyId));
    recipeRows.sort((a, b) => a.id.localeCompare(b.id));

    const itemId = await pickSimulationItem(companyId);
    let simulation: SimResultBaseline[] = [];
    if (itemId) {
        const started = Date.now();
        const results = await RecipeService.simulateIngredientCostChange(companyId, itemId, SIM_PCT);
        console.log(`  simulation (item ${itemId}): ${results.length} recipes in ${Date.now() - started}ms`);
        simulation = toSimBaseline(results);
    } else {
        console.log('  no direct-ingredient lines found; simulation skipped');
    }

    return { companyId, recipes: recipeRows, simulationItemId: itemId, simulation };
}

async function verifyCompany(base: CompanyBaseline, percentageChange: number): Promise<string[]> {
    const diffs: string[] = [];

    // 0. Recipe-set drift check (if the set changed, the rest is noise)
    const nowIds = (await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.companyId, base.companyId)))
        .map((r) => r.id)
        .sort();
    const baseIds = base.recipes.map((r) => r.id).sort();
    if (JSON.stringify(nowIds) !== JSON.stringify(baseIds)) {
        diffs.push(`recipe set changed since baseline (${baseIds.length} -> ${nowIds.length})`);
        return diffs;
    }

    // 1. Simulation parity (stored costs are still untouched at this point)
    if (base.simulationItemId) {
        const started = Date.now();
        const results = await RecipeService.simulateIngredientCostChange(base.companyId, base.simulationItemId, percentageChange);
        console.log(`  simulation re-run: ${results.length} recipes in ${Date.now() - started}ms`);
        const current = toSimBaseline(results);

        if (current.length !== base.simulation.length) {
            diffs.push(`simulation result count ${base.simulation.length} -> ${current.length}`);
        } else {
            for (let i = 0; i < current.length; i++) {
                const a = base.simulation[i];
                const b = current[i];
                if (
                    a.recipeId !== b.recipeId ||
                    a.currentCostCents !== b.currentCostCents ||
                    a.simulatedCostCents !== b.simulatedCostCents ||
                    a.simulatedFoodCostPct !== b.simulatedFoodCostPct
                ) {
                    diffs.push(`simulation ${a.recipeId}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
                }
            }
        }
    }

    // 2. Recalculation parity: run the engine per recipe, compare the returned
    //    cost and the persisted foodCostPercentage against the baseline.
    for (const r of base.recipes) {
        const fresh = await RecipeService.calculateRecipeCost(r.id, 'LAST_COST');
        if (fresh !== r.calculatedCost) {
            diffs.push(`recipe "${r.name}" (${r.id}): cost ${r.calculatedCost} -> ${fresh}`);
        }
        const [row] = await db
            .select({ foodCostPercentage: recipes.foodCostPercentage })
            .from(recipes)
            .where(eq(recipes.id, r.id));
        if (row && row.foodCostPercentage !== r.foodCostPercentage) {
            diffs.push(`recipe "${r.name}" (${r.id}): foodCostPct ${r.foodCostPercentage} -> ${row.foodCostPercentage}`);
        }
    }

    return diffs;
}

async function main() {
    const mode = process.argv[2];

    if (mode === '--snapshot') {
        const companies = await getCompanyIdsWithRecipes();
        const baseline: Baseline = {
            capturedAt: new Date().toISOString(),
            percentageChange: SIM_PCT,
            companies: [],
        };
        for (const companyId of companies) {
            console.log(`snapshot company ${companyId}`);
            baseline.companies.push(await captureCompany(companyId));
        }
        fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
        const total = baseline.companies.reduce((n, c) => n + c.recipes.length, 0);
        console.log(`baseline written: ${BASELINE_PATH} (${total} recipes, ${companies.length} companies)`);
        return;
    }

    if (mode === '--verify') {
        if (!fs.existsSync(BASELINE_PATH)) {
            console.error(`no baseline at ${BASELINE_PATH}; run --snapshot first`);
            process.exit(1);
        }
        const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
        let failures = 0;
        for (const companyBase of baseline.companies) {
            console.log(`verify company ${companyBase.companyId}`);
            const diffs = await verifyCompany(companyBase, baseline.percentageChange ?? SIM_PCT);
            for (const d of diffs) console.error(`  DIFF: ${d}`);
            failures += diffs.length;
        }
        if (failures > 0) {
            console.error(`PARITY FAILED: ${failures} diff(s)`);
            process.exit(1);
        }
        console.log('PARITY OK');
        return;
    }

    console.error('usage: npx tsx scripts/compare-recipe-costs.ts [--snapshot|--verify]');
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
