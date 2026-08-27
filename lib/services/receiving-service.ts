// lib/services/receiving-service.ts
// Shared receiving-processing logic, extracted from
// app/api/inventory/receiving/route.ts (Fase 5: single source so the workflow
// extractor and the API don't duplicate stock/batch/PO/CFDI handling).

import { db } from "@/lib/db";
import { incidents, receivingReports, receivingReportItems, purchaseOrderItems, invoices, invoiceLines, temperatureLogs, users } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { InventoryService } from "./inventory-service";
import { AuditService } from "./audit-service";
import { PurchaseOrderService } from "./purchase-order-service";
import { UnitConversionService } from "./unit-conversion-service";
import { InvoiceMatchingService } from "./invoice-matching-service";
import { StockAlertService } from "./stock-alert-service";
import { evaluateReceivingTemperature } from "./receiving-temperature";
import { SupplierClaimService } from "./supplier-claim-service";
import { NotificationDispatcher } from "./notification-dispatcher";

export const receivingSchema = z.object({
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
    /** Folio/número de la factura o remisión física del proveedor. Se guarda en
     *  el reporte para conciliar automáticamente cuando llegue el CFDI. */
    invoiceNumber: z.string().trim().max(100).optional(),
    storageLocationId: z.string().uuid().optional(),
    notes: z.string().optional(),
    signatureUrl: z.string().optional(),
    photoUrls: z.array(z.string()).optional(),
});

export type ReceivingActor = {
    user: { id: string; companyId?: string | null };
    branchId: string;
};

export type ReceivingResult = {
    id: string;
    branchId: string;
    receivedAt: Date | null;
    receivedBy: string;
    supplierId: string | null;
    purchaseOrderId: string | null;
    invoiceNumber: string | null;
    items: unknown[];
    totalItems: number;
    notes: string | null;
};

/**
 * Processes a receiving: creates the receiving report, batches, movements,
 * receiving-report items, PO updates, and CFDI 3-way match. Idempotent-ish:
 * callers are responsible for providing already-parsed/validated data.
 */
export async function processReceiving(
    actor: ReceivingActor,
    body: unknown
): Promise<ReceivingResult> {
    if (!actor.user.id || !actor.branchId) {
        throw new Error("Unauthorized - User must be logged in and belong to a branch");
    }

    const validatedData = receivingSchema.parse(body);
    const companyId = actor.user.companyId || "";
    const branchId = actor.branchId;

    // 1. Create receiving report
    const [report] = await db.insert(receivingReports).values({
        companyId,
        branchId,
        supplierId: validatedData.supplierId || null,
        purchaseOrderId: validatedData.purchaseOrderId || null,
        invoiceNumber: validatedData.invoiceNumber || null,
        receivedBy: actor.user.id,
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

    // Validate the linked invoice BEFORE inserting anything, so a bad
    // association can't leave a half-processed receiving behind.
    if (validatedData.invoiceId) {
        const [linkedInvoice] = await db.select({
            supplierId: invoices.supplierId,
            purchaseOrderId: invoices.purchaseOrderId,
        })
            .from(invoices)
            .where(eq(invoices.id, validatedData.invoiceId))
            .limit(1);

        if (!linkedInvoice) {
            throw new Error("Factura no encontrada");
        }
        if (validatedData.supplierId && linkedInvoice.supplierId && linkedInvoice.supplierId !== validatedData.supplierId) {
            throw new Error("La factura está asociada a otro proveedor");
        }
    }

    // Ensure there's an open period for this branch
    await InventoryService.ensureOpenPeriod(companyId, branchId);

    // Process each item in the receiving
    for (const itemData of validatedData.items) {
        const { itemId, unit, batchNumber, expirationDate, productionDate, temperature } = itemData;
        // Solo estas dos se recalculan más abajo (conversión de unidad / costo).
        let { quantity, unitCost } = itemData;

        // Get item details
        const item = await InventoryService.getItem(itemId);
        if (!item) {
            throw new Error(`Item not found: ${itemId}`);
        }

        // Unit conversion: if received unit differs from item base unit, convert
        if (unit && item.unit && unit !== item.unit) {
            const convertedQty = await UnitConversionService.convert(quantity, unit, item.unit, companyId);
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

        // Validación de temperatura por tipo de almacenamiento (loteprod §5.2):
        // congelado ≤ -18°C, refrigerado 0–4°C; fuera de rango = rechazo.
        const temperatureCheck = evaluateReceivingTemperature(temperature, item.storageType ?? null);
        if (temperatureCheck.quarantined) {
            discrepancyType = 'QUALITY';
        }

        // Convert unitCost from decimal float to integer cents
        const finalUnitCostCents = unitCost ? Math.round(unitCost * 100) : (poUnitCost || item.lastCost || null);

        // Create batch with expiration date and batch number
        const batch = await InventoryService.createBatch({
            itemId,
            branchId,
            initialQuantity: String(quantity), // numeric(12,4): string en TS
            currentQuantity: String(quantity),
            lotNumber: batchNumber || `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            expirationDate: expirationDate ? new Date(expirationDate) : undefined,
            productionDate: productionDate ? new Date(productionDate) : undefined,
            supplierId: validatedData.supplierId || item.supplierId || null,
            unitCost: finalUnitCostCents,
            status: temperatureCheck.quarantined ? 'QUARANTINED' : 'AVAILABLE',
            supplierBatchInfo: {
                receivingReportId: report.id,
                invoiceNumber: validatedData.invoiceNumber || null,
                receivedBy: actor.user.id,
                receivedAt: new Date().toISOString(),
                notes: validatedData.notes,
                temperature: temperature,
            }
        });

        // Record the receiving movement
        const movement = await InventoryService.recordMovement({
            branchId,
            itemId,
            batchId: batch.id,
            type: 'RECEIVING',
            quantityChange: quantity,
            toLocationId: validatedData.storageLocationId,
            reason: validatedData.notes || 'Receiving workflow',
            performedBy: actor.user.id,
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
                actor.user.id
            );
        }

        // Update lastCost of item and trigger price alerts
        if (finalUnitCostCents) {
            await InventoryService.updateItem(itemId, {
                lastCost: finalUnitCostCents,
                supplierId: validatedData.supplierId || item.supplierId || undefined
            }, actor.user.id);

            await StockAlertService.checkPriceIncrease(
                itemId,
                finalUnitCostCents,
                validatedData.supplierId || item.supplierId || null,
                companyId,
                branchId,
                actor.user.id
            );
        }

        // Registrar lectura térmica en temperature_logs (NOM-251) si se capturó temperatura
        if (temperature !== undefined && temperature !== null && !Number.isNaN(temperature)) {
            await db.insert(temperatureLogs).values({
                branchId,
                readingValue: Math.round(temperature),
                unit: 'C',
                isCompliant: !temperatureCheck.quarantined,
                captureMethod: 'RECEIVING',
                capturedBy: actor.user.id,
                notes: temperatureCheck.quarantined
                    ? `Rechazo NOM-251 en recepción: ${temperatureCheck.violation}. Lote en cuarentena: ${batch.lotNumber}`
                    : `Lectura conforme NOM-251 en recepción de ${item.name} (${temperature}°C)`,
            });
        }

        // Si la temperatura violó el rango del ítem: Incidente + Reclamo a Proveedor + Notificación Inmediata
        if (temperatureCheck.quarantined) {
            // 1. Registro de Incidente
            await db.insert(incidents).values({
                instanceId: uuidv4(),
                stepId: `RECEIVING_QA_${item.id}`,
                branchId,
                severity: 'WARNING',
                status: 'DETECTED',
                title: `Rechazo de Calidad: ${item.name} por Temperatura Fuera de Rango`,
                description: `El producto ${item.name} fue recibido a ${temperature}°C (${temperatureCheck.violation}). Lote mandado a cuarentena automáticamente.`,
                detectedBy: actor.user.id,
                metadata: {
                    itemId: item.id,
                    quantity,
                    recordedTemperature: temperature,
                    supplierId: validatedData.supplierId || item.supplierId
                }
            });

            // 2. Creación automática de Reclamo al Proveedor (Módulo 2.1)
            const targetSupplierId = validatedData.supplierId || item.supplierId;
            if (targetSupplierId) {
                await SupplierClaimService.createClaim({
                    companyId,
                    branchId,
                    supplierId: targetSupplierId,
                    invoiceId: validatedData.invoiceId,
                    type: 'QUALITY',
                    description: `Rechazo térmico NOM-251: ${item.name} recibido a ${temperature}°C (${temperatureCheck.violation}). Lote ${batch.lotNumber} (${quantity} ${item.unit || 'uds'}) puesto en CUARENTENA.`,
                    totalAmount: finalUnitCostCents ? Math.round(quantity * finalUnitCostCents) : undefined,
                    notes: `Incidencia generada automáticamente desde Recepción de Mercancía (${report.id}).`,
                }).catch((err) => console.error("Error creating automated supplier claim:", err));
            }

            // 3. Notificación Inmediata a Gerentes / Administradores
            const branchManagers = await db.select({ id: users.id })
                .from(users)
                .where(and(
                    eq(users.companyId, companyId),
                    sql`${users.role} IN ('ADMIN', 'GERENTE', 'DIRECTOR_OPS', 'OWNER')`
                ));

            for (const mgr of branchManagers) {
                await NotificationDispatcher.sendNotification({
                    userId: mgr.id,
                    title: `🚨 Alerta NOM-251: Rechazo de Calidad (${item.name})`,
                    message: `El producto ${item.name} fue recibido a ${temperature}°C (${temperatureCheck.violation}). Lote puesto en CUARENTENA y reclamo generado.`,
                    type: 'error',
                    eventType: 'incident',
                    actionUrl: `/dashboard/inventory/claims`,
                    metadata: {
                        incidentTitle: `Alerta NOM-251: ${item.name}`,
                        severity: 'CRITICAL',
                        description: `Temperatura fuera de rango: ${temperature}°C (${temperatureCheck.violation})`,
                    }
                }).catch((err) => console.error("Error dispatching NOM-251 alert:", err));
            }
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

    for (const result of receivingResults) {
        AuditService.logInventoryAction({
            companyId,
            branchId,
            action: 'CREATE',
            entityType: 'RECEIVING',
            entityId: result.batchId as string,
            newValue: result,
            performedBy: actor.user.id,
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

    return {
        id: report.id,
        branchId,
        receivedAt: report.receivedAt,
        receivedBy: actor.user.id,
        supplierId: validatedData.supplierId || null,
        purchaseOrderId: validatedData.purchaseOrderId || null,
        invoiceNumber: validatedData.invoiceNumber || null,
        items: receivingResults,
        totalItems: receivingResults.length,
        notes: validatedData.notes || null,
    };
}