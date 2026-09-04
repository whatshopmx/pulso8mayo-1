import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices, suppliers, purchaseOrders } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { InvoiceMatchingService } from "@/lib/services/invoice-matching-service";

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        const uuid = searchParams.get("uuid");

        if (id) {
            // Get single invoice detail (incl. 3-way/2-way match + candidates)
            const detail = await InvoiceMatchingService.getInvoiceDetail(id, session.user.companyId);

            if (!detail) {
                return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
            }

            return NextResponse.json({ success: true, ...detail });
        }

        // Lookup por folio fiscal (UUID del CFDI) — enlace manual OS↔factura,
        // cuando el auto-match al capturar no aplicó.
        if (uuid) {
            const [found] = await db
                .select({
                    id: invoices.id,
                    uuid: invoices.uuid,
                    folio: invoices.folio,
                    serie: invoices.serie,
                    fecha: invoices.fecha,
                    total: invoices.total,
                    supplierName: suppliers.name,
                    serviceOrderId: invoices.serviceOrderId,
                })
                .from(invoices)
                .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
                .where(and(eq(invoices.companyId, session.user.companyId), eq(invoices.uuid, uuid)))
                .limit(1);

            if (!found) {
                return NextResponse.json({ error: "No existe una factura con ese folio fiscal" }, { status: 404 });
            }

            return NextResponse.json({ success: true, invoice: found });
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
