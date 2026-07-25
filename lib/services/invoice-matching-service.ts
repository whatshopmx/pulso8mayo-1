import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, receivingReports, receivingReportItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface MatchResult {
    isPerfectMatch: boolean;
    priceDiscrepancy: boolean;
    quantityDiscrepancy: boolean;
    details: {
        itemId: string;
        itemName: string;
        orderedQty: number;
        receivedQty: number;
        invoicedQty: number;
        poUnitCost: number; // in cents
        receivingUnitCost: number; // in cents
        invoiceUnitCost: number; // in cents
        discrepancyType: 'NONE' | 'QUANTITY' | 'PRICE' | 'BOTH';
    }[];
}

export class InvoiceMatchingService {
    /**
     * Performs a 3-way match comparison between a PO, its associated physical receiving report,
     * and the parsed invoice items.
     */
    static async perform3WayMatch(
        poId: string,
        receivingReportId: string,
        parsedInvoiceItems: Array<{ itemId: string; quantity: number; unitCostCents: number }>
    ): Promise<MatchResult> {
        // 1. Fetch PO items
        const poItems = await db.select()
            .from(purchaseOrderItems)
            .where(eq(purchaseOrderItems.poId, poId));

        // 2. Fetch receiving items
        const recItems = await db.select()
            .from(receivingReportItems)
            .where(eq(receivingReportItems.receivingReportId, receivingReportId));

        let isPerfectMatch = true;
        let priceDiscrepancy = false;
        let quantityDiscrepancy = false;
        const details = [];

        // Match based on all distinct itemIds involved
        const allItemIds = new Set([
            ...poItems.map(i => i.itemId),
            ...recItems.map(i => i.itemId),
            ...parsedInvoiceItems.map(i => i.itemId),
        ]);

        for (const itemId of allItemIds) {
            const poItem = poItems.find(i => i.itemId === itemId);
            const recItem = recItems.find(i => i.itemId === itemId);
            const invItem = parsedInvoiceItems.find(i => i.itemId === itemId);

            const orderedQty = poItem ? poItem.orderedQuantity : 0;
            const receivedQty = recItem ? recItem.receivedQuantity : 0;
            const invoicedQty = invItem ? invItem.quantity : 0;

            const poUnitCost = poItem ? (poItem.unitCost || 0) : 0;
            const receivingUnitCost = recItem ? (recItem.unitCost || 0) : 0;
            const invoiceUnitCost = invItem ? invItem.unitCostCents : 0;

            let discType: 'NONE' | 'QUANTITY' | 'PRICE' | 'BOTH' = 'NONE';
            
            // Check quantity discrepancy
            const qtyDiff = orderedQty !== receivedQty || receivedQty !== invoicedQty;
            if (qtyDiff) {
                quantityDiscrepancy = true;
                isPerfectMatch = false;
                discType = 'QUANTITY';
            }

            // Check price discrepancy
            const priceDiff = poUnitCost !== invoiceUnitCost || receivingUnitCost !== invoiceUnitCost;
            if (priceDiff) {
                priceDiscrepancy = true;
                isPerfectMatch = false;
                discType = discType === 'QUANTITY' ? 'BOTH' : 'PRICE';
            }

            details.push({
                itemId,
                itemName: poItem?.notes || recItem?.notes || "Insumo",
                orderedQty,
                receivedQty,
                invoicedQty,
                poUnitCost,
                receivingUnitCost,
                invoiceUnitCost,
                discrepancyType: discType,
            });
        }

        return {
            isPerfectMatch,
            priceDiscrepancy,
            quantityDiscrepancy,
            details,
        };
    }
}
