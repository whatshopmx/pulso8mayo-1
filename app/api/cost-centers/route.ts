import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { costCenters } from "@/lib/db/schema";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission, roleIsAtLeast } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";

const createCostCenterSchema = z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(1).max(120),
    accountingLine: z.string().max(40).nullable().optional(),
});

/** GET /api/cost-centers — catálogo del tenant (?includeInactive=1 para todo). */
export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "read")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "1";
        const conditions = [eq(costCenters.companyId, tenant.id!)];
        if (!includeInactive) conditions.push(eq(costCenters.active, true));

        const centers = await db
            .select()
            .from(costCenters)
            .where(and(...conditions))
            .orderBy(asc(costCenters.code));

        return NextResponse.json({ costCenters: centers });
    } catch (error: unknown) {
        console.error("Failed to list cost centers", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

/** POST /api/cost-centers — crea centro de costo (ADMIN+). Código único por empresa. */
export async function POST(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!roleIsAtLeast(user.role, "ADMIN")) {
            return NextResponse.json(
                { error: "Solo ADMIN o rol superior puede crear centros de costo" },
                { status: 403 },
            );
        }

        const data = createCostCenterSchema.parse(await req.json());
        const [center] = await db
            .insert(costCenters)
            .values({
                companyId: tenant.id!,
                code: data.code.trim().toUpperCase(),
                name: data.name,
                accountingLine: data.accountingLine ?? null,
            })
            .returning();

        return NextResponse.json({ costCenter: center }, { status: 201 });
    } catch (error: unknown) {
        console.error("Failed to create cost center", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 },
            );
        }
        if (typeof error === "object" && error !== null && (error as { code?: string }).code === "23505") {
            return NextResponse.json(
                { error: "Ya existe un centro de costo con ese código" },
                { status: 409 },
            );
        }
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
