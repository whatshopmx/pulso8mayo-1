import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { StockCountService } from "@/lib/services/stock-count-service";
import { requireExecutionAccess, assertBranchDestino } from '@/lib/workflows/execution-access';
import { isApiError } from '@/lib/api/error';
import { z } from 'zod';

const createSchema = z.object({ branchId: z.string().min(1), category: z.string().min(1).optional(), categories: z.array(z.string().min(1)).min(1).optional(), highValueOnly: z.boolean().optional(), initialValues: z.record(z.string(), z.unknown()).optional() });

export async function POST(request: NextRequest) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { branchId, category, categories, highValueOnly, initialValues } = createSchema.parse(body);

        if (!category && !categories?.length) {
            return NextResponse.json({ error: "branchId and category required" }, { status: 400 });
        }

        const actor = await requireExecutionAccess('create');
        await assertBranchDestino(actor, branchId);
        const result = await StockCountService.createStockCountInstance({
            companyId: actor.companyId,
            branchId,
            assigneeId: session.user.id,
            categoryValue: category,
            categories,
            highOnlyValue: highValueOnly === true,
            initialValues,
        });

        return NextResponse.json(result);
    } catch (error: unknown) {
        console.error("Stock count init error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo iniciar el conteo' }, { status: isApiError(error) ? error.statusCode : error instanceof z.ZodError ? 400 : 500 });
    }
}

export async function GET(request: NextRequest) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await requireExecutionAccess('read');
        const requestedBranch = new URL(request.url).searchParams.get('branchId');
        const companyScope = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'READONLY'].includes(actor.role);
        const branchId = requestedBranch || (!companyScope ? actor.branchId : null);
        if (!companyScope && !branchId) return NextResponse.json([]);
        if (branchId) await assertBranchDestino(actor, branchId);
        const history = await StockCountService.getStockCountHistory(actor.companyId, branchId || undefined);
        return NextResponse.json(actor.role === 'EMPLEADO' ? history.filter(row => row.assigneeId === actor.userId || (!row.assigneeId && row.branchId === actor.branchId)) : history);
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cargar el historial' }, { status: isApiError(error) ? error.statusCode : 500 });
    }
}
