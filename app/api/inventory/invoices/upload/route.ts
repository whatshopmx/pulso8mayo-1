import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { CFDIParserService } from "@/lib/services/cfdi-parser";
import { InvoiceMatchingService } from "@/lib/services/invoice-matching-service";
import { db } from "@/lib/db";
import { suppliers, inventoryItems, purchaseOrders, invoices, invoiceLines, receivingReports } from "@/lib/db/schema";
import { eq, and, or, ilike, sql, inArray } from "drizzle-orm";

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized - User must be logged in" },
                { status: 401 }
            );
        }

        const formData = await req.formData();
        const file = formData.get("file") as File;
        if (!file) {
            return NextResponse.json(
                { error: "No file uploaded" },
                { status: 400 }
            );
        }

        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(
            role,
            session.user.branchId,
            (formData.get("branchId") as string | null) ?? null
        );

        const xmlText = await file.text();
        const parsedCFDI = CFDIParserService.parse(xmlText);

        if (!parsedCFDI.uuid) {
            return NextResponse.json(
                { error: "El archivo XML no contiene un Folio Fiscal (UUID) válido" },
                { status: 400 }
            );
        }

        // Validate UUID uniqueness
        const existingInvoice = await db.select()
            .from(invoices)
            .where(
                and(
                    eq(invoices.companyId, session.user.companyId),
                    eq(invoices.uuid, parsedCFDI.uuid)
                )
            )
            .limit(1);

        if (existingInvoice.length > 0) {
            return NextResponse.json(
                { error: `Esta factura ya fue registrada anteriormente (UUID: ${parsedCFDI.uuid})` },
                { status: 400 }
            );
        }

        // 1. Supplier Matching by RFC (taxId)
        let matchedSupplier = null;
        if (parsedCFDI.rfcEmisor) {
            const supplierMatches = await db.select()
                .from(suppliers)
                .where(
                    and(
                        eq(suppliers.companyId, session.user.companyId),
                        eq(suppliers.taxId, parsedCFDI.rfcEmisor)
                    )
                );
            
            if (supplierMatches.length > 0) {
                matchedSupplier = supplierMatches[0];
            } else {
                // Fallback: match by name
                const nameMatches = await db.select()
                    .from(suppliers)
                    .where(
                        and(
                            eq(suppliers.companyId, session.user.companyId),
                            ilike(suppliers.name, `%${parsedCFDI.nombreEmisor}%`)
                        )
                    );
                if (nameMatches.length > 0) {
                    matchedSupplier = nameMatches[0];
                }
            }
        }

        // 2. Fetch active purchase orders for this supplier if matched
        let matchingPOs: any[] = [];
        if (matchedSupplier) {
            const pos = await db.select()
                .from(purchaseOrders)
                .where(
                    and(
                        eq(purchaseOrders.supplierId, matchedSupplier.id),
                        or(
                            eq(purchaseOrders.status, 'APPROVED'),
                            eq(purchaseOrders.status, 'SENT'),
                            eq(purchaseOrders.status, 'PARTIALLY_RECEIVED')
                        )
                    )
                );
            matchingPOs = pos.map(po => ({
                id: po.id,
                poNumber: po.poNumber,
                status: po.status,
                total: po.totalAmount,
            }));
        }

        // 3. Item Matching for each Concepto
        const matchedItems = [];
        for (const concepto of parsedCFDI.conceptos) {
            let matchedItem = null;

            // Search by noIdentificacion (SKU / Barcode)
            if (concepto.noIdentificacion) {
                const skuMatches = await db.select()
                    .from(inventoryItems)
                    .where(
                        and(
                            eq(inventoryItems.companyId, session.user.companyId),
                            or(
                                eq(inventoryItems.sku, concepto.noIdentificacion),
                                eq(inventoryItems.barcode, concepto.noIdentificacion)
                            )
                        )
                    );
                if (skuMatches.length > 0) {
                    matchedItem = skuMatches[0];
                }
            }

            // Fallback: Search by description/name
            if (!matchedItem && concepto.descripcion) {
                const cleanDesc = concepto.descripcion.trim();
                const descMatches = await db.select()
                    .from(inventoryItems)
                    .where(
                        and(
                            eq(inventoryItems.companyId, session.user.companyId),
                            or(
                                ilike(inventoryItems.name, `%${cleanDesc}%`),
                                sql`${cleanDesc} ILIKE '%' || ${inventoryItems.name} || '%'`
                            )
                        )
                    );
                if (descMatches.length > 0) {
                    matchedItem = descMatches[0];
                }
            }

            matchedItems.push({
                concepto,
                matchedItemId: matchedItem ? matchedItem.id : null,
                matchedItemName: matchedItem ? matchedItem.name : null,
                matchedItemSku: matchedItem ? matchedItem.sku : null,
                matchStatus: matchedItem ? 'MATCHED' : 'UNMATCHED',
            });
        }

        // 4. Save Invoice and Lines in DB
        const invoiceRecord = await db.transaction(async (tx) => {
            const [inv] = await tx.insert(invoices).values({
                companyId: session.user.companyId || "",
                branchId: branchId ?? null,
                supplierId: matchedSupplier ? matchedSupplier.id : null,
                purchaseOrderId: (matchingPOs.length > 0) ? matchingPOs[0].id : null,
                uuid: parsedCFDI.uuid!,
                folio: parsedCFDI.folio || null,
                serie: parsedCFDI.serie || null,
                fecha: parsedCFDI.fecha,
                subtotal: Math.round(parsedCFDI.subTotal * 100),
                taxAmount: Math.round((parsedCFDI.total - parsedCFDI.subTotal) * 100),
                total: Math.round(parsedCFDI.total * 100),
                currency: parsedCFDI.moneda || 'MXN',
                rfcEmisor: parsedCFDI.rfcEmisor,
                nombreEmisor: parsedCFDI.nombreEmisor || null,
                rfcReceptor: parsedCFDI.rfcReceptor,
                nombreReceptor: parsedCFDI.nombreReceptor || null,
                xmlContent: xmlText,
            }).returning();

            // Insert invoice lines
            for (const item of matchedItems) {
                await tx.insert(invoiceLines).values({
                    invoiceId: inv.id,
                    itemId: item.matchedItemId,
                    claveProdServ: item.concepto.claveProdServ,
                    noIdentificacion: item.concepto.noIdentificacion || null,
                    cantidad: item.concepto.cantidad.toFixed(4),
                    claveUnidad: item.concepto.claveUnidad,
                    unidad: item.concepto.unidad || null,
                    descripcion: item.concepto.descripcion,
                    valorUnitario: Math.round(item.concepto.valorUnitario * 100),
                    importe: Math.round(item.concepto.importe * 100),
                });
            }

            return inv;
        });

        // 5. Auto-reconciliación: si quien recibió capturó el No. de factura
        // (receiving_reports.invoice_number), liga este CFDI a esa recepción y
        // corre la conciliación (3-way con OC, 2-way sin ella).
        let autoMatch: { receivingReportId: string; matched: boolean; isPerfectMatch?: boolean } | null = null;
        if (parsedCFDI.folio) {
            const folioVariants = [parsedCFDI.folio];
            if (parsedCFDI.serie) folioVariants.push(`${parsedCFDI.serie}-${parsedCFDI.folio}`, `${parsedCFDI.serie}${parsedCFDI.folio}`);

            const [candidate] = await db.select({ id: receivingReports.id })
                .from(receivingReports)
                .where(
                    and(
                        eq(receivingReports.companyId, session.user.companyId),
                        ...(matchedSupplier ? [eq(receivingReports.supplierId, matchedSupplier.id)] : []),
                        inArray(receivingReports.invoiceNumber, folioVariants),
                        sql`NOT EXISTS (SELECT 1 FROM ${invoices} i WHERE i.receiving_report_id = ${receivingReports.id})`
                    )
                )
                .orderBy(sql`${receivingReports.receivedAt} DESC`)
                .limit(1);

            if (candidate) {
                try {
                    const matchDetail = await InvoiceMatchingService.associateToReceiving(
                        invoiceRecord.id,
                        candidate.id,
                        invoiceRecord.purchaseOrderId,
                    );
                    autoMatch = {
                        receivingReportId: candidate.id,
                        matched: true,
                        isPerfectMatch: matchDetail.matchDetails?.isPerfectMatch ?? false,
                    };
                } catch (matchError) {
                    console.error("Auto-match by folio failed:", matchError);
                }
            }
        }

        return NextResponse.json({
            success: true,
            invoice: {
                id: invoiceRecord.id,
                uuid: invoiceRecord.uuid,
                folio: invoiceRecord.folio,
                serie: invoiceRecord.serie,
                fecha: invoiceRecord.fecha,
                subTotal: parsedCFDI.subTotal,
                total: parsedCFDI.total,
                moneda: parsedCFDI.moneda,
                rfcEmisor: parsedCFDI.rfcEmisor,
                nombreEmisor: parsedCFDI.nombreEmisor,
                rfcReceptor: parsedCFDI.rfcReceptor,
                nombreReceptor: parsedCFDI.nombreReceptor,
            },
            supplier: matchedSupplier ? {
                id: matchedSupplier.id,
                name: matchedSupplier.name,
                taxId: matchedSupplier.taxId,
            } : null,
            purchaseOrders: matchingPOs,
            items: matchedItems,
            autoMatch,
        });

    } catch (error) {
        console.error("Invoice upload/parse error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to upload and parse invoice XML" },
            { status: 500 }
        );
    }
}
