// lib/services/expiration-alert-service.ts
// Alertas escalonadas de caducidad — Task 2 del plan loteprod-gaps
// (manual operativo loteprod.md §5.4):
//   - Caduca en ≤48h  → notificación al gerente (planifica uso)
//   - Caduca en ≤24h  → urgente + sugerencia de uso/promoción
//   - Vencido sin usar → lote marcado EXPIRED (bloqueo FEFO automático:
//     el allocator solo toma status='AVAILABLE') + merma obligatoria
//
// Sin spam: el estado de notificación se persiste por (lote, ventana) en
// `inventory_expiration_alerts`; el cron cada 6h inserta con ON CONFLICT DO
// NOTHING y solo notifica si la fila es nueva. Notificaciones SIEMPRE vía
// NotificationDispatcher (preferencias por usuario), nunca Wasender directo.

import { db } from "@/lib/db";
import {
    inventoryBatches,
    inventoryItems,
    branches,
    users,
    inventoryExpirationAlerts,
} from "@/lib/db/schema";
import { and, eq, gt, inArray, isNotNull, lte, or, isNull, sql } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";

export type ExpirationWindow = "H48" | "H24" | "EXPIRED";

const HOUR_MS = 3_600_000;

/** Ventana de caducidad de un lote respecto a `now`.
 *  - `EXPIRED`: ya venció (fecha <= now)
 *  - `H24`: vence en ≤24h
 *  - `H48`: vence en ≤48h (y >24h)
 *  - null: fuera de las ventanas vigiladas (>48h)
 *  Los límites son inclusive hacia la ventana más urgente (exactamente 24h ⇒ H24). */
export function classifyExpirationWindow(
    expirationDate: Date,
    now: Date
): ExpirationWindow | null {
    const t = expirationDate.getTime();
    const n = now.getTime();
    if (t <= n) return "EXPIRED";
    if (t <= n + 48 * HOUR_MS) {
        return t <= n + 24 * HOUR_MS ? "H24" : "H48";
    }
    return null;
}

export interface ExpirationNotificationContent {
    severity: "MEDIA" | "ALTA" | "CRITICA";
    /** Mensaje en español listo para WhatsApp/email. */
    message: string;
}

/** Contenido de la notificación según la ventana (puro, testeable). */
export function buildExpirationNotification(
    window: ExpirationWindow,
    itemName: string,
    lotNumber: string | null,
    quantity: number,
    unit: string
): ExpirationNotificationContent {
    const lote = lotNumber ? ` (lote ${lotNumber})` : "";
    switch (window) {
        case "H48":
            return {
                severity: "MEDIA",
                message:
                    `⏳ *Caducidad próxima*\n` +
                    `Producto: ${itemName}${lote}\n` +
                    `Restante: ${quantity} ${unit}, vence en ≤48 horas.\n` +
                    `Planifica su uso (FEFO: este lote sale primero).`,
            };
        case "H24":
            return {
                severity: "ALTA",
                message:
                    `🟠 *URGENTE — vence en ≤24 horas*\n` +
                    `Producto: ${itemName}${lote}\n` +
                    `Restante: ${quantity} ${unit}.\n` +
                    `Úsalo hoy en promoción, degustación o consumo interno para evitar la merma.`,
            };
        case "EXPIRED":
            return {
                severity: "CRITICA",
                message:
                    `🔴 *Lote vencido — merma obligatoria*\n` +
                    `Producto: ${itemName}${lote} venció sin usarse.\n` +
                    `El lote quedó bloqueado (no sale en FEFO). Registra la merma para conciliar inventario.`,
            };
    }
}

export interface ExpirationRunSummary {
    batchesClassified: number;
    markedExpired: number;
    notificationsSent: number;
    notificationsFailed: number;
    /** Lotes que ya tenían su fila (lote, ventana): corrida repetida del cron. */
    alreadyNotified: number;
}

interface CandidateBatch {
    batchId: string;
    branchId: string;
    companyId: string;
    branchName: string;
    itemName: string;
    unit: string;
    lotNumber: string | null;
    currentQuantity: number;
    window: ExpirationWindow;
}

export class ExpirationAlertService {
    /**
     * Flujo principal invocado por el cron cada 6h (`cron-stock-check`).
     * Idempotente: una segunda corrida sobre los mismos datos no re-notifica
     * ni re-marca nada (único batch_id+window; update acotado a AVAILABLE).
     */
    static async processExpirationCutoffs(now: Date = new Date()): Promise<ExpirationRunSummary> {
        const summary: ExpirationRunSummary = {
            batchesClassified: 0,
            markedExpired: 0,
            notificationsSent: 0,
            notificationsFailed: 0,
            alreadyNotified: 0,
        };

        try {
            const cutoff = new Date(now.getTime() + 48 * HOUR_MS);

            // Lotes vigentes con stock que caen dentro de alguna ventana.
            // numeric(12,4) viaja como string: la comparación es SQL-side.
            const rows = await db
                .select({
                    batchId: inventoryBatches.id,
                    branchId: inventoryBatches.branchId,
                    companyId: branches.companyId,
                    branchName: branches.name,
                    itemName: inventoryItems.name,
                    unit: inventoryItems.unit,
                    lotNumber: inventoryBatches.lotNumber,
                    currentQuantity: inventoryBatches.currentQuantity,
                    expirationDate: inventoryBatches.expirationDate,
                })
                .from(inventoryBatches)
                .innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
                .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
                .where(
                    and(
                        eq(inventoryBatches.status, "AVAILABLE"),
                        gt(inventoryBatches.currentQuantity, "0"),
                        isNotNull(inventoryBatches.expirationDate),
                        lte(inventoryBatches.expirationDate, cutoff),
                        eq(branches.active, true)
                    )
                );

            const classified: CandidateBatch[] = [];
            for (const r of rows) {
                if (!r.expirationDate) continue;
                const window = classifyExpirationWindow(r.expirationDate, now);
                if (!window) continue;
                classified.push({
                    batchId: r.batchId,
                    branchId: r.branchId,
                    companyId: r.companyId,
                    branchName: r.branchName,
                    itemName: r.itemName,
                    unit: r.unit,
                    lotNumber: r.lotNumber,
                    currentQuantity: Number(r.currentQuantity),
                    window,
                });
            }
            summary.batchesClassified = classified.length;

            // §5.4: vencido sin usar → status=EXPIRED. El allocator FEFO filtra
            // status='AVAILABLE', así que con esto queda bloqueado automáticamente.
            const expiredIds = classified.filter(c => c.window === "EXPIRED").map(c => c.batchId);
            if (expiredIds.length > 0) {
                await db
                    .update(inventoryBatches)
                    .set({ status: "EXPIRED", updatedAt: new Date() })
                    .where(and(inArray(inventoryBatches.id, expiredIds), eq(inventoryBatches.status, "AVAILABLE")));
                summary.markedExpired = expiredIds.length;
            }

            // Notificación por (lote, ventana) con anti-duplicado persistido.
            // Managers por empresa se cachean dentro de la corrida.
            const managersByCompany = new Map<string, { id: string }[]>();

            for (const c of classified) {
                const inserted = await db
                    .insert(inventoryExpirationAlerts)
                    .values({
                        companyId: c.companyId,
                        branchId: c.branchId,
                        batchId: c.batchId,
                        window: c.window,
                    })
                    .onConflictDoNothing()
                    .returning({ id: inventoryExpirationAlerts.id });

                if (inserted.length === 0) {
                    // Ya notificado antes por esta ventana: no re-notificar.
                    summary.alreadyNotified++;
                    continue;
                }

                let managers = managersByCompany.get(c.companyId);
                if (!managers) {
                    // Gerencia de la sucursal o gerencia general (branchId null);
                    // mismos roles que usa StockAlertService para inventario.
                    managers = await db
                        .select({ id: users.id })
                        .from(users)
                        .where(
                            and(
                                eq(users.companyId, c.companyId),
                                sql`${users.role} IN ('ADMIN', 'GERENTE', 'SUPERVISOR')`,
                                or(eq(users.branchId, c.branchId), isNull(users.branchId))
                            )
                        );
                    managersByCompany.set(c.companyId, managers);
                }

                const content = buildExpirationNotification(
                    c.window,
                    c.itemName,
                    c.lotNumber,
                    c.currentQuantity,
                    c.unit
                );

                for (const manager of managers) {
                    try {
                        await NotificationDispatcher.sendInventoryAlert({
                            userId: manager.id,
                            eventType: "inventory_alert",
                            data: {
                                itemName: c.itemName,
                                currentStock: c.currentQuantity,
                                minLevel: 0,
                                severity: content.severity,
                                branchId: c.branchId,
                                message: content.message,
                            },
                        });
                        summary.notificationsSent++;
                    } catch (error) {
                        console.error(`[ExpirationAlert] Failed to notify ${manager.id}:`, error);
                        summary.notificationsFailed++;
                    }
                }
            }

            return summary;
        } catch (error) {
            console.error("[ExpirationAlert] Error processing expiration cutoffs:", error);
            return summary;
        }
    }

    /**
     * Lotes ya vencidos (status EXPIRED) que todavía cargan stock: la merma
     * obligatoria del §5.4 sigue sin registrarse. Al registrarla, la cantidad
     * baja a 0 y el lote pasa a DEPLETED, así que deja de contar aquí.
     */
    static async getExpiredWastePendingCount(
        companyId: string,
        branchId?: string | null
    ): Promise<number> {
        try {
            const rows = await db
                .select({ count: sql<number>`count(*)` })
                .from(inventoryBatches)
                .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
                .where(
                    and(
                        eq(branches.companyId, companyId),
                        eq(inventoryBatches.status, "EXPIRED"),
                        gt(inventoryBatches.currentQuantity, "0"),
                        ...(branchId ? [eq(inventoryBatches.branchId, branchId)] : [])
                    )
                );
            return rows[0]?.count || 0;
        } catch (error) {
            console.error("[ExpirationAlert] Error counting expired waste pending:", error);
            return 0;
        }
    }
}
