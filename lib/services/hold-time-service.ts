// lib/services/hold-time-service.ts
//
// Task 5 (plan-loteprod-gaps §6.4): ciclo de vencimiento del tiempo de
// retención en línea. Task 4 dejó `production_results.expires_at` calculado;
// aquí se vigila.
//
// Tres caminos, una sola merma por tanda (A9, único parcial sobre
// `inventory_waste.production_result_id`):
//   1. El cron avisa al turno cuando una tanda vence (una vez por tanda).
//   2. El turno confirma cuánto se tiró → merma HOLD_TIME `origin='hold_time'`.
//      Cantidad 0 es una respuesta válida: "venció en el sistema pero se
//      vendió"; cierra la tanda sin inventar una merma.
//   3. Si nadie confirma dentro de la gracia, el cron cierra la tanda completa
//      con `origin='hold_time_auto'` (§7, 21:00: "mermas de retención
//      registradas"). Sin esto la varianza del día se queda corta justo cuando
//      la línea estuvo desatendida.
//
// La merma HOLD_TIME NO descuenta lotes ni escribe `inventory_movements`: el
// producto terminado nunca entró a inventario (la producción descuenta insumos
// y no crea lote de salida). Es pérdida de costo, no movimiento de stock.

import { db } from "@/lib/db";
import {
    productionResults,
    recipes,
    branches,
    users,
    shiftSessions,
    inventoryWaste,
} from "@/lib/db/schema";
import { and, eq, isNull, isNotNull, inArray, or, sql } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";
import {
    buildHoldTimeAlert,
    classifyHoldStatus,
    holdTimeLossCents,
    minutesOverdue,
    minutesRemaining,
    shouldAutoRegisterWaste,
    validateHoldTimeDiscard,
    HOLD_TIME_AUTO_WASTE_GRACE_MINUTES,
    HOLD_TIME_ORIGIN_AUTO,
    HOLD_TIME_ORIGIN_CONFIRMED,
    HOLD_TIME_WARNING_MINUTES,
    type HoldTimeDiscardErrorCode,
    type HoldTimeStatus,
} from "@/lib/inventory/hold-time";

/**
 * "Ahora" del servidor, pedido como UNA COLUMNA MÁS de cada select que lee
 * `expires_at`. No es un capricho: `expires_at` es `timestamp` sin zona y el
 * driver lo convierte a Date con su propia convención, así que el único `now`
 * comparable con él es uno que haya pasado por ESE mismo parser.
 *
 * Las alternativas obvias fallan y ya se midieron contra dev:
 *  - `new Date()` compara el reloj local (CST) contra valores del servidor.
 *  - `db.execute(sql`select now()::timestamp`)` devuelve un STRING, y
 *    `new Date("2026-08-26 16:30:25")` lo interpreta como hora local mientras
 *    Drizzle interpreta la columna como UTC (le concatena `+0000`): 6 horas de
 *    diferencia, con las que el cron daba por vencida hasta una tanda con 15
 *    minutos por delante.
 *  - `sql<Date>` a secas tampoco basta: el tipo es una promesa de TypeScript,
 *    no una conversión — el valor sigue llegando como string.
 *
 * `mapWith(productionResults.expiresAt)` reusa el mapper de esa misma columna,
 * así que el marco coincide por construcción y no por coincidencia.
 */
const DB_NOW = sql`now()::timestamp`.mapWith(productionResults.expiresAt);

export interface HoldTimeRunSummary {
    /** Tandas vencidas sin cerrar encontradas en la corrida. */
    expiredPending: number;
    /** Sucursales a las que se avisó en esta corrida. */
    branchesNotified: number;
    notificationsSent: number;
    notificationsFailed: number;
    /** Tandas que ya se habían avisado antes: corrida repetida del cron. */
    alreadyNotified: number;
    /** Tandas cerradas por el cron pasada la gracia. */
    autoDiscarded: number;
    /** Cierres automáticos que el único parcial rechazó (ya había merma). */
    autoDiscardSkipped: number;
}

interface PendingBatchRow {
    id: string;
    companyId: string;
    branchId: string;
    branchName: string;
    recipeId: string;
    recipeName: string;
    producedQuantity: number;
    unit: string;
    ingredientCost: number | null;
    expiresAt: Date;
    notifiedAt: Date | null;
}

export interface HoldTimeBoardLine {
    id: string;
    recipeId: string;
    recipeName: string;
    producedQuantity: number;
    unit: string;
    holdTimeMinutes: number | null;
    status: Exclude<HoldTimeStatus, "OK">;
    minutesOverdue: number;
    minutesRemaining: number;
    /** Ya se avisó al turno por esta tanda. */
    notified: boolean;
    /** Pérdida si se tira completa, en centavos (null sin costo de insumos). */
    estimatedLossCents: number | null;
}

export class HoldTimeService {
    /**
     * Tandas vencidas sin cerrar, con lo necesario para avisar y costear.
     * Devuelve también el `now` del servidor leído en la MISMA consulta, para
     * que las comparaciones posteriores usen su mismo marco (ver `DB_NOW`).
     */
    private static async selectExpiredPending(): Promise<{
        rows: PendingBatchRow[];
        dbNow: Date;
    }> {
        const rows = await db
            .select({
                dbNow: DB_NOW,
                id: productionResults.id,
                companyId: productionResults.companyId,
                branchId: productionResults.branchId,
                branchName: branches.name,
                recipeId: productionResults.recipeId,
                recipeName: recipes.name,
                producedQuantity: productionResults.producedQuantity,
                unit: productionResults.unit,
                ingredientCost: productionResults.ingredientCost,
                expiresAt: productionResults.expiresAt,
                notifiedAt: productionResults.holdAlertNotifiedAt,
            })
            .from(productionResults)
            .innerJoin(recipes, eq(productionResults.recipeId, recipes.id))
            .innerJoin(branches, eq(productionResults.branchId, branches.id))
            .where(
                and(
                    isNotNull(productionResults.expiresAt),
                    isNull(productionResults.discardedAt),
                    // Comparación SQL-side: el filtro no depende del reloj del proceso.
                    sql`${productionResults.expiresAt} <= now()`,
                    eq(branches.active, true)
                )
            );

        return {
            // Sin filas el `now` no se usa (el llamador sale antes); el default
            // sólo evita un undefined viajando por la firma.
            dbNow: (rows[0]?.dbNow as Date) ?? new Date(),
            rows: rows.map(({ dbNow, ...r }) => ({
                ...r,
                expiresAt: r.expiresAt as Date,
                producedQuantity: Number(r.producedQuantity),
                ingredientCost: r.ingredientCost === null ? null : Number(r.ingredientCost),
            })),
        };
    }

    /**
     * Flujo del cron. Idempotente en los dos lados: la notificación se reclama
     * con un UPDATE ... WHERE hold_alert_notified_at IS NULL RETURNING (atómico,
     * sin check-then-act) y el cierre automático depende del único parcial de
     * `inventory_waste.production_result_id`.
     */
    static async processHoldTimeExpirations(nowOverride?: Date): Promise<HoldTimeRunSummary> {
        const summary: HoldTimeRunSummary = {
            expiredPending: 0,
            branchesNotified: 0,
            notificationsSent: 0,
            notificationsFailed: 0,
            alreadyNotified: 0,
            autoDiscarded: 0,
            autoDiscardSkipped: 0,
        };

        try {
            const { rows: pending, dbNow } = await this.selectExpiredPending();
            const now = nowOverride ?? dbNow;
            summary.expiredPending = pending.length;
            if (pending.length === 0) return summary;

            // --- 1. Aviso al turno, una vez por tanda ---------------------------
            const unnotified = pending.filter((p) => !p.notifiedAt);
            summary.alreadyNotified = pending.length - unnotified.length;

            if (unnotified.length > 0) {
                const claimed = await db
                    .update(productionResults)
                    .set({ holdAlertNotifiedAt: sql`now()` as any, updatedAt: new Date() })
                    .where(
                        and(
                            inArray(
                                productionResults.id,
                                unnotified.map((p) => p.id)
                            ),
                            isNull(productionResults.holdAlertNotifiedAt)
                        )
                    )
                    .returning({ id: productionResults.id });

                const claimedIds = new Set(claimed.map((c) => c.id));
                // Lo que otra corrida se llevó entre el SELECT y el UPDATE no se
                // notifica aquí: ya lo notificó ella.
                summary.alreadyNotified += unnotified.length - claimedIds.size;

                const byBranch = new Map<string, PendingBatchRow[]>();
                for (const p of unnotified) {
                    if (!claimedIds.has(p.id)) continue;
                    const list = byBranch.get(p.branchId) ?? [];
                    list.push(p);
                    byBranch.set(p.branchId, list);
                }

                for (const [branchId, lines] of byBranch) {
                    const alert = buildHoldTimeAlert(
                        lines[0].branchName,
                        lines.map((l) => ({
                            recipeName: l.recipeName,
                            quantity: l.producedQuantity,
                            unit: l.unit,
                            minutesOverdue: minutesOverdue(l.expiresAt, now),
                        }))
                    );

                    const recipients = await this.resolveShiftRecipients(
                        lines[0].companyId,
                        branchId
                    );
                    if (recipients.length > 0) summary.branchesNotified++;

                    for (const userId of recipients) {
                        try {
                            await NotificationDispatcher.sendInventoryAlert({
                                userId,
                                eventType: "inventory_alert",
                                data: {
                                    itemName: lines.map((l) => l.recipeName).join(", "),
                                    currentStock: lines.reduce((s, l) => s + l.producedQuantity, 0),
                                    minLevel: 0,
                                    severity: alert.severity,
                                    branchId,
                                    message: alert.message,
                                },
                            });
                            summary.notificationsSent++;
                        } catch (error) {
                            console.error(`[HoldTime] Failed to notify ${userId}:`, error);
                            summary.notificationsFailed++;
                        }
                    }
                }
            }

            // --- 2. Cierre automático pasada la gracia --------------------------
            for (const p of pending) {
                if (!shouldAutoRegisterWaste(p.expiresAt, now)) continue;
                const written = await this.writeHoldTimeDiscard({
                    result: p,
                    discardedQuantity: p.producedQuantity,
                    recordedBy: null,
                    origin: HOLD_TIME_ORIGIN_AUTO,
                    notes:
                        `Cierre automático: venció hace ${minutesOverdue(p.expiresAt, now)} min ` +
                        `sin confirmación del turno (gracia ${HOLD_TIME_AUTO_WASTE_GRACE_MINUTES} min).`,
                });
                if (written.created) summary.autoDiscarded++;
                else summary.autoDiscardSkipped++;
            }

            return summary;
        } catch (error) {
            console.error("[HoldTime] Error processing hold time expirations:", error);
            return summary;
        }
    }

    /**
     * A quién avisar: quien está de turno en la sucursal ahora mismo (sesión
     * ACTIVE sin check-out). Sin nadie fichado, cae en la gerencia de esa
     * sucursal o general — mismo criterio que las alertas de caducidad (§5.4);
     * el producto se tira igual y alguien tiene que enterarse.
     */
    private static async resolveShiftRecipients(
        companyId: string,
        branchId: string
    ): Promise<string[]> {
        const onShift = await db
            .select({ id: shiftSessions.userId })
            .from(shiftSessions)
            .where(
                and(
                    eq(shiftSessions.branchId, branchId),
                    eq(shiftSessions.status, "ACTIVE"),
                    isNull(shiftSessions.checkOutTime)
                )
            );
        if (onShift.length > 0) return [...new Set(onShift.map((s) => s.id))];

        const managers = await db
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.companyId, companyId),
                    sql`${users.role} IN ('ADMIN', 'GERENTE', 'SUPERVISOR')`,
                    or(eq(users.branchId, branchId), isNull(users.branchId))
                )
            );
        return managers.map((m) => m.id);
    }

    /**
     * Escritura única del descarte: merma + cierre de la tanda en una
     * transacción. `created: false` significa que el único parcial ya tenía la
     * merma de esa tanda — segunda corrida del cron o doble clic del turno.
     */
    private static async writeHoldTimeDiscard(params: {
        result: PendingBatchRow;
        discardedQuantity: number;
        recordedBy: string | null;
        origin: string;
        notes: string | null;
    }): Promise<{ created: boolean; wasteId: string | null }> {
        const { result, discardedQuantity, recordedBy, origin, notes } = params;

        return db.transaction(async (tx) => {
            // Cantidad 0 = se vendió: se cierra la tanda sin fila de merma.
            if (discardedQuantity <= 0) {
                const closed = await tx
                    .update(productionResults)
                    .set({
                        discardedAt: sql`now()` as any,
                        discardedQuantity: "0",
                        discardedBy: recordedBy,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(productionResults.id, result.id),
                            isNull(productionResults.discardedAt)
                        )
                    )
                    .returning({ id: productionResults.id });
                return { created: closed.length > 0, wasteId: null };
            }

            const { costPerUnitCents, totalLossCents } = holdTimeLossCents({
                ingredientCost: result.ingredientCost,
                producedQuantity: result.producedQuantity,
                discardedQuantity,
            });

            const [waste] = await tx
                .insert(inventoryWaste)
                .values({
                    companyId: result.companyId,
                    branchId: result.branchId,
                    batchId: null,
                    // Producto terminado: no hay insumo que señalar (ver schema).
                    itemId: null,
                    productionResultId: result.id,
                    recipeId: result.recipeId,
                    quantity: String(discardedQuantity),
                    unit: result.unit,
                    reason: "HOLD_TIME",
                    costPerUnit: costPerUnitCents,
                    totalLoss: totalLossCents,
                    // HOLD_TIME no es consumo interno: nace AUTO y cuenta como
                    // merma real desde el primer momento (no pasa por §8.1).
                    approvalStatus: "AUTO",
                    origin,
                    recordedBy: recordedBy ?? "system",
                    recordedAt: new Date(),
                    notes,
                })
                .onConflictDoNothing()
                .returning({ id: inventoryWaste.id });

            if (!waste) return { created: false, wasteId: null };

            await tx
                .update(productionResults)
                .set({
                    discardedAt: sql`now()` as any,
                    discardedQuantity: String(discardedQuantity),
                    discardedBy: recordedBy,
                    updatedAt: new Date(),
                })
                .where(eq(productionResults.id, result.id));

            return { created: true, wasteId: waste.id };
        });
    }

    /**
     * Confirmación del turno (§6.4). Devuelve el código de error de
     * `validateHoldTimeDiscard` en vez de lanzar, para que la ruta lo traduzca
     * a un `details.code` estable como el resto del módulo de mermas.
     */
    static async confirmDiscard(params: {
        companyId: string;
        branchId: string;
        resultId: string;
        discardedQuantity: number;
        recordedBy: string;
        notes?: string | null;
    }): Promise<
        | { ok: true; wasteId: string | null; discardedQuantity: number }
        | { ok: false; code: HoldTimeDiscardErrorCode; message: string }
    > {
        const [row] = await db
            .select({
                dbNow: DB_NOW,
                id: productionResults.id,
                companyId: productionResults.companyId,
                branchId: productionResults.branchId,
                branchName: branches.name,
                recipeId: productionResults.recipeId,
                recipeName: recipes.name,
                producedQuantity: productionResults.producedQuantity,
                unit: productionResults.unit,
                ingredientCost: productionResults.ingredientCost,
                expiresAt: productionResults.expiresAt,
                discardedAt: productionResults.discardedAt,
                notifiedAt: productionResults.holdAlertNotifiedAt,
            })
            .from(productionResults)
            .innerJoin(recipes, eq(productionResults.recipeId, recipes.id))
            .innerJoin(branches, eq(productionResults.branchId, branches.id))
            .where(
                and(
                    eq(productionResults.id, params.resultId),
                    // Scope de tenant y sucursal en el WHERE: una tanda de otra
                    // empresa es "no encontrada", no "prohibida" (no filtrar).
                    eq(productionResults.companyId, params.companyId),
                    eq(productionResults.branchId, params.branchId)
                )
            )
            .limit(1);

        if (!row) {
            return { ok: false, code: "RESULT_NOT_FOUND", message: "No se encontró la tanda" };
        }

        const check = validateHoldTimeDiscard({
            expiresAt: row.expiresAt,
            discardedAt: row.discardedAt,
            producedQuantity: Number(row.producedQuantity),
            discardedQuantity: params.discardedQuantity,
            now: row.dbNow as Date,
        });
        if (!check.ok) {
            return { ok: false, code: check.code!, message: check.message! };
        }

        const written = await this.writeHoldTimeDiscard({
            result: {
                ...row,
                expiresAt: row.expiresAt as Date,
                producedQuantity: Number(row.producedQuantity),
                ingredientCost: row.ingredientCost === null ? null : Number(row.ingredientCost),
            },
            discardedQuantity: params.discardedQuantity,
            recordedBy: params.recordedBy,
            origin: HOLD_TIME_ORIGIN_CONFIRMED,
            notes: params.notes ?? null,
        });

        if (!written.created) {
            // Perdió una carrera contra el cron o contra otro doble clic.
            return { ok: false, code: "ALREADY_DISCARDED", message: "Esta tanda ya se cerró" };
        }

        return { ok: true, wasteId: written.wasteId, discardedQuantity: params.discardedQuantity };
    }

    /**
     * Tablero "en línea" de la sucursal: lo que está por vencer y lo que ya
     * venció sin tirarse. Devuelve minutos relativos, no fechas absolutas: la
     * cuenta la hace el servidor contra su propio reloj y así la UI no vuelve a
     * caer en la mezcla de husos.
     */
    static async getBoard(params: {
        companyId: string;
        branchId: string;
        /** Horizonte de "por vencer" en minutos. */
        warningMinutes?: number;
    }): Promise<{
        expiringSoon: HoldTimeBoardLine[];
        expired: HoldTimeBoardLine[];
        graceMinutes: number;
    }> {
        const warningMinutes = params.warningMinutes ?? HOLD_TIME_WARNING_MINUTES;

        const rows = await db
            .select({
                dbNow: DB_NOW,
                id: productionResults.id,
                recipeId: productionResults.recipeId,
                recipeName: recipes.name,
                producedQuantity: productionResults.producedQuantity,
                unit: productionResults.unit,
                ingredientCost: productionResults.ingredientCost,
                expiresAt: productionResults.expiresAt,
                notifiedAt: productionResults.holdAlertNotifiedAt,
                holdTimeMinutes: recipes.holdTimeMinutes,
            })
            .from(productionResults)
            .innerJoin(recipes, eq(productionResults.recipeId, recipes.id))
            .where(
                and(
                    eq(productionResults.companyId, params.companyId),
                    eq(productionResults.branchId, params.branchId),
                    isNotNull(productionResults.expiresAt),
                    isNull(productionResults.discardedAt)
                )
            )
            .orderBy(productionResults.expiresAt);

        const now = (rows[0]?.dbNow as Date) ?? new Date();
        const expiringSoon: HoldTimeBoardLine[] = [];
        const expired: HoldTimeBoardLine[] = [];

        for (const r of rows) {
            const expiresAt = r.expiresAt as Date;
            const status = classifyHoldStatus(expiresAt, now, warningMinutes);
            if (status === null || status === "OK") continue;

            const producedQuantity = Number(r.producedQuantity);
            const line: HoldTimeBoardLine = {
                id: r.id,
                recipeId: r.recipeId,
                recipeName: r.recipeName,
                producedQuantity,
                unit: r.unit,
                holdTimeMinutes: r.holdTimeMinutes,
                status,
                minutesOverdue: minutesOverdue(expiresAt, now),
                minutesRemaining: minutesRemaining(expiresAt, now),
                notified: r.notifiedAt !== null,
                estimatedLossCents: holdTimeLossCents({
                    ingredientCost: r.ingredientCost === null ? null : Number(r.ingredientCost),
                    producedQuantity,
                    discardedQuantity: producedQuantity,
                }).totalLossCents,
            };

            if (status === "EXPIRED") expired.push(line);
            else expiringSoon.push(line);
        }

        return { expiringSoon, expired, graceMinutes: HOLD_TIME_AUTO_WASTE_GRACE_MINUTES };
    }

    /**
     * Contadores para el dashboard de inventario: "en línea por vencer" vs
     * "vencidos sin tirar". Sin `branchId` cuenta toda la empresa.
     */
    static async getCounts(
        companyId: string,
        branchId?: string | null,
        warningMinutes: number = HOLD_TIME_WARNING_MINUTES
    ): Promise<{ expiringSoon: number; expiredPending: number }> {
        try {
            // Los dos cortes se resuelven SQL-side contra `now()` del servidor.
            const [row] = await db
                .select({
                    expiringSoon: sql<number>`count(*) filter (
                        where ${productionResults.expiresAt} > now()
                          and ${productionResults.expiresAt} <= now() + (${warningMinutes} || ' minutes')::interval
                    )`,
                    expiredPending: sql<number>`count(*) filter (
                        where ${productionResults.expiresAt} <= now()
                    )`,
                })
                .from(productionResults)
                .where(
                    and(
                        eq(productionResults.companyId, companyId),
                        isNotNull(productionResults.expiresAt),
                        isNull(productionResults.discardedAt),
                        ...(branchId ? [eq(productionResults.branchId, branchId)] : [])
                    )
                );

            // count() vuelve como string desde el driver: coaccionar siempre.
            return {
                expiringSoon: Number(row?.expiringSoon ?? 0),
                expiredPending: Number(row?.expiredPending ?? 0),
            };
        } catch (error) {
            console.error("[HoldTime] Error counting hold time batches:", error);
            return { expiringSoon: 0, expiredPending: 0 };
        }
    }
}
