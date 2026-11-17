import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recipes, salesEntries } from "@/lib/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { saleRevenueComplete } from "@/lib/services/sale-revenue-coverage";

type Quadrant = "STAR" | "CASH_COW" | "QUESTION_MARK" | "DOG" | "UNCLASSIFIED";

interface RevenueCoverage {
    status: "NO_DATA" | "PARTIAL" | "COMPLETE";
    totalEntries: number;
    completeEntries: number;
}

interface MenuItemData {
    recipeId: string;
    recipeName: string;
    totalSold: number;
    /** Subtotal conocido de ventas reportadas; no es el total si la cobertura es parcial. */
    reportedRevenueCents: number;
    /** Total firme del período; null cuando la cobertura no es COMPLETE. */
    revenueCents: number | null;
    revenueCoverage: RevenueCoverage;
    costCents: number;
    /** null cuando el ingreso no está completo: no se mide rentabilidad contra subtotal. */
    foodCostPercent: number | null;
    marginPercent: number | null;
    quadrant: Quadrant;
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

        // Ingreso por receta con cobertura canónica. Se leen filas (no un GROUP BY)
        // para poder evaluar `saleRevenueComplete` por entrada: su subconsulta
        // correlacionada no cabe dentro de `count(*) filter (where …)` agrupado.
        const sales = await db.select({
            recipeId: salesEntries.recipeId,
            quantitySold: salesEntries.quantitySold,
            revenue: salesEntries.totalRevenue,
            revenueComplete: saleRevenueComplete,
        })
            .from(salesEntries)
            .where(and(...conditions));

        interface Agg {
            totalSold: number;
            reportedRevenueCents: number;
            totalEntries: number;
            completeEntries: number;
        }
        const salesMap = new Map<string, Agg>();
        for (const s of sales) {
            const a = salesMap.get(s.recipeId) ?? {
                totalSold: 0,
                reportedRevenueCents: 0,
                totalEntries: 0,
                completeEntries: 0,
            };
            a.totalSold += Number(s.quantitySold);
            a.reportedRevenueCents += s.revenue ?? 0;
            a.totalEntries += 1;
            if (s.revenueComplete === true) a.completeEntries += 1;
            salesMap.set(s.recipeId, a);
        }

        const items: MenuItemData[] = recipeList.map(r => {
            const a = salesMap.get(r.id);
            const totalSold = a?.totalSold ?? 0;
            const reportedRevenueCents = a?.reportedRevenueCents ?? 0;
            const totalEntries = a?.totalEntries ?? 0;
            const completeEntries = a?.completeEntries ?? 0;
            const complete = totalEntries > 0 && completeEntries === totalEntries;
            const coverage: RevenueCoverage = {
                status: totalEntries === 0 ? "NO_DATA" : complete ? "COMPLETE" : "PARTIAL",
                totalEntries,
                completeEntries,
            };
            const revenueCents = complete ? reportedRevenueCents : null;
            const costCents = r.calculatedCost ?? 0;
            const foodCostPercent = revenueCents !== null && revenueCents > 0
                ? parseFloat(((costCents * totalSold / revenueCents) * 100).toFixed(1))
                : null;
            const marginPercent = foodCostPercent !== null
                ? parseFloat((100 - foodCostPercent).toFixed(1))
                : null;

            return {
                recipeId: r.id,
                recipeName: r.name,
                totalSold,
                reportedRevenueCents,
                revenueCents,
                revenueCoverage: coverage,
                costCents,
                foodCostPercent,
                marginPercent,
                quadrant: "UNCLASSIFIED" as Quadrant,
            };
        });

        const withSales = items.filter(i => i.totalSold > 0);
        if (withSales.length === 0) {
            return NextResponse.json({
                items: [],
                medianPopularity: 0,
                medianMargin: null,
                period: { start: startDate.toISOString(), end: endDate.toISOString() },
            });
        }

        // Rentabilidad medida sólo con cobertura COMPLETE. El ingreso incompleto
        // queda UNCLASSIFIED y no participa en la mediana de margen: un margen
        // calculado contra subtotal no es una rentabilidad medida.
        const withMargin = withSales.filter(i => i.marginPercent !== null);
        const sortedBySales = [...withSales].sort((a, b) => a.totalSold - b.totalSold);
        const sortedByMargin = [...withMargin].sort((a, b) => (a.marginPercent ?? 0) - (b.marginPercent ?? 0));
        const midSales = Math.floor(sortedBySales.length / 2);
        const medianPopularity = sortedBySales.length > 0
            ? sortedBySales[midSales].totalSold
            : 0;
        const midMargin = Math.floor(sortedByMargin.length / 2);
        const medianMargin = sortedByMargin.length > 0
            ? sortedByMargin[midMargin].marginPercent
            : null;

        const labeled = withSales.map(i => {
            if (i.marginPercent === null || medianMargin === null) {
                return { ...i, quadrant: "UNCLASSIFIED" as Quadrant };
            }
            const highPopularity = i.totalSold >= medianPopularity;
            const highProfit = i.marginPercent >= medianMargin;
            let quadrant: Quadrant;
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
