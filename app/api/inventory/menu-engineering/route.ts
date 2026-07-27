import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recipes, salesEntries } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";

interface MenuItemData {
    recipeId: string;
    recipeName: string;
    totalSold: number;
    revenueCents: number;
    costCents: number;
    foodCostPercent: number;
    marginPercent: number;
    quadrant: "STAR" | "CASH_COW" | "QUESTION_MARK" | "DOG";
}

export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, 'inventory', 'read')) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        if (!tenant.id) {
            return NextResponse.json({ error: "Usuario no asignado a una empresa" }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const branchId = searchParams.get("branchId");
        const startParam = searchParams.get("startDate");
        const endParam = searchParams.get("endDate");

        const endDate = endParam ? new Date(endParam) : new Date();
        const startDate = startParam
            ? new Date(startParam)
            : new Date(endDate.getTime() - 30 * 86400000);

        const recipeList = await db.select()
            .from(recipes)
            .where(eq(recipes.companyId, tenant.id));

        const conditions = [
            eq(salesEntries.companyId, tenant.id),
            gte(salesEntries.saleDate, startDate),
            lte(salesEntries.saleDate, endDate),
        ];
        if (branchId) conditions.push(eq(salesEntries.branchId, branchId));

        const salesAgg = await db.select({
            recipeId: salesEntries.recipeId,
            totalSold: sql<number>`sum(${salesEntries.quantitySold}::numeric)`,
            totalRevenue: sql<number>`sum(${salesEntries.totalRevenue})`,
        })
            .from(salesEntries)
            .where(and(...conditions))
            .groupBy(salesEntries.recipeId);

        const salesMap = new Map(salesAgg.map(s => [s.recipeId, {
            totalSold: Number(s.totalSold || 0),
            revenueCents: Number(s.totalRevenue || 0),
        }]));

        const items: MenuItemData[] = recipeList.map(r => {
            const sales = salesMap.get(r.id);
            const totalSold = sales?.totalSold ?? 0;
            const revenueCents = sales?.revenueCents ?? 0;
            const costCents = r.calculatedCost ?? 0;
            const foodCostPercent = revenueCents > 0
                ? parseFloat(((costCents * totalSold / revenueCents) * 100).toFixed(1))
                : parseFloat(r.foodCostPercentage || "0");
            const marginPercent = parseFloat((100 - foodCostPercent).toFixed(1));

            return { recipeId: r.id, recipeName: r.name, totalSold, revenueCents, costCents, foodCostPercent, marginPercent, quadrant: "DOG" as const };
        });

        const itemsWithSales = items.filter(i => i.totalSold > 0);
        if (itemsWithSales.length === 0) {
            return NextResponse.json({ items: [], medianPopularity: 0, medianMargin: 0 });
        }

        const sortedBySales = [...itemsWithSales].sort((a, b) => a.totalSold - b.totalSold);
        const sortedByMargin = [...itemsWithSales].sort((a, b) => a.marginPercent - b.marginPercent);
        const mid = Math.floor(sortedBySales.length / 2);
        const medianPopularity = sortedBySales.length > 0
            ? sortedBySales[mid].totalSold
            : 0;
        const medianMargin = sortedByMargin.length > 0
            ? sortedByMargin[mid].marginPercent
            : 50;

        const labeled = itemsWithSales.map(i => {
            const highPopularity = i.totalSold >= medianPopularity;
            const highProfit = i.marginPercent >= medianMargin;
            let quadrant: MenuItemData["quadrant"];
            if (highProfit && highPopularity) quadrant = "STAR";
            else if (highProfit && !highPopularity) quadrant = "CASH_COW";
            else if (!highProfit && highPopularity) quadrant = "QUESTION_MARK";
            else quadrant = "DOG";
            return { ...i, quadrant };
        });

        return NextResponse.json({
            items: labeled,
            medianPopularity,
            medianMargin,
            period: { start: startDate.toISOString(), end: endDate.toISOString() },
        });
    } catch (error) {
        console.error("[MenuEngineering] Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
