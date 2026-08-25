import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { branchBudgets, branches, costCenters } from "@/lib/db/schema";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission, roleIsAtLeast } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import {
    computeBudgetStatus,
    getCommittedByPair,
} from "@/lib/services/budget-service";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const putSchema = z.object({
    branchId: z.string().uuid(),
    costCenterId: z.string().uuid(),
    month: z.string().regex(MONTH_PATTERN, "Formato de mes inválido (YYYY-MM)"),
    amount: z.number().int().min(0), // centavos
});

async function assertOwnership(
    companyId: string,
    branchId: string,
    costCenterId?: string,
): Promise<void> {
    const [branch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
        .limit(1);
    if (!branch) throw new Error("La sucursal no pertenece a la empresa");
    if (costCenterId) {
        const [cc] = await db
            .select({ id: costCenters.id })
            .from(costCenters)
            .where(and(eq(costCenters.id, costCenterId), eq(costCenters.companyId, companyId)))
            .limit(1);
        if (!cc) throw new Error("El centro de costo no pertenece a la empresa");
    }
}

/**
 * GET /api/budgets?month=YYYY-MM&branchId=...
 * Grid mensual: todas las sucursales del alcance × centros de costo activos,
 * con presupuesto capturado, comprometido (OC/OS que comprometen) y disponible.
 */
export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "read")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
        if (!MONTH_PATTERN.test(month)) {
            return NextResponse.json({ error: "Formato de mes inválido (YYYY-MM)" }, { status: 400 });
        }

        // Alcance de sucursal del tenant manda; si no hay, filtro opcional o toda la empresa.
        const requestedBranch = searchParams.get("branchId");
        const branchFilter = tenant.branchId ?? requestedBranch ?? null;

        const branchConditions = [eq(branches.companyId, tenant.id!), eq(branches.active, true)];
        if (branchFilter) branchConditions.push(eq(branches.id, branchFilter));
        const [branchRows, ccRows] = await Promise.all([
            db
                .select({ id: branches.id, name: branches.name, code: branches.code })
                .from(branches)
                .where(and(...branchConditions))
                .orderBy(asc(branches.name)),
            db
                .select()
                .from(costCenters)
                .where(and(eq(costCenters.companyId, tenant.id!), eq(costCenters.active, true)))
                .orderBy(asc(costCenters.code)),
        ]);
        if (branchRows.length === 0 || ccRows.length === 0) {
            return NextResponse.json({ month, rows: [] });
        }

        const [budgetRows, committedByPair] = await Promise.all([
            db
                .select({
                    branchId: branchBudgets.branchId,
                    costCenterId: branchBudgets.costCenterId,
                    amount: branchBudgets.amount,
                })
                .from(branchBudgets)
                .where(and(inArray(branchBudgets.branchId, branchRows.map((b) => b.id)), eq(branchBudgets.month, month))),
            getCommittedByPair(
                branchRows.map((b) => b.id),
                month,
            ),
        ]);
        const budgetByKey = new Map(budgetRows.map((r) => [`${r.branchId}:${r.costCenterId}`, r.amount]));

        const rows = branchRows.flatMap((b) =>
            ccRows.map((cc) => {
                const key = `${b.id}:${cc.id}`;
                const budgeted = budgetByKey.get(key) ?? null;
                const committed = committedByPair.get(key) ?? 0;
                const status = computeBudgetStatus(budgeted, [committed]);
                return {
                    branchId: b.id,
                    branchName: b.name,
                    branchCode: b.code,
                    costCenterId: cc.id,
                    costCenterCode: cc.code,
                    costCenterName: cc.name,
                    accountingLine: cc.accountingLine,
                    ...status,
                    // ≥90% consumido → alerta visual (Task 9)
                    alert: status.budgeted > 0 && status.committed >= status.budgeted * 0.9,
                };
            }),
        );

        return NextResponse.json({ month, rows });
    } catch (error: unknown) {
        console.error("Failed to list budgets", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

/** PUT /api/budgets — captura/upsert de presupuesto por sucursal×centro×mes (ADMIN+). */
export async function PUT(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!roleIsAtLeast(user.role, "ADMIN")) {
            return NextResponse.json(
                { error: "Solo ADMIN o rol superior puede capturar presupuestos" },
                { status: 403 },
            );
        }

        const data = putSchema.parse(await req.json());
        await assertOwnership(tenant.id!, data.branchId, data.costCenterId);

        const [row] = await db
            .insert(branchBudgets)
            .values({
                branchId: data.branchId,
                costCenterId: data.costCenterId,
                month: data.month,
                amount: data.amount,
            })
            .onConflictDoUpdate({
                target: [branchBudgets.branchId, branchBudgets.costCenterId, branchBudgets.month],
                set: { amount: data.amount, updatedAt: new Date() },
            })
            .returning();

        return NextResponse.json({ budget: row });
    } catch (error: unknown) {
        console.error("Failed to save budget", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 },
            );
        }
        if (error instanceof Error && /pertenece a la empresa/.test(error.message)) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
