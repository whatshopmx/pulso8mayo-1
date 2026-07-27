import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { SuggestedOrderService } from "@/lib/services/suggested-order-service";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id || !session?.user?.branchId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const suggestions = await SuggestedOrderService.calculate(
      session.user.companyId || "",
      session.user.branchId
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
    if (!session?.user?.id || !session?.user?.branchId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { items } = body as { items: Array<{ itemId: string; suggestedQty: number }> };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    const orders = await SuggestedOrderService.generatePurchaseOrders(
      session.user.companyId || "",
      session.user.branchId,
      items
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
