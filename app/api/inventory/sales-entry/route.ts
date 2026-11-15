import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { salesEntries } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { assertBranchOfCompany, resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import { SalesIngestService } from "@/lib/services/sales-ingest-service";
import { SaleConsumptionError } from "@/lib/services/sale-consumption-service";
import { soldQuantity } from "@/lib/services/sale-consumption-contract";
import { normalizeDay } from "@/lib/services/sales-ingest-pure";

/**
 * Registro manual de ventas por receta.
 *
 * Permiso y alcance antes de escribir; catálogo, venta y stock se verifican
 * en la misma transacción del writer. La captura representa el total de una
 * receta/día del origen manual: repetir conserva, corregir reemplaza, cero anula.
 */

const salesSchema = z.object({
    branchId: z.string().uuid().optional(),
    sales: z.array(z.object({
        recipeId: z.string().uuid(),
        quantitySold: z.number().nonnegative().refine(value => {
            try { soldQuantity(String(value)); return true; } catch { return false; }
        }, "Cantidad fuera de rango o con más de dos decimales"),
        totalRevenue: z.number().nonnegative().max(21474836.47)
            .refine(value => /^\d+(?:\.\d{1,2})?$/.test(String(value)), "Ingreso con hasta dos decimales requerido")
            .nullable().optional(),
    })).min(1),
    saleDate: z.string().refine(value => normalizeDay(value) !== null, "Fecha de venta inválida").optional(),
});

function errorResponse(error: unknown) {
    if (error instanceof SaleConsumptionError) {
        const status = error.code === "INVALID_INPUT" ? 400 : error.code === "INVALID_SCOPE" ? 403 : 409;
        return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
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

        const saleDay = validated.saleDate ? normalizeDay(validated.saleDate)! : new Date().toISOString().slice(0, 10);
        const result = await SalesIngestService.ingest({
            companyId: session.user.companyId, branchId: targetBranchId, userId: session.user.id,
            source: "manual:recipe", atomic: true,
            rows: validated.sales.map((sale, index) => {
                const money = sale.totalRevenue == null ? null : String(sale.totalRevenue).split(".");
                return { rowNumber: index + 1, recipeRef: sale.recipeId, productKey: sale.recipeId.toLowerCase(),
                    quantitySold: sale.quantitySold, saleDay,
                    totalRevenueCents: money === null ? null : Number(money[0] + (money[1] ?? "").padEnd(2, "0")) };
            }),
        });
        return NextResponse.json({ success: true, ...result });
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
    } catch {
        return NextResponse.json({ error: "Failed to fetch sales entries" }, { status: 500 });
    }
}
