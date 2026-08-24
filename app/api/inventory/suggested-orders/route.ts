import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { SuggestedOrderService } from "@/lib/services/suggested-order-service";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as { role?: Role }).role ?? "ADMIN";
    const branchId = enforceBranchScope(
      role,
      session.user.branchId,
      req.nextUrl.searchParams.get("branchId")
    );
    if (!branchId) {
      return NextResponse.json(
        { error: "Selecciona una sucursal para calcular sugerencias" },
        { status: 400 }
      );
    }

    const suggestions = await SuggestedOrderService.calculate(
      session.user.companyId || "",
      branchId
    );

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Suggested orders error:", error);
    return NextResponse.json(
      { error: "Failed to calculate suggested orders" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { items, branchId: requestedBranchId } = body as {
      items: Array<{ itemId: string; suggestedQty: number }>;
      branchId?: string;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    const role = (session.user as { role?: Role }).role ?? "ADMIN";
    const branchId = enforceBranchScope(role, session.user.branchId, requestedBranchId ?? null);
    if (!branchId) {
      return NextResponse.json(
        { error: "Selecciona una sucursal para generar órdenes de compra" },
        { status: 400 }
      );
    }

    const orders = await SuggestedOrderService.generatePurchaseOrders(
      session.user.companyId || "",
      branchId,
      items,
      session.user.id
    );

    return NextResponse.json({ orders, count: orders.length });
  } catch (error) {
    console.error("Generate POs from suggested orders error:", error);
    return NextResponse.json(
      { error: "Failed to generate purchase orders" },
      { status: 500 }
    );
  }
}
