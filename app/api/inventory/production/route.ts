import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { db } from "@/lib/db";
import { productionOrders, productionResults, productionIngredients, recipes } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { ProductionService } from "@/lib/services/production-service";

const createOrderSchema = z.object({
    recipeId: z.string().min(1),
    plannedQuantity: z.number().int().positive(),
    unit: z.string().default("PORTION"),
    plannedDate: z.string().transform(s => new Date(s)),
    notes: z.string().optional(),
});

const recordProductionSchema = z.object({
    orderId: z.string().optional(),
    recipeId: z.string().min(1),
    producedQuantity: z.number().int().positive(),
    unit: z.string().default("PORTION"),
    notes: z.string().optional(),
    ingredients: z.array(z.object({
        itemId: z.string().min(1),
        batchId: z.string().optional(),
        // A7b: sin `.int()`. Las columnas son `numeric(12,4)` y una receta real
        // pide 0.35 kg; el `.int()` era lo único que seguía prohibiendo
        // capturarlo a mano. `producedQuantity` sí sigue entero: son porciones.
        expectedQuantity: z.number().nonnegative(),
        actualQuantity: z.number().nonnegative(),
        unit: z.string(),
        unitCost: z.number().int().optional(),
        yieldPercent: z.number().int().min(0).max(100).optional(),
    })),
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(role, session.user.branchId, searchParams.get("branchId"));

        if (!branchId) {
            return NextResponse.json({ error: "branchId requerido" }, { status: 400 });
        }

        const orders = await ProductionService.getOrders(session.user.companyId, branchId);
        return NextResponse.json({ success: true, orders });
    } catch (error) {
        console.error("Get production orders error:", error);
        return NextResponse.json({ error: "Error al obtener órdenes" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        const body = await req.json();
        const { action, branchId: requestedBranchId } = body;
        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(role, session.user.branchId, requestedBranchId ?? null);

        if (!branchId) {
            return NextResponse.json({ error: "Selecciona una sucursal para registrar producción" }, { status: 400 });
        }

        if (action === "record") {
            const validated = recordProductionSchema.parse(body);

            const result = await ProductionService.recordProduction({
                companyId: session.user.companyId,
                branchId,
                ...validated,
                recordedBy: session.user.id,
            });

            // A9: `recordProduction` devuelve null cuando el único parcial dice
            // que esa producción ya estaba registrada. Por esta ruta no debería
            // pasar —la captura manual no lleva instancia de workflow y el
            // índice es parcial sobre ella— pero se responde explícito en vez
            // de devolver `result: null` como si hubiera funcionado.
            if (!result) {
                return NextResponse.json({ error: "La producción ya estaba registrada" }, { status: 409 });
            }

            return NextResponse.json({ success: true, result });
        }

        const validated = createOrderSchema.parse(body);
        const order = await ProductionService.createOrder({
            companyId: session.user.companyId,
            branchId,
            recipeId: validated.recipeId,
            plannedQuantity: validated.plannedQuantity,
            unit: validated.unit,
            plannedDate: validated.plannedDate,
            notes: validated.notes,
            createdBy: session.user.id,
        });

        return NextResponse.json({ success: true, order });
    } catch (error) {
        console.error("Create production order error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Datos inválidos", details: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Error al crear orden" }, { status: 500 });
    }
}
