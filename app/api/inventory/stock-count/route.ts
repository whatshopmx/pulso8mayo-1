import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { StockCountService } from "@/lib/services/stock-count-service";

export async function POST(request: NextRequest) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { branchId, category, highValueOnly } = body;

        if (!branchId || !category) {
            return NextResponse.json({ error: "branchId and category required" }, { status: 400 });
        }

        const result = await StockCountService.createStockCountInstance({
            companyId: session.user.companyId || "",
            branchId,
            assigneeId: session.user.id,
            categoryValue: category,
            highOnlyValue: highValueOnly !== false, // Fase 4
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error("Stock count init error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");

    const history = await StockCountService.getStockCountHistory(
        session.user.companyId || "",
        branchId || undefined
    );

    return NextResponse.json(history);
}