import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, receivingReports, receivingReportItems, suppliers, invoices, invoiceLines } from "@/lib/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

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
    /** Derived, UI-friendly shape used by the invoices page (alerts + printable claim). */
    discrepancies: Array<{
        itemId: string;
        itemName: string;
        type: 'QUANTITY' | 'PRICE' | 'BOTH';
        description: string;
    }>;
    itemComparisons: Array<{
        itemName: string;
        invoiceQty: number;
        receivedQty: number;
        qtyMatches: boolean;
        invoicePrice: number; // in pesos
        poPrice: number; // in pesos
        priceMatches: boolean;
    }>;
}

export class InvoiceMatchingService {
    /**
     * Performs a 3-way match comparison between a PO, its associated physical receiving report,
     * and the parsed invoice items.
     */
    static async perform3WayMatch(
        poId: string,
        receivingReportId: string,
        parsedInvoiceItems: Array<{ itemId: string; quantity: number; unitCostCents: number }>,
        tolerancePercent?: number,
    ): Promise<Omit<MatchResult, 'discrepancies' | 'itemComparisons'>> {
        // 1. Fetch PO items
        const poItems = await db.select()
            .from(purchaseOrderItems)
            .where(eq(purchaseOrderItems.poId, poId));

        // 2. Fetch receiving items
        const recItems = await db.select()
            .from(receivingReportItems)
            .where(eq(receivingReportItems.receivingReportId, receivingReportId));

        // 3. Get PO to find supplier tolerance if not provided
        if (tolerancePercent === undefined) {
            const po = await db.query.purchaseOrders.findFirst({
                where: eq(purchaseOrders.id, poId),
            });
            if (po) {
                const supplier = await db.query.suppliers.findFirst({
                    where: eq(suppliers.id, po.supplierId),
                });
                tolerancePercent = supplier?.matchTolerancePercent ?? 5;
            } else {
                tolerancePercent = 5;
            }
        }

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
            
            // Check quantity discrepancy with tolerance
            const qtyDiffPct = orderedQty > 0
                ? Math.abs(orderedQty - invoicedQty) / orderedQty * 100
                : (invoicedQty > 0 ? 100 : 0);
            if (qtyDiffPct > tolerancePercent) {
                quantityDiscrepancy = true;
                isPerfectMatch = false;
                discType = 'QUANTITY';
            }

            // Check price discrepancy with tolerance
            const priceDiffPct = poUnitCost > 0
                ? Math.abs(poUnitCost - invoiceUnitCost) / poUnitCost * 100
                : (invoiceUnitCost > 0 ? 100 : 0);
            if (priceDiffPct > tolerancePercent) {
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

    /**
     * Performs a 2-way match comparing a physical receiving report against the
     * parsed invoice items, using the receiving report as the reference.
     * Used when there is no purchase order to reconcile against (spot buys).
     */
    static async perform2WayMatch(
        receivingReportId: string,
        parsedInvoiceItems: Array<{ itemId: string; quantity: number; unitCostCents: number }>,
        tolerancePercent?: number,
    ): Promise<Omit<MatchResult, 'discrepancies' | 'itemComparisons'>> {
        const recItems = await db.select()
            .from(receivingReportItems)
            .where(eq(receivingReportItems.receivingReportId, receivingReportId));

        if (tolerancePercent === undefined) {
            const report = await db.query.receivingReports.findFirst({
                where: eq(receivingReports.id, receivingReportId),
            });
            if (report?.supplierId) {
                const supplier = await db.query.suppliers.findFirst({
                    where: eq(suppliers.id, report.supplierId),
                });
                tolerancePercent = supplier?.matchTolerancePercent ?? 5;
            } else {
                tolerancePercent = 5;
            }
        }

        let isPerfectMatch = true;
        let priceDiscrepancy = false;
        let quantityDiscrepancy = false;
        const details = [];

        const allItemIds = new Set([
            ...recItems.map(i => i.itemId),
            ...parsedInvoiceItems.map(i => i.itemId),
        ]);

        for (const itemId of allItemIds) {
            const recItem = recItems.find(i => i.itemId === itemId);
            const invItem = parsedInvoiceItems.find(i => i.itemId === itemId);

            const receivedQty = recItem ? recItem.receivedQuantity : 0;
            const invoicedQty = invItem ? invItem.quantity : 0;
            const recUnitCost = recItem ? (recItem.unitCost || 0) : 0;
            const invoiceUnitCost = invItem ? invItem.unitCostCents : 0;

            let discType: 'NONE' | 'QUANTITY' | 'PRICE' | 'BOTH' = 'NONE';

            // Quantity discrepancy with tolerance (received vs invoiced)
            const qtyDiffPct = receivedQty > 0
                ? Math.abs(receivedQty - invoicedQty) / receivedQty * 100
                : (invoicedQty > 0 ? 100 : 0);
            if (qtyDiffPct > tolerancePercent) {
                quantityDiscrepancy = true;
                isPerfectMatch = false;
                discType = 'QUANTITY';
            }

            // Price discrepancy with tolerance (receiving cost vs invoiced)
            const priceDiffPct = recUnitCost > 0
                ? Math.abs(recUnitCost - invoiceUnitCost) / recUnitCost * 100
                : (invoiceUnitCost > 0 ? 100 : 0);
            if (priceDiffPct > tolerancePercent) {
                priceDiscrepancy = true;
                isPerfectMatch = false;
                discType = discType === 'QUANTITY' ? 'BOTH' : 'PRICE';
            }

            details.push({
                itemId,
                itemName: recItem?.notes || "Insumo",
                orderedQty: recItem?.orderedQuantity ?? receivedQty,
                receivedQty,
                invoicedQty,
                poUnitCost: recUnitCost,
                receivingUnitCost: recUnitCost,
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

    /**
     * Lists receiving reports that are not yet linked to any invoice, useful as
     * candidates to associate a CFDI that arrived after the physical receiving.
     */
    static async listReceivingCandidates(
        companyId: string,
        supplierId?: string | null,
        limit: number = 10,
    ): Promise<Array<{
        id: string;
        poNumber: string | null;
        supplierId: string | null;
        receivedAt: Date | null;
        itemCount: number;
    }>> {
        const candidates = await db.select({
            id: receivingReports.id,
            poNumber: purchaseOrders.poNumber,
            supplierId: receivingReports.supplierId,
            receivedAt: receivingReports.receivedAt,
        })
            .from(receivingReports)
            .leftJoin(purchaseOrders, eq(receivingReports.purchaseOrderId, purchaseOrders.id))
            .where(and(
                eq(receivingReports.companyId, companyId),
                ...(supplierId ? [eq(receivingReports.supplierId, supplierId)] : []),
                sql`NOT EXISTS (SELECT 1 FROM ${invoices} i WHERE i.receiving_report_id = ${receivingReports.id})`
            ))
            .orderBy(desc(receivingReports.receivedAt))
            .limit(limit);

        if (candidates.length === 0) return [];

        const counts = await db.select({
            receivingReportId: receivingReportItems.receivingReportId,
            count: sql<number>`count(*)::int`,
        })
            .from(receivingReportItems)
            .where(inArray(receivingReportItems.receivingReportId, candidates.map(c => c.id)))
            .groupBy(receivingReportItems.receivingReportId);

        return candidates.map(c => ({
            id: c.id,
            poNumber: c.poNumber,
            supplierId: c.supplierId,
            receivedAt: c.receivedAt,
            itemCount: counts.find(x => x.receivingReportId === c.id)?.count ?? 0,
        }));
    }

    /**
     * Loads the full detail bundle for one invoice (same shape returned by
     * GET /api/inventory/invoices?id=...), including 3-way / 2-way match
     * results and the receiving-candidate list.
     */
    static async getInvoiceDetail(invoiceId: string, companyId: string) {
        const [invoiceRecord] = await db.select()
            .from(invoices)
            .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
            .limit(1);
        if (!invoiceRecord) return null;

        const lines = await db.select()
            .from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, invoiceId));

        let supplierRecord = null;
        if (invoiceRecord.supplierId) {
            [supplierRecord] = await db.select()
                .from(suppliers)
                .where(eq(suppliers.id, invoiceRecord.supplierId))
                .limit(1);
        }

        let poRecord = null;
        if (invoiceRecord.purchaseOrderId) {
            [poRecord] = await db.select()
                .from(purchaseOrders)
                .where(eq(purchaseOrders.id, invoiceRecord.purchaseOrderId))
                .limit(1);
        }

        let receivingReportRecord = null;
        if (invoiceRecord.receivingReportId) {
            [receivingReportRecord] = await db.select()
                .from(receivingReports)
                .where(eq(receivingReports.id, invoiceRecord.receivingReportId))
                .limit(1);
        }

        // Match: 3-way when a PO is linked, 2-way (receiving vs invoice) otherwise.
        let matchDetails: MatchResult | null = null;
        if (invoiceRecord.receivingReportId) {
            const parsedItems = lines
                .filter(l => !!l.itemId)
                .map(l => ({ itemId: l.itemId!, quantity: parseFloat(l.cantidad), unitCostCents: l.valorUnitario }));

            if (parsedItems.length > 0) {
                const rawMatch = invoiceRecord.purchaseOrderId
                    ? await this.perform3WayMatch(invoiceRecord.purchaseOrderId, invoiceRecord.receivingReportId, parsedItems)
                    : await this.perform2WayMatch(invoiceRecord.receivingReportId, parsedItems);

                matchDetails = this.decorateMatch(rawMatch);
            }
        }

        const receivingCandidates = await this.listReceivingCandidates(companyId, invoiceRecord.supplierId);

        return {
            invoice: invoiceRecord,
            lines,
            supplier: supplierRecord,
            purchaseOrder: poRecord,
            receivingReport: receivingReportRecord,
            matchDetails,
            receivingCandidates,
        };
    }

    /** Appends the UI-friendly `discrepancies` / `itemComparisons` views. */
    private static decorateMatch(match: Omit<MatchResult, 'discrepancies' | 'itemComparisons'>): MatchResult {
        const discrepancies: MatchResult['discrepancies'] = [];
        const itemComparisons: MatchResult['itemComparisons'] = [];

        for (const d of match.details) {
            const hasQty = d.discrepancyType === 'QUANTITY' || d.discrepancyType === 'BOTH';
            const hasPrice = d.discrepancyType === 'PRICE' || d.discrepancyType === 'BOTH';

            if (d.discrepancyType !== 'NONE') {
                discrepancies.push({
                    itemId: d.itemId,
                    itemName: d.itemName,
                    type: d.discrepancyType,
                    description: [
                        hasQty
                            ? `Cantidad: facturados ${d.invoicedQty} vs recibidos ${d.receivedQty}`
                            : null,
                        hasPrice
                            ? `Precio: factura $${(d.invoiceUnitCost / 100).toFixed(2)} vs referencia $${(d.poUnitCost / 100).toFixed(2)}`
                            : null,
                    ].filter(Boolean).join('. '),
                });
            }

            itemComparisons.push({
                itemName: d.itemName,
                invoiceQty: d.invoicedQty,
                receivedQty: d.receivedQty,
                qtyMatches: !hasQty,
                invoicePrice: d.invoiceUnitCost / 100,
                poPrice: d.poUnitCost / 100,
                priceMatches: !hasPrice,
            });
        }

        return { ...match, discrepancies, itemComparisons };
    }

    /**
     * Links an already-registered invoice to a physical receiving report (and,
     * when possible, to its purchase order), remaps unmapped invoice lines to
     * receiving items and executes the reconciliation.
     *
     * Covers the flow where goods are received first and the CFDI is uploaded
     * afterwards: PO vs receiving vs invoice (3-way), or receiving vs invoice
     * (2-way) when there is no purchase order.
     */
    static async associateToReceiving(
        invoiceId: string,
        receivingReportId: string,
        purchaseOrderIdOverride?: string | null,
    ) {
        const [invoice] = await db.select()
            .from(invoices)
            .where(eq(invoices.id, invoiceId))
            .limit(1);
        if (!invoice) throw new Error("Factura no encontrada");

        const [report] = await db.select()
            .from(receivingReports)
            .where(eq(receivingReports.id, receivingReportId))
            .limit(1);
        if (!report) throw new Error("Reporte de recepción no encontrado");

        if (report.companyId !== invoice.companyId) {
            throw new Error("El reporte de recepción no pertenece a la misma empresa que la factura");
        }
        if (invoice.supplierId && report.supplierId && invoice.supplierId !== report.supplierId) {
            throw new Error("La factura pertenece a un proveedor distinto al del reporte de recepción");
        }

        // Resolve the PO: explicit override > invoice's > receiving report's.
        let poId: string | null = null;
        if (purchaseOrderIdOverride) {
            poId = purchaseOrderIdOverride;
        } else {
            poId = invoice.purchaseOrderId ?? report.purchaseOrderId ?? null;
            if (invoice.purchaseOrderId && report.purchaseOrderId && invoice.purchaseOrderId !== report.purchaseOrderId) {
                throw new Error("La factura y la recepción tienen órdenes de compra distintas; indica cuál usar");
            }
        }
        if (poId) {
            const [poRecord] = await db.select({ id: purchaseOrders.id })
                .from(purchaseOrders)
                .where(eq(purchaseOrders.id, poId))
                .limit(1);
            if (!poRecord) throw new Error("La orden de compra indicada no existe");
        }

        const now = new Date();
        await db.update(invoices)
            .set({
                receivingReportId,
                purchaseOrderId: poId,
                updatedAt: now,
            })
            .where(eq(invoices.id, invoiceId));

        // Remap unmapped invoice lines to receiving items (mirrors processReceiving).
        const invLines = await db.select()
            .from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, invoiceId));
        const recItems = await db.select()
            .from(receivingReportItems)
            .where(eq(receivingReportItems.receivingReportId, receivingReportId));

        for (const rItem of recItems) {
            const exact = invLines.find(l =>
                (!l.itemId || l.itemId === rItem.itemId) &&
                Math.abs(parseFloat(l.cantidad) - rItem.receivedQuantity) < 0.0001 &&
                l.valorUnitario === (rItem.unitCost || 0)
            );
            if (exact && !exact.itemId) {
                await db.update(invoiceLines)
                    .set({ itemId: rItem.itemId })
                    .where(eq(invoiceLines.id, exact.id));
            } else if (!exact) {
                const fallback = invLines.find(l => !l.itemId);
                if (fallback) {
                    await db.update(invoiceLines)
                        .set({ itemId: rItem.itemId })
                        .where(eq(invoiceLines.id, fallback.id));
                }
            }
        }

        const updatedLines = await db.select()
            .from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, invoiceId));
        const parsedItems = updatedLines
            .filter(l => !!l.itemId)
            .map(l => ({ itemId: l.itemId!, quantity: parseFloat(l.cantidad), unitCostCents: l.valorUnitario }));

        let matchDetails: Omit<MatchResult, 'discrepancies' | 'itemComparisons'> | null = null;
        if (parsedItems.length > 0) {
            matchDetails = poId
                ? await this.perform3WayMatch(poId, receivingReportId, parsedItems)
                : await this.perform2WayMatch(receivingReportId, parsedItems);

            await db.update(invoices)
                .set({
                    matchStatus: matchDetails.isPerfectMatch ? 'MATCHED' : 'DISCREPANCY',
                    hasPriceDiscrepancy: matchDetails.priceDiscrepancy,
                    hasQtyDiscrepancy: matchDetails.quantityDiscrepancy,
                    updatedAt: now,
                })
                .where(eq(invoices.id, invoiceId));
        }

        const detail = await this.getInvoiceDetail(invoiceId, invoice.companyId);
        if (!detail) throw new Error("Factura no encontrada");
        return detail;
    }

    /**
     * Autoriza formalmente una excepción de discrepancia en una factura para permitir su pago (Módulo 5.2).
     */
    static async approveMatchException(
        invoiceId: string,
        companyId: string,
        approvedBy: string,
        reason: string
    ) {
        const [invoice] = await db.select()
            .from(invoices)
            .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));

        if (!invoice) throw new Error("Factura no encontrada");
        if (invoice.matchStatus !== 'DISCREPANCY') {
            throw new Error("Solo se pueden autorizar excepciones en facturas con discrepancia");
        }

        const [updated] = await db.update(invoices)
            .set({
                matchStatus: 'EXCEPTION_APPROVED',
                exceptionApprovedBy: approvedBy,
                exceptionApprovedAt: new Date(),
                exceptionReason: reason,
                updatedAt: new Date(),
            })
            .where(eq(invoices.id, invoiceId))
            .returning();

        return updated;
    }
}
