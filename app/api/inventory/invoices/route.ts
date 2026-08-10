import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices, suppliers, purchaseOrders } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { InvoiceMatchingService } from "@/lib/services/invoice-matching-service";

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");

        if (id) {
            // Get single invoice detail (incl. 3-way/2-way match + candidates)
            const detail = await InvoiceMatchingService.getInvoiceDetail(id, session.user.companyId);

            if (!detail) {
                return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
            }

            return NextResponse.json({ success: true, ...detail });
        }

        // Get list of invoices
        const list = await db.select({
            id: invoices.id,
            uuid: invoices.uuid,
            folio: invoices.folio,
            serie: invoices.serie,
            fecha: invoices.fecha,
            total: invoices.total,
            subtotal: invoices.subtotal,
            currency: invoices.currency,
            matchStatus: invoices.matchStatus,
            supplierId: invoices.supplierId,
            supplierName: suppliers.name,
            poNumber: purchaseOrders.poNumber,
            receivingReportId: invoices.receivingReportId,
        })
        .from(invoices)
        .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
        .leftJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
        .where(eq(invoices.companyId, session.user.companyId))
        .orderBy(desc(invoices.fecha));

        return NextResponse.json({
            success: true,
            invoices: list,
        });

    } catch (error) {
        console.error("Get invoices error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to fetch invoices" },
            { status: 500 }
        );
    }
}
