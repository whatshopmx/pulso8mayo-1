import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { salesEntries, recipes } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { assertBranchOfCompany, resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import { TheoreticalConsumptionService } from "@/lib/services/theoretical-consumption-service";

/**
 * Registro manual de ventas por receta.
 *
 * La versión anterior comprobaba sesión, pero aceptaba `branchId` y `recipeId`
 * del cuerpo sin verificar que fueran de la empresa ni que el rol pudiera
 * registrar ventas; el consumo (`TheoreticalConsumptionService.consume`) busca
 * la receta por ID, así que un `recipeId` ajeno descontaba insumos de otra
 * empresa y una sucursal ajena ensuciaba su venta. Además, el actor no pasaba
 * por un guard de permiso.
 *
 * Ahora, antes de la primera escritura:
 * 1. El rol necesita `inventory:manage` (misma regla que la importación bulk).
 * 2. La sucursal se resuelve con `resolveBranchScope` — a un rol de sucursal no
 *    se le concede otra; se rechaza en vez de reescribirla en silencio.
 * 3. `assertBranchOfCompany` exige que la sucursal sea de la empresa.
 * 4. Todas las recetas deben pertenecer a la empresa.
 */

const salesSchema = z.object({
    branchId: z.string().uuid().optional(),
    sales: z.array(z.object({
        recipeId: z.string().uuid(),
        quantitySold: z.number().positive(),
        totalRevenue: z.number().nonnegative().optional(),
    })).min(1),
    saleDate: z.string().optional(),
});

function errorResponse(error: unknown) {
    if (isApiError(error)) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
    }
    return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to record sales" },
        { status: 500 }
    );
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session.user.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const role = ((session.user as { role?: Role }).role ?? "EMPLEADO");
        if (!hasPermission(role, "inventory", "manage")) {
            return NextResponse.json(
                { error: "No tienes permisos para registrar ventas" },
                { status: 403 }
            );
        }

        const body = await req.json();
        const validated = salesSchema.parse(body);

        const scope = resolveBranchScope(role, session.user.branchId, validated.branchId ?? null);

        let targetBranchId: string;
        if (scope.kind === "BRANCH") {
            if (validated.branchId && validated.branchId !== scope.branchId) {
                throw ApiError.forbidden("No puedes registrar ventas de otra sucursal.");
            }
            targetBranchId = scope.branchId;
        } else if (scope.kind === "ALL") {
            if (!validated.branchId) {
                throw ApiError.badRequest("Selecciona una sucursal para registrar ventas.");
            }
            targetBranchId = validated.branchId;
        } else {
            throw ApiError.forbidden(
                "Tu usuario no tiene una sucursal asignada, así que no puede registrar ventas."
            );
        }

        // Frontera de tenant: la sucursal debe ser de esta empresa.
        await assertBranchOfCompany(session.user.companyId, targetBranchId);

        // Todas las recetas deben ser de la empresa: si alguna es ajena, se
        // rechaza el lote completo antes de insertar la primera venta o
        // descontar el primer insumo.
        const recipeIds = Array.from(new Set(validated.sales.map((s) => s.recipeId)));
        const ownedRecipes = await db
            .select({ id: recipes.id })
            .from(recipes)
            .where(and(eq(recipes.companyId, session.user.companyId), inArray(recipes.id, recipeIds)));
        const owned = new Set(ownedRecipes.map((r) => r.id));
        const missing = recipeIds.filter((id) => !owned.has(id));
        if (missing.length > 0) {
            throw ApiError.badRequest(
                "Una o más recetas no pertenecen a esta empresa. Recarga el catálogo e inténtalo de nuevo."
            );
        }

        const saleDate = validated.saleDate ? new Date(validated.saleDate) : new Date();

        for (const sale of validated.sales) {
            const revenueCents = sale.totalRevenue ? Math.round(sale.totalRevenue * 100) : 0;

            await db.insert(salesEntries).values({
                companyId: session.user.companyId,
                branchId: targetBranchId,
                recipeId: sale.recipeId,
                quantitySold: sale.quantitySold.toFixed(2),
                saleDate,
                totalRevenue: revenueCents,
            });

            await TheoreticalConsumptionService.consume({
                companyId: session.user.companyId,
                branchId: targetBranchId,
                recipeId: sale.recipeId,
                quantitySold: sale.quantitySold,
                saleDate,
                userId: session.user.id,
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Sales entry error:", error);
        return errorResponse(error);
    }
}

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session.user.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const role = ((session.user as { role?: Role }).role ?? "EMPLEADO");
        const requested = req.nextUrl.searchParams.get("branchId");
        const scope = resolveBranchScope(role, session.user.branchId, requested);

        if (scope.kind === "NONE") {
            return NextResponse.json([]);
        }

        const conditions = [eq(salesEntries.companyId, session.user.companyId)];
        if (scope.kind === "BRANCH") {
            conditions.push(eq(salesEntries.branchId, scope.branchId));
        }

        const list = await db
            .select()
            .from(salesEntries)
            .where(and(...conditions));

        return NextResponse.json(list);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch sales entries" }, { status: 500 });
    }
}
