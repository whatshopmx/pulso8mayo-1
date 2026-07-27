import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { InventoryService } from "@/lib/services/inventory-service";
import { AuditService } from "@/lib/services/audit-service";
import { PurchaseOrderService } from "@/lib/services/purchase-order-service";
import { UnitConversionService } from "@/lib/services/unit-conversion-service";
import { db } from "@/lib/db";
import { inventoryBatches, inventoryItems, suppliers, incidents, receivingReports, receivingReportItems, purchaseOrders, purchaseOrderItems, invoices, invoiceLines } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { InvoiceMatchingService } from "@/lib/services/invoice-matching-service";
import { StockAlertService } from "@/lib/services/stock-alert-service";

const receivingSchema = z.object({
    items: z.array(z.object({
        itemId: z.string().uuid(),
        quantity: z.number().positive(),
        unit: z.string().optional(), // Unit of the received quantity (converts if different from item base unit)
        batchNumber: z.string().optional(),
        expirationDate: z.string().optional(),
        productionDate: z.string().optional(),
        unitCost: z.number().optional(),
        temperature: z.number().optional(),
    })),
    supplierId: z.string().uuid().optional(),
    purchaseOrderId: z.string().uuid().optional(),
    invoiceId: z.string().uuid().optional(),
    storageLocationId: z.string().uuid().optional(),
    notes: z.string().optional(),
    signatureUrl: z.string().optional(),
    photoUrls: z.array(z.string()).optional(),
});

/**
 * POST /api/inventory/receiving
 * Process a receiving workflow - scan/enter items being received
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.branchId) {
            return NextResponse.json(
                { error: "Unauthorized - User must be logged in and belong to a branch" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const validatedData = receivingSchema.parse(body);

        // 1. Create receiving report
        const [report] = await db.insert(receivingReports).values({
            companyId: session.user.companyId || "",
            branchId: session.user.branchId,
            supplierId: validatedData.supplierId || null,
            purchaseOrderId: validatedData.purchaseOrderId || null,
            receivedBy: session.user.id,
            notes: validatedData.notes || null,
            signatureUrl: validatedData.signatureUrl || null,
            photoUrls: validatedData.photoUrls || null,
        }).returning();

        const receivingResults = [];

        // Fetch PO items if purchaseOrderId exists
        let poItems: any[] = [];
        if (validatedData.purchaseOrderId) {
            poItems = await db.select()
                .from(purchaseOrderItems)
                .where(eq(purchaseOrderItems.poId, validatedData.purchaseOrderId));
        }

        // Ensure there's an open period for this branch
        await InventoryService.ensureOpenPeriod(session.user.companyId || "", session.user.branchId);

        // Process each item in the receiving
        for (const itemData of validatedData.items) {
            let { itemId, quantity, unit, batchNumber, expirationDate, productionDate, unitCost, temperature } = itemData;

            // Get item details
            const item = await InventoryService.getItem(itemId);
            if (!item) {
                return NextResponse.json(
                    { error: `Item not found: ${itemId}` },
                    { status: 404 }
                );
            }

            // Unit conversion: if received unit differs from item base unit, convert
            if (unit && item.unit && unit !== item.unit) {
                const convertedQty = await UnitConversionService.convert(quantity, unit, item.unit, session.user.companyId || "");
                if (convertedQty !== null) {
                    quantity = convertedQty;
                    // Adjust unitCost inversely (if 2x quantity, half the unit cost)
                    if (unitCost !== undefined) {
                        unitCost = unitCost * (quantity / convertedQty);
                    }
                }
            }

            // Check for PO discrepancy
            let orderedQty = null;
            let poUnitCost = null;
            let discrepancyType: 'NONE' | 'QUANTITY' | 'PRICE' | 'QUALITY' | 'SUBSTITUTION' = 'NONE';
            let discrepancyQty = 0;

            if (validatedData.purchaseOrderId && poItems.length > 0) {
                const poItem = poItems.find(p => p.itemId === itemId);
                if (poItem) {
                    orderedQty = poItem.orderedQuantity;
                    poUnitCost = poItem.unitCost;
                    
                    const remainingQty = poItem.orderedQuantity - (poItem.receivedQuantity || 0);
                    if (quantity !== remainingQty) {
                        discrepancyType = 'QUANTITY';
                        discrepancyQty = remainingQty - quantity; // positive = under-received, negative = over-received
                    }

                    const costInCents = unitCost ? Math.round(unitCost * 100) : null;
                    if (costInCents !== null && poItem.unitCost !== costInCents) {
                        discrepancyType = 'PRICE';
                    }
                } else {
                    discrepancyType = 'SUBSTITUTION';
                }
            }

            if (temperature !== undefined && temperature > 4) {
                discrepancyType = 'QUALITY';
            }

            // Convert unitCost from decimal float to integer cents
            const finalUnitCostCents = unitCost ? Math.round(unitCost * 100) : (poUnitCost || item.lastCost || null);

            // Create batch with expiration date and batch number
            const batch = await InventoryService.createBatch({
                itemId,
                branchId: session.user.branchId,
                initialQuantity: quantity,
                currentQuantity: quantity,
                lotNumber: batchNumber || `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                expirationDate: expirationDate ? new Date(expirationDate) : undefined,
                productionDate: productionDate ? new Date(productionDate) : undefined,
                supplierId: validatedData.supplierId || item.supplierId || null,
                unitCost: finalUnitCostCents,
                status: (temperature !== undefined && temperature > 4) ? 'QUARANTINED' : 'AVAILABLE',
                supplierBatchInfo: {
                    receivedBy: session.user.id,
                    receivedAt: new Date().toISOString(),
                    notes: validatedData.notes,
                    temperature: temperature,
                }
            });

            // Record the receiving movement
            const movement = await InventoryService.recordMovement({
                branchId: session.user.branchId,
                itemId,
                batchId: batch.id,
                type: 'RECEIVING',
                quantityChange: quantity,
                toLocationId: validatedData.storageLocationId,
                reason: validatedData.notes || 'Receiving workflow',
                performedBy: session.user.id,
            });

            // Save report item in database
            await db.insert(receivingReportItems).values({
                receivingReportId: report.id,
                itemId,
                orderedQuantity: orderedQty,
                receivedQuantity: quantity,
                unitCost: finalUnitCostCents,
                lineTotal: quantity * (finalUnitCostCents || 0),
                discrepancyType,
                discrepancyQty,
                notes: validatedData.notes || null,
            });

            // If purchase order exists, record the received quantity
            if (validatedData.purchaseOrderId) {
                await PurchaseOrderService.recordReceivedQuantity(
                    validatedData.purchaseOrderId,
                    itemId,
                    quantity,
                    session.user.id
                );
            }

            // Update lastCost of item and trigger price alerts
            if (finalUnitCostCents) {
                await InventoryService.updateItem(itemId, { 
                    lastCost: finalUnitCostCents,
                    supplierId: validatedData.supplierId || item.supplierId || undefined
                }, session.user.id);

                // Check for price alert
                await StockAlertService.checkPriceIncrease(
                    itemId, 
                    finalUnitCostCents, 
                    validatedData.supplierId || item.supplierId || null, 
                    session.user.companyId || "", 
                    session.user.branchId, 
                    session.user.id
                );
            }

            // If the item is quarantined due to high temperature, automatically trigger an incident
            if (temperature !== undefined && temperature > 4) {
                await db.insert(incidents).values({
                    instanceId: uuidv4(),
                    stepId: `RECEIVING_QA_${item.id}`,
                    branchId: session.user.branchId,
                    severity: 'WARNING',
                    status: 'DETECTED',
                    title: `Rechazo de Calidad: ${item.name} por Alta Temperatura`,
                    description: `El producto ${item.name} fue recibido con una temperatura de ${temperature}°C, excediendo el límite máximo de calidad (4°C). Lote mandado a cuarentena automáticamente.`,
                    detectedBy: session.user.id,
                    metadata: {
                        itemId: item.id,
                        quantity,
                        recordedTemperature: temperature,
                        supplierId: validatedData.supplierId || item.supplierId
                    }
                });
            }

            receivingResults.push({
                itemId,
                itemName: item.name,
                batchId: batch.id,
                batchNumber: batch.lotNumber,
                quantity,
                expirationDate: batch.expirationDate,
                movementId: movement.id,
            });
        }

        // Generate receiving report data
        const receivingReport = {
            id: report.id,
            branchId: session.user.branchId,
            receivedAt: report.receivedAt,
            receivedBy: session.user.id,
            supplierId: validatedData.supplierId,
            purchaseOrderId: validatedData.purchaseOrderId,
            items: receivingResults,
            totalItems: receivingResults.length,
            notes: validatedData.notes,
        };

        for (const result of receivingResults) {
            AuditService.logInventoryAction({
                companyId: session.user.companyId || '',
                branchId: session.user.branchId,
                action: 'CREATE',
                entityType: 'RECEIVING',
                entityId: result.batchId,
                newValue: result,
                performedBy: session.user.id,
                reason: validatedData.notes || 'Receiving completed',
                metadata: { supplierId: validatedData.supplierId, purchaseOrderId: validatedData.purchaseOrderId },
            });
        }

        // If invoice is associated, run 3-way match
        if (validatedData.invoiceId) {
            await db.update(invoices)
                .set({
                    purchaseOrderId: validatedData.purchaseOrderId || null,
                    receivingReportId: report.id,
                    updatedAt: new Date()
                })
                .where(eq(invoices.id, validatedData.invoiceId));

            // Map and update each line item's itemId on the invoice lines
            const invLines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, validatedData.invoiceId));
            for (const itemData of validatedData.items) {
                const line = invLines.find(l => 
                    (!l.itemId || l.itemId === itemData.itemId) && 
                    Math.abs(parseFloat(l.cantidad) - itemData.quantity) < 0.0001 &&
                    l.valorUnitario === Math.round((itemData.unitCost || 0) * 100)
                );
                if (line) {
                    await db.update(invoiceLines)
                        .set({ itemId: itemData.itemId })
                        .where(eq(invoiceLines.id, line.id));
                } else {
                    const fallbackLine = invLines.find(l => !l.itemId);
                    if (fallbackLine) {
                        await db.update(invoiceLines)
                            .set({ itemId: itemData.itemId })
                            .where(eq(invoiceLines.id, fallbackLine.id));
                    }
                }
            }

            // Run 3-Way Match
            if (validatedData.purchaseOrderId) {
                const updatedLines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, validatedData.invoiceId));
                const parsedInvoiceItems = updatedLines
                    .filter(l => !!l.itemId)
                    .map(l => ({
                        itemId: l.itemId!,
                        quantity: parseFloat(l.cantidad),
                        unitCostCents: l.valorUnitario
                    }));

                const matchResult = await InvoiceMatchingService.perform3WayMatch(
                    validatedData.purchaseOrderId,
                    report.id,
                    parsedInvoiceItems
                );

                await db.update(invoices)
                    .set({
                        matchStatus: matchResult.isPerfectMatch ? 'MATCHED' : 'DISCREPANCY',
                        hasPriceDiscrepancy: matchResult.priceDiscrepancy,
                        hasQtyDiscrepancy: matchResult.quantityDiscrepancy,
                        updatedAt: new Date()
                    })
                    .where(eq(invoices.id, validatedData.invoiceId));
            }
        }

        return NextResponse.json({
            success: true,
            receiving: receivingReport,
        });

    } catch (error) {
        console.error("Receiving workflow error:", error);
        
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: "Invalid data", details: error.issues },
            { status: 400 }
          );
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to process receiving" },
            { status: 500 }
        );
    }
}

/**
 * GET /api/inventory/receiving
 * Get pending receiving workflows or recent receiving history
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get("limit") || "50");
        const days = parseInt(searchParams.get("days") || "30");

        // Get recent receiving movements
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        // TODO: Create a dedicated receiving table if we need to track full receiving documents
        // For now, return recent RECEIVING type movements grouped by batch

        const recentBatches = await db.select({
            id: inventoryBatches.id,
            lotNumber: inventoryBatches.lotNumber,
            itemId: inventoryBatches.itemId,
            branchId: inventoryBatches.branchId,
            initialQuantity: inventoryBatches.initialQuantity,
            receivedAt: inventoryBatches.receivedAt,
            expirationDate: inventoryBatches.expirationDate,
            supplierId: inventoryBatches.supplierId,
            supplierBatchInfo: inventoryBatches.supplierBatchInfo,
            item: {
                name: inventoryItems.name,
                sku: inventoryItems.sku,
            },
            supplier: {
                name: suppliers.name,
            }
        })
        .from(inventoryBatches)
        .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
        .leftJoin(suppliers, eq(inventoryBatches.supplierId, suppliers.id))
        .where(
            and(
                eq(inventoryBatches.branchId, session.user.branchId!),
                // Filter by receivedAt date
            )
        )
        .orderBy((t) => t.receivedAt)
        .limit(limit);

        return NextResponse.json({
            success: true,
            receivings: recentBatches,
        });

    } catch (error) {
        console.error("Get receiving error:", error);
        return NextResponse.json(
            { error: "Failed to fetch receiving data" },
            { status: 500 }
        );
    }
}
