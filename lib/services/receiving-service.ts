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
import { evaluateReceivingTemperaturePolicy, missingTemperatureReadings } from "./receiving-temperature";
import { convertReceivedAmount } from "./receiving-cost";
import { hasPermission, type Role } from "@/lib/permissions";
import { SupplierClaimService } from "./supplier-claim-service";
import { NotificationDispatcher } from "./notification-dispatcher";
import { ApiError } from "@/lib/api/error";

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
        /** Excepción autorizada para recibir refrigerado/congelado sin lectura.
         *  Requiere motivo no vacío; sólo la acepta un actor con permiso de
         *  inventario. Queda registrada en el lote para trazabilidad. */
        temperatureExceptionReason: z.string().trim().min(8).max(300).optional(),
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
    /** Clave de idempotencia: un reenvío o reintento con la misma clave devuelve
     *  la recepción ya creada en vez de duplicar lote, movimiento y avance de OC.
     *  La API la recibe del cliente; el extractor de workflow la deriva del id de
     *  instancia, así que un reintento de Inngest no vuelve a recibir. */
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

export type ReceivingActor = {
    user: { id: string; companyId?: string | null };
    branchId: string;
    /** Rol del actor: habilita la excepción autorizada de temperatura. */
    role?: Role;
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
 * ¿Es una violación de unicidad de Postgres/Neon? (código 23505).
 *
 * Se comprueba por forma y no con `instanceof` porque el driver serverless
 * lanza su propia clase de error y el `instanceof` cruzado entre chunks falla.
 *
 * Además hay que recorrer la cadena de `cause`: Drizzle envuelve el error de
 * Postgres en un `DrizzleQueryError` ("Failed query: ...") y deja el `code`
 * real en `error.cause.code`. Sin este recorrido, la carrera de dos envíos
 * simultáneos NO hacía replay: el perdedor devolvía error en vez de la
 * recepción ganadora (lo detectó la prueba DB-real de la Puerta 1).
 */
function isUniqueViolation(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current; depth++) {
        if (
            typeof current === "object" &&
            current !== null &&
            (current as { code?: unknown }).code === "23505"
        ) {
            return true;
        }
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}

/**
 * Recepción ya creada con esta clave de idempotencia, o `null`.
 *
 * La clave se busca dentro de la empresa. Si existe pero es de otra sucursal se
 * rechaza con 409: adivinar la clave de otro no debe exponer su recepción.
 * Los ítems se releen del reporte para devolver una forma estable en el replay.
 */
async function findReceivingByIdempotencyKey(
    companyId: string,
    idempotencyKey: string,
    branchId: string
): Promise<ReceivingResult | null> {
    const [report] = await db
        .select()
        .from(receivingReports)
        .where(and(
            eq(receivingReports.companyId, companyId),
            eq(receivingReports.idempotencyKey, idempotencyKey)
        ))
        .limit(1);

    if (!report) return null;

    if (report.branchId !== branchId) {
        throw ApiError.conflict(
            "La clave de idempotencia ya fue usada en una recepción de otra sucursal."
        );
    }

    const items = await db
        .select()
        .from(receivingReportItems)
        .where(eq(receivingReportItems.receivingReportId, report.id));

    return {
        id: report.id,
        branchId: report.branchId,
        receivedAt: report.receivedAt,
        receivedBy: report.receivedBy,
        supplierId: report.supplierId,
        purchaseOrderId: report.purchaseOrderId,
        invoiceNumber: report.invoiceNumber,
        items: items.map((it) => ({
            itemId: it.itemId,
            quantity: it.receivedQuantity,
            unitCost: it.unitCost,
            lineTotal: it.lineTotal,
            discrepancyType: it.discrepancyType,
        })),
        totalItems: items.length,
        notes: report.notes,
    };
}

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
    const idempotencyKey = validatedData.idempotencyKey ?? null;

    // Replay antes de cualquier escritura: si esta clave ya produjo una
    // recepción, se devuelve tal cual y no se vuelven a tocar lotes ni la OC.
    if (idempotencyKey) {
        const replay = await findReceivingByIdempotencyKey(companyId, idempotencyKey, branchId);
        if (replay) return replay;
    }

    // H07 — Pre-flight SIN escrituras: la lectura de temperatura es exigible
    // para refrigerados/congelados y su ausencia no es conformidad. Se valida
    // antes de crear el reporte para no dejar una recepción a medias. Los
    // ítems se cargan una sola vez y se reutilizan en el loop.
    const itemById = new Map<string, Awaited<ReturnType<typeof InventoryService.getItem>>>();
    for (const itemData of validatedData.items) {
        if (itemById.has(itemData.itemId)) continue;
        const item = await InventoryService.getItem(itemData.itemId);
        if (!item) {
            throw new Error(`Item not found: ${itemData.itemId}`);
        }
        itemById.set(itemData.itemId, item);
    }

    const canAuthorizeTemperatureException =
        !!actor.role && hasPermission(actor.role, "inventory", "update");
    if (
        !canAuthorizeTemperatureException &&
        validatedData.items.some((it) => it.temperatureExceptionReason)
    ) {
        throw new Error(
            "Sólo un usuario con permiso de inventario puede autorizar una excepción de temperatura."
        );
    }

    const missingReadings = missingTemperatureReadings(
        validatedData.items.map((it) => ({
            itemId: it.itemId,
            temperature: it.temperature,
            storageType: itemById.get(it.itemId)?.storageType ?? null,
            exceptionReason: it.temperatureExceptionReason ?? null,
        }))
    );
    if (missingReadings.length > 0) {
        const names = missingReadings
            .map((id) => itemById.get(id)?.name ?? id)
            .join(", ");
        throw new Error(
            `Falta la lectura de temperatura de: ${names}. Es obligatoria para productos refrigerados/congelados; captura la lectura o registra una excepción autorizada.`
        );
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

    // Efectos derivados/externos que se ejecutan DESPUÉS del commit: no forman
    // parte del núcleo inventariable, así que su fallo no revierte una recepción
    // ya confirmada (se registra para diagnóstico).
    const derivedEffects: Array<() => Promise<unknown>> = [];

    let report!: typeof receivingReports.$inferSelect;
    let receivingResults!: Array<{
        itemId: string;
        itemName: string;
        batchId: string;
        batchNumber: string | null;
        quantity: number;
        expirationDate: Date | null;
        movementId: string;
    }>;

    // Núcleo atómico: reporte, lotes, movimientos, líneas, avance de OC y
    // conciliación de factura en UNA transacción. Un fallo intermedio revierte
    // todo y no queda una recepción a medias.
    try {
        const committed = await db.transaction(async (tx) => {
            await InventoryService.ensureOpenPeriod(companyId, branchId, tx);

            const [created] = await tx.insert(receivingReports).values({
                companyId,
                branchId,
                supplierId: validatedData.supplierId || null,
                purchaseOrderId: validatedData.purchaseOrderId || null,
                invoiceNumber: validatedData.invoiceNumber || null,
                receivedBy: actor.user.id,
                notes: validatedData.notes || null,
                signatureUrl: validatedData.signatureUrl || null,
                photoUrls: validatedData.photoUrls || null,
                idempotencyKey,
            }).returning();

            let poItems: any[] = [];
            if (validatedData.purchaseOrderId) {
                poItems = await tx.select()
                    .from(purchaseOrderItems)
                    .where(eq(purchaseOrderItems.poId, validatedData.purchaseOrderId));
            }

            const results: typeof receivingResults = [];

            // Process each item in the receiving
            for (const itemData of validatedData.items) {
                const { itemId, unit, batchNumber, expirationDate, productionDate, temperature } = itemData;
                // quantity y unitCostCents se recalculan más abajo (conversión de unidad
                // / costo). El costo se maneja en centavos porque así se guarda en DB.
                let quantity: number = itemData.quantity;
                const enteredUnitCost = itemData.unitCost;
                let unitCostCents: number | null =
                    enteredUnitCost !== undefined ? Math.round(enteredUnitCost * 100) : null;

                // Item ya cargado y validado en el pre-flight.
                const item = itemById.get(itemId);
                if (!item) {
                    throw new Error(`Item not found: ${itemId}`);
                }

                // Unit conversion: if received unit differs from item base unit, convert
                if (unit && item.unit && unit !== item.unit) {
                    const convertedQty = await UnitConversionService.convert(quantity, unit, item.unit, companyId);
                    if (convertedQty !== null) {
                        // H07: el costo debe dividirse por el factor para que el valor
                        // total recibido se conserve.
                        const factor = quantity > 0 ? convertedQty / quantity : 1;
                        const converted = convertReceivedAmount({
                            quantity,
                            unitCostCents,
                            factor,
                        });
                        quantity = converted.quantity;
                        unitCostCents = converted.unitCostCents;
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

                        const costInCents = unitCostCents;
                        if (costInCents !== null && poItem.unitCost !== costInCents) {
                            discrepancyType = 'PRICE';
                        }
                    } else {
                        discrepancyType = 'SUBSTITUTION';
                    }
                }

                // Validación de temperatura por tipo de almacenamiento (loteprod §5.2):
                // congelado ≤ -18°C, refrigerado 0–4°C; fuera de rango = rechazo.
                const temperatureCheck = evaluateReceivingTemperaturePolicy(temperature, item.storageType ?? null);
                if (temperatureCheck.quarantined) {
                    discrepancyType = 'QUALITY';
                }

                // Costo final en centavos: el capturado (ya convertido a unidad base)
                // o, si no vino, el de la OC / último costo conocido del ítem.
                const finalUnitCostCents = unitCostCents ?? poUnitCost ?? item.lastCost ?? null;

                // Lote + movimiento en la misma transacción: el movimiento es el
                // único dueño del incremento del saldo.
                const { batch, movement } = await InventoryService.createReceivingBatch({
                    itemId,
                    branchId,
                    initialQuantity: String(quantity), // numeric(12,4): string en TS
                    lotNumber: batchNumber || `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    expirationDate: expirationDate ? new Date(expirationDate) : undefined,
                    productionDate: productionDate ? new Date(productionDate) : undefined,
                    supplierId: validatedData.supplierId || item.supplierId || null,
                    unitCost: finalUnitCostCents,
                    status: temperatureCheck.quarantined ? 'QUARANTINED' : 'AVAILABLE',
                    supplierBatchInfo: {
                        receivingReportId: created.id,
                        invoiceNumber: validatedData.invoiceNumber || null,
                        receivedBy: actor.user.id,
                        receivedAt: new Date().toISOString(),
                        notes: validatedData.notes,
                        temperature: temperature,
                        temperatureReadingMissing: temperatureCheck.missingReading,
                        temperatureExceptionReason: itemData.temperatureExceptionReason ?? null,
                    }
                }, {
                    branchId,
                    itemId,
                    type: 'RECEIVING',
                    quantityChange: quantity,
                    toLocationId: validatedData.storageLocationId,
                    reason: validatedData.notes || 'Receiving workflow',
                    performedBy: actor.user.id,
                }, tx);

                // Save report item in database
                await tx.insert(receivingReportItems).values({
                    receivingReportId: created.id,
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
                        actor.user.id,
                        tx
                    );
                }

                // Update lastCost of item (in-tx) y encolar la alerta de precio,
                // que es derivada y se ejecuta después del commit.
                if (finalUnitCostCents) {
                    await InventoryService.updateItem(itemId, {
                        lastCost: finalUnitCostCents,
                        supplierId: validatedData.supplierId || item.supplierId || undefined
                    }, actor.user.id, tx);

                    const costCents = finalUnitCostCents;
                    const alertSupplierId = validatedData.supplierId || item.supplierId || null;
                    derivedEffects.push(() => StockAlertService.checkPriceIncrease(
                        itemId,
                        costCents,
                        alertSupplierId,
                        companyId,
                        branchId,
                        actor.user.id
                    ));
                }

                // Registrar lectura térmica en temperature_logs (NOM-251) post-commit
                if (temperature !== undefined && temperature !== null && !Number.isNaN(temperature)) {
                    const tempValue = temperature;
                    const quarantined = temperatureCheck.quarantined;
                    const violation = temperatureCheck.violation;
                    const lotNumber = batch.lotNumber;
                    const itemName = item.name;
                    derivedEffects.push(() => db.insert(temperatureLogs).values({
                        branchId,
                        readingValue: Math.round(tempValue),
                        unit: 'C',
                        isCompliant: !quarantined,
                        captureMethod: 'RECEIVING',
                        capturedBy: actor.user.id,
                        notes: quarantined
                            ? `Rechazo NOM-251 en recepción: ${violation}. Lote en cuarentena: ${lotNumber}`
                            : `Lectura conforme NOM-251 en recepción de ${itemName} (${tempValue}°C)`,
                    }));
                }

                // Si la temperatura violó el rango: Incidente + Reclamo + Notificación, post-commit.
                if (temperatureCheck.quarantined) {
                    const violation = temperatureCheck.violation;
                    const incidentItemId = item.id;
                    const itemName = item.name;
                    const qty = quantity;
                    const lotNumber = batch.lotNumber;
                    const unitLabel = item.unit || 'uds';
                    const reportId = created.id;
                    const targetSupplierId = validatedData.supplierId || item.supplierId;
                    const totalAmount = finalUnitCostCents ? Math.round(quantity * finalUnitCostCents) : undefined;
                    const invoiceId = validatedData.invoiceId;
                    const tempValue = temperature;
                    const incidentSupplierId = validatedData.supplierId || item.supplierId;

                    derivedEffects.push(async () => {
                        await db.insert(incidents).values({
                            instanceId: uuidv4(),
                            stepId: `RECEIVING_QA_${incidentItemId}`,
                            branchId,
                            severity: 'WARNING',
                            status: 'DETECTED',
                            title: `Rechazo de Calidad: ${itemName} por Temperatura Fuera de Rango`,
                            description: `El producto ${itemName} fue recibido a ${tempValue}°C (${violation}). Lote mandado a cuarentena automáticamente.`,
                            detectedBy: actor.user.id,
                            metadata: {
                                itemId: incidentItemId,
                                quantity: qty,
                                recordedTemperature: tempValue,
                                supplierId: incidentSupplierId,
                            }
                        });

                        if (targetSupplierId) {
                            await SupplierClaimService.createClaim({
                                companyId,
                                branchId,
                                supplierId: targetSupplierId,
                                invoiceId,
                                type: 'QUALITY',
                                description: `Rechazo térmico NOM-251: ${itemName} recibido a ${tempValue}°C (${violation}). Lote ${lotNumber} (${qty} ${unitLabel}) puesto en CUARENTENA.`,
                                totalAmount,
                                notes: `Incidencia generada automáticamente desde Recepción de Mercancía (${reportId}).`,
                            }).catch((err) => console.error("Error creating automated supplier claim:", err));
                        }

                        const branchManagers = await db.select({ id: users.id })
                            .from(users)
                            .where(and(
                                eq(users.companyId, companyId),
                                sql`${users.role} IN ('ADMIN', 'GERENTE', 'DIRECTOR_OPS', 'OWNER')`
                            ));

                        for (const mgr of branchManagers) {
                            await NotificationDispatcher.sendNotification({
                                userId: mgr.id,
                                title: `🚨 Alerta NOM-251: Rechazo de Calidad (${itemName})`,
                                message: `El producto ${itemName} fue recibido a ${tempValue}°C (${violation}). Lote puesto en CUARENTENA y reclamo generado.`,
                                type: 'error',
                                eventType: 'incident',
                                actionUrl: `/dashboard/inventory/claims`,
                                metadata: {
                                    incidentTitle: `Alerta NOM-251: ${itemName}`,
                                    severity: 'CRITICAL',
                                    description: `Temperatura fuera de rango: ${tempValue}°C (${violation})`,
                                }
                            }).catch((err) => console.error("Error dispatching NOM-251 alert:", err));
                        }
                    });
                }

                results.push({
                    itemId,
                    itemName: item.name,
                    batchId: batch.id,
                    batchNumber: batch.lotNumber,
                    quantity,
                    expirationDate: batch.expirationDate,
                    movementId: movement.id,
                });
            }

            // If invoice is associated, run 3-way match (dentro de la transacción)
            if (validatedData.invoiceId) {
                await tx.update(invoices)
                    .set({
                        purchaseOrderId: validatedData.purchaseOrderId || null,
                        receivingReportId: created.id,
                        updatedAt: new Date()
                    })
                    .where(eq(invoices.id, validatedData.invoiceId));

                const invLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, validatedData.invoiceId));
                for (const itemData of validatedData.items) {
                    const line = invLines.find(l =>
                        (!l.itemId || l.itemId === itemData.itemId) &&
                        Math.abs(parseFloat(l.cantidad) - itemData.quantity) < 0.0001 &&
                        l.valorUnitario === Math.round((itemData.unitCost || 0) * 100)
                    );
                    if (line) {
                        await tx.update(invoiceLines)
                            .set({ itemId: itemData.itemId })
                            .where(eq(invoiceLines.id, line.id));
                    } else {
                        const fallbackLine = invLines.find(l => !l.itemId);
                        if (fallbackLine) {
                            await tx.update(invoiceLines)
                                .set({ itemId: itemData.itemId })
                                .where(eq(invoiceLines.id, fallbackLine.id));
                        }
                    }
                }

                if (validatedData.purchaseOrderId) {
                    const updatedLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, validatedData.invoiceId));
                    const parsedInvoiceItems = updatedLines
                        .filter(l => !!l.itemId)
                        .map(l => ({
                            itemId: l.itemId!,
                            quantity: parseFloat(l.cantidad),
                            unitCostCents: l.valorUnitario
                        }));

                    const matchResult = await InvoiceMatchingService.perform3WayMatch(
                        validatedData.purchaseOrderId,
                        created.id,
                        parsedInvoiceItems,
                        undefined,
                        tx
                    );

                    await tx.update(invoices)
                        .set({
                            matchStatus: matchResult.isPerfectMatch ? 'MATCHED' : 'DISCREPANCY',
                            hasPriceDiscrepancy: matchResult.priceDiscrepancy,
                            hasQtyDiscrepancy: matchResult.quantityDiscrepancy,
                            updatedAt: new Date()
                        })
                        .where(eq(invoices.id, validatedData.invoiceId));
                }
            }

            return { report: created, results };
        });

        report = committed.report;
        receivingResults = committed.results;
    } catch (error) {
        // Carrera de dos envíos simultáneos con la misma clave: el perdedor del
        // INSERT recupera la fila ganadora en vez de duplicar la recepción.
        if (idempotencyKey && isUniqueViolation(error)) {
            const replay = await findReceivingByIdempotencyKey(companyId, idempotencyKey, branchId);
            if (replay) return replay;
        }
        throw error;
    }

    // Efectos derivados/externos, ya con la recepción confirmada.
    for (const effect of derivedEffects) {
        try {
            await effect();
        } catch (err) {
            console.error("Error executing post-commit receiving effect:", err);
        }
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
