import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices, invoiceLines, suppliers, purchaseOrders, receivingReports } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
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
            // Get single invoice detail
            const [invoiceRecord] = await db.select()
                .from(invoices)
                .where(
                    and(
                        eq(invoices.companyId, session.user.companyId),
                        eq(invoices.id, id)
                    )
                )
                .limit(1);

            if (!invoiceRecord) {
                return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
            }

            // Get lines
            const lines = await db.select()
                .from(invoiceLines)
                .where(eq(invoiceLines.invoiceId, id));

            // Get supplier
            let supplierRecord = null;
            if (invoiceRecord.supplierId) {
                [supplierRecord] = await db.select()
                    .from(suppliers)
                    .where(eq(suppliers.id, invoiceRecord.supplierId))
                    .limit(1);
            }

            // Get PO
            let poRecord = null;
            if (invoiceRecord.purchaseOrderId) {
                [poRecord] = await db.select()
                    .from(purchaseOrders)
                    .where(eq(purchaseOrders.id, invoiceRecord.purchaseOrderId))
                    .limit(1);
            }

            // Get receiving report
            let receivingReportRecord = null;
            if (invoiceRecord.receivingReportId) {
                [receivingReportRecord] = await db.select()
                    .from(receivingReports)
                    .where(eq(receivingReports.id, invoiceRecord.receivingReportId))
                    .limit(1);
            }

            // Calculate 3-Way Match details if PO and Receiving Report exist
            let matchDetails = null;
            if (invoiceRecord.purchaseOrderId && invoiceRecord.receivingReportId) {
                // Map invoice lines to parameters for perform3WayMatch
                const parsedItems = lines.map(line => ({
                    itemId: line.itemId || "",
                    quantity: parseFloat(line.cantidad),
                    unitCostCents: line.valorUnitario,
                })).filter(item => !!item.itemId); // Filter out unmapped items

                matchDetails = await InvoiceMatchingService.perform3WayMatch(
                    invoiceRecord.purchaseOrderId,
                    invoiceRecord.receivingReportId,
                    parsedItems
                );
            }

            return NextResponse.json({
                success: true,
                invoice: invoiceRecord,
                lines,
                supplier: supplierRecord,
                purchaseOrder: poRecord,
                receivingReport: receivingReportRecord,
                matchDetails,
            });
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
            supplierName: suppliers.name,
            poNumber: purchaseOrders.poNumber,
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
