// lib/services/prep-list-service.ts
//
// Task 6 (plan-loteprod-gaps §6.2): Hoja de Producción Diaria (prep list).
//
// El manual pide una hoja POR ESTACIÓN con «Preparación | Cant. a producir |
// Lote a usar (FEFO) | Turno | Responsable | Hora límite | Estatus». Las cuatro
// columnas nuevas viven en `production_orders` (migración 0073); aquí se arma la
// hoja y se completa una línea.
//
// Dos decisiones que conviene leer antes de tocar esto:
//
// 1. EL DÍA ES UNA FECHA DE CALENDARIO, no un rango de timestamps.
//    `production_orders.planned_date` se escribe desde un `<input type="date">`
//    ("2026-08-26" → medianoche UTC), así que un rango calculado con la zona de
//    la sucursal (`localDayRangeUtc`) dejaría fuera justo las órdenes del día en
//    cualquier huso al oeste de UTC. Se compara `planned_date::date` contra la
//    fecha pedida y se acabó.
//
// 2. LA HORA LÍMITE SÍ ES HORA LOCAL DE LA SUCURSAL. `deadline_time` es un
//    `time` sin zona — una hora de pared. El "ahora" contra el que se compara
//    sale de `localMoment(new Date(), branch.timezone).minutesOfDay`, la misma
//    forma que usa el tablero de hoy. Con el reloj del servidor, la hoja de
//    Tijuana aparecería atrasada dos horas antes de tiempo.
//
// La vista previa FEFO no bloquea ni escribe nada: reparte el stock actual entre
// las líneas abiertas EN EL ORDEN EN QUE SE MUESTRAN, para que dos líneas del
// mismo insumo no anuncien las dos el mismo lote. El descuento de verdad lo hace
// `produceRecipeWithFefo` al completar la línea, con `FOR UPDATE` dentro de la
// transacción.

import { db } from "@/lib/db";
import {
    branches,
    inventoryBatches,
    inventoryItems,
    productionOrders,
    recipes,
    users,
} from "@/lib/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
    derivePrepLineState,
    groupByStation,
    normalizeDeadlineTime,
    type PrepLineState,
    type PrepStationGroup,
} from "@/lib/inventory/prep-list";
import { localDateString, localMoment, parseTimeOfDay } from "@/lib/workflows/today";
import { expandRecipeLeaves, produceRecipeWithFefo, type LeafCache } from "./recipe-production";
import { createChildLogger } from "@/lib/logger";

const logger = createChildLogger("services:prep-list");

/** Lote FEFO que consumirá una línea al producirse. Es una previsión, no una reserva. */
export interface PrepFefoPreview {
    itemId: string;
    itemName: string;
    /** Cantidad bruta que pide la línea (con `baseYield` y `yieldPercent` aplicados). */
    requiredQuantity: number;
    unit: string;
    batchId: string | null;
    lotNumber: string | null;
    expirationDate: Date | null;
    /** Lo que ese lote alcanza a cubrir de la línea. */
    allocatedQuantity: number;
    /** Lo que ningún lote cubre. > 0 = la línea nace corta de insumo. */
    shortfall: number;
}

export interface PrepListLine {
    id: string;
    recipeId: string;
    recipeName: string;
    plannedQuantity: number;
    unit: string;
    station: string | null;
    shift: string | null;
    responsibleUserId: string | null;
    responsibleName: string | null;
    /** "HH:MM" — hora de pared de la sucursal. */
    deadlineTime: string | null;
    notes: string | null;
    /** Estatus crudo de la orden (PLANNED/IN_PROGRESS/COMPLETED/CANCELLED). */
    status: string;
    /** Estatus de la hoja, ya cruzado con la hora límite. */
    state: PrepLineState;
    completedAt: Date | null;
    completedByName: string | null;
    /** §6.4: minutos que el producto aguanta en línea una vez producido. */
    holdTimeMinutes: number | null;
    fefo: PrepFefoPreview[];
}

export interface PrepListDay {
    /** Fecha de la hoja, "YYYY-MM-DD" en la zona de la sucursal. */
    date: string;
    timezone: string;
    /** Minutos del día locales usados para clasificar; útil para depurar husos. */
    nowMinutes: number;
    totals: { total: number; done: number; pending: number; overdue: number };
    groups: PrepStationGroup<PrepListLine>[];
}

export type PrepListErrorCode =
    | "ORDER_NOT_FOUND"
    | "ALREADY_COMPLETED"
    | "ORDER_CANCELLED"
    | "INVALID_QUANTITY"
    | "RECIPE_WITHOUT_ITEMS";

export class PrepListError extends Error {
    constructor(public code: PrepListErrorCode, message: string) {
        super(message);
        this.name = "PrepListError";
    }
}

interface BatchCursor {
    batchId: string;
    lotNumber: string | null;
    expirationDate: Date | null;
    remaining: number;
}

export class PrepListService {

    /**
     * Hoja del día. `date` es "YYYY-MM-DD"; sin ella, hoy en la zona de la
     * sucursal.
     */
    static async getPrepList(params: {
        companyId: string;
        branchId: string;
        date?: string | null;
    }): Promise<PrepListDay> {
        const [branch] = await db
            .select({ timezone: branches.timezone })
            .from(branches)
            .where(eq(branches.id, params.branchId))
            .limit(1);

        const timezone = branch?.timezone || "America/Mexico_City";
        const now = new Date();
        const date = params.date || localDateString(now, timezone);
        const nowMinutes = localMoment(now, timezone).minutesOfDay;

        const rows = await db
            .select({
                id: productionOrders.id,
                recipeId: productionOrders.recipeId,
                recipeName: recipes.name,
                holdTimeMinutes: recipes.holdTimeMinutes,
                plannedQuantity: productionOrders.plannedQuantity,
                unit: productionOrders.unit,
                station: productionOrders.station,
                shift: productionOrders.shift,
                responsibleUserId: productionOrders.responsibleUserId,
                deadlineTime: productionOrders.deadlineTime,
                notes: productionOrders.notes,
                status: productionOrders.status,
                completedAt: productionOrders.completedAt,
                completedBy: productionOrders.completedBy,
            })
            .from(productionOrders)
            .leftJoin(recipes, eq(productionOrders.recipeId, recipes.id))
            .where(and(
                eq(productionOrders.companyId, params.companyId),
                eq(productionOrders.branchId, params.branchId),
                // Ver nota 1 del encabezado: fecha de calendario, no rango.
                sql`${productionOrders.plannedDate}::date = ${date}::date`,
            ))
            .orderBy(asc(productionOrders.deadlineTime), asc(productionOrders.createdAt));

        // Nombres de responsable y de quien cerró, en una sola consulta.
        const userIds = [...new Set(
            rows.flatMap(r => [r.responsibleUserId, r.completedBy]).filter((id): id is string => !!id)
        )];
        const nameById = new Map<string, string>();
        if (userIds.length > 0) {
            const people = await db
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(inArray(users.id, userIds));
            for (const p of people) nameById.set(p.id, p.name || "");
        }

        const lines: PrepListLine[] = rows.map((r) => {
            const deadlineTime = normalizeDeadlineTime(r.deadlineTime) ?? null;
            return {
                id: r.id,
                recipeId: r.recipeId,
                recipeName: r.recipeName || "Receta eliminada",
                plannedQuantity: r.plannedQuantity,
                unit: r.unit,
                station: r.station,
                shift: r.shift,
                responsibleUserId: r.responsibleUserId,
                responsibleName: r.responsibleUserId ? nameById.get(r.responsibleUserId) || null : null,
                deadlineTime,
                notes: r.notes,
                status: r.status,
                state: derivePrepLineState(r.status, parseTimeOfDay(deadlineTime), nowMinutes),
                completedAt: r.completedAt,
                completedByName: r.completedBy ? nameById.get(r.completedBy) || null : null,
                holdTimeMinutes: r.holdTimeMinutes ?? null,
                fefo: [],
            };
        });

        const groups = groupByStation(lines);
        await attachFefoPreview(params.companyId, params.branchId, groups);

        const totals = groups.reduce(
            (acc, g) => ({
                total: acc.total + g.total,
                done: acc.done + g.done,
                pending: acc.pending + g.pending,
                overdue: acc.overdue + g.overdue,
            }),
            { total: 0, done: 0, pending: 0, overdue: 0 },
        );

        return { date, timezone, nowMinutes, totals, groups };
    }

    /**
     * Crea una línea de la hoja. Es `ProductionService.createOrder` más las
     * columnas de §6.2; la validación de la hora límite es de aquí porque el
     * formato "HH:MM" es de la hoja, no de la orden.
     */
    static async createLine(data: {
        companyId: string;
        branchId: string;
        recipeId: string;
        plannedQuantity: number;
        unit: string;
        plannedDate: Date;
        station?: string | null;
        shift?: string | null;
        responsibleUserId?: string | null;
        deadlineTime?: string | null;
        notes?: string | null;
        createdBy: string;
    }) {
        const [order] = await db.insert(productionOrders).values({
            companyId: data.companyId,
            branchId: data.branchId,
            recipeId: data.recipeId,
            plannedQuantity: data.plannedQuantity,
            unit: data.unit,
            plannedDate: data.plannedDate,
            station: data.station ?? null,
            shift: (data.shift ?? null) as typeof productionOrders.$inferInsert["shift"],
            responsibleUserId: data.responsibleUserId ?? null,
            deadlineTime: data.deadlineTime ?? null,
            notes: data.notes ?? null,
            createdBy: data.createdBy,
        }).returning();
        return order;
    }

    /** Edita las columnas de la hoja sin tocar la producción ya registrada. */
    static async updateLine(params: {
        companyId: string;
        branchId: string;
        orderId: string;
        patch: {
            station?: string | null;
            shift?: string | null;
            responsibleUserId?: string | null;
            deadlineTime?: string | null;
            plannedQuantity?: number;
            notes?: string | null;
        };
    }) {
        const [updated] = await db.update(productionOrders)
            .set({ ...params.patch, updatedAt: new Date() } as Partial<typeof productionOrders.$inferInsert>)
            .where(and(
                eq(productionOrders.id, params.orderId),
                eq(productionOrders.companyId, params.companyId),
                eq(productionOrders.branchId, params.branchId),
            ))
            .returning();
        if (!updated) throw new PrepListError("ORDER_NOT_FOUND", "La línea no existe en esta sucursal");
        return updated;
    }

    /**
     * Completa una línea: dispara la producción REAL (explosión de receta →
     * FEFO → `recordProduction` → merma por lote insuficiente) y marca la orden
     * como hecha, todo en una transacción.
     *
     * El bloqueo `FOR UPDATE` sobre la orden es lo que hace que dos cocineros
     * tocando el mismo checkbox no produzcan dos veces: el segundo espera, lee
     * `COMPLETED` y recibe `ALREADY_COMPLETED` en vez de descontar el lote otra
     * vez. La idempotencia por `workflow_instance_id` no aplica aquí — esta
     * producción no nace de un workflow.
     */
    static async completeLine(params: {
        companyId: string;
        branchId: string;
        orderId: string;
        userId: string;
        /** Lo realmente producido; sin ella, la cantidad planeada. */
        producedQuantity?: number;
        notes?: string | null;
    }) {
        return db.transaction(async (tx) => {
            const [order] = await tx
                .select({
                    id: productionOrders.id,
                    recipeId: productionOrders.recipeId,
                    plannedQuantity: productionOrders.plannedQuantity,
                    unit: productionOrders.unit,
                    status: productionOrders.status,
                    station: productionOrders.station,
                })
                .from(productionOrders)
                .where(and(
                    eq(productionOrders.id, params.orderId),
                    eq(productionOrders.companyId, params.companyId),
                    eq(productionOrders.branchId, params.branchId),
                ))
                .limit(1)
                .for("update");

            if (!order) throw new PrepListError("ORDER_NOT_FOUND", "La línea no existe en esta sucursal");
            if (order.status === "COMPLETED") {
                throw new PrepListError("ALREADY_COMPLETED", "Esa línea ya se había completado");
            }
            if (order.status === "CANCELLED") {
                throw new PrepListError("ORDER_CANCELLED", "La línea está cancelada");
            }

            const quantity = params.producedQuantity ?? order.plannedQuantity;
            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new PrepListError("INVALID_QUANTITY", "La cantidad producida debe ser mayor a cero");
            }

            const cache: LeafCache = new Map();
            const outcome = await produceRecipeWithFefo(
                tx,
                {
                    companyId: params.companyId,
                    branchId: params.branchId,
                    recipeId: order.recipeId,
                    quantity,
                    unit: order.unit,
                    recordedBy: params.userId,
                    orderId: order.id,
                    notes: params.notes ?? `Prep list${order.station ? ` · ${order.station}` : ""}`,
                    shortfallNotes: `Lote insuficiente al completar la prep list; orden:${order.id}; motivo=lote_insuficiente`,
                },
                cache,
            );

            if (outcome.status === "no-leaves") {
                // Sin insumos no hay nada que descontar y la producción sería una
                // fila hueca. Se aborta la transacción: mejor un error claro que
                // una línea "hecha" que no movió inventario.
                throw new PrepListError(
                    "RECIPE_WITHOUT_ITEMS",
                    "La receta no tiene insumos capturados: complétala antes de producirla",
                );
            }
            // `skipped` no puede ocurrir aquí (la guarda A9 es parcial sobre
            // `workflow_instance_id`, que esta ruta no manda), pero si algún día
            // ocurriera, no hay producción que reportar.
            if (outcome.status === "skipped") {
                throw new PrepListError("ALREADY_COMPLETED", "Esa producción ya estaba registrada");
            }

            // `recordProduction` ya dejó la orden COMPLETED con su `completedAt`;
            // falta la firma de quién la cerró, que es columna de la hoja.
            await tx.update(productionOrders)
                .set({ completedBy: params.userId, updatedAt: new Date() })
                .where(eq(productionOrders.id, order.id));

            logger.info(
                {
                    companyId: params.companyId,
                    branchId: params.branchId,
                    orderId: order.id,
                    recipeId: order.recipeId,
                    producedQuantity: outcome.producedQuantity,
                    faltantes: outcome.shortfalls.length,
                },
                "Línea de prep list completada",
            );

            return {
                orderId: order.id,
                resultId: outcome.resultId,
                producedQuantity: outcome.producedQuantity,
                ingredientCost: outcome.ingredientCost,
                shortfalls: outcome.shortfalls,
            };
        });
    }
}

/**
 * Rellena `line.fefo` con el lote que cada línea abierta consumiría.
 *
 * Reparte el stock actual entre las líneas EN EL ORDEN EN QUE SE MUESTRAN: si la
 * de las 09:00 se lleva todo el L-0098, la de las 10:00 muestra el siguiente
 * lote y no el mismo. Es una previsión en memoria — no bloquea, no reserva y no
 * escribe; el reparto real ocurre al completar cada línea.
 *
 * Las líneas hechas o canceladas no consumen: su descuento ya está en la BD.
 */
async function attachFefoPreview(
    companyId: string,
    branchId: string,
    groups: PrepStationGroup<PrepListLine>[],
): Promise<void> {
    const openLines = groups
        .flatMap(g => g.lines)
        .filter(l => l.state !== "HECHA" && l.state !== "CANCELADA");
    if (openLines.length === 0) return;

    // Explosión por receta (cacheada) para saber qué insumos toca cada línea.
    const cache: LeafCache = new Map();
    const leavesByLine = new Map<string, { itemId: string; quantity: number; unit: string | null }[]>();
    const itemIds = new Set<string>();
    for (const line of openLines) {
        const leaves = await expandRecipeLeaves(line.recipeId, line.plannedQuantity, cache);
        leavesByLine.set(line.id, leaves);
        for (const leaf of leaves) itemIds.add(leaf.itemId);
    }
    if (itemIds.size === 0) return;

    const ids = [...itemIds];

    // Un solo barrido del stock: mismo orden que `allocateFEFO` (caducidad,
    // luego antigüedad) para que la previsión no contradiga al descuento real.
    const batches = await db
        .select({
            id: inventoryBatches.id,
            itemId: inventoryBatches.itemId,
            lotNumber: inventoryBatches.lotNumber,
            expirationDate: inventoryBatches.expirationDate,
            currentQuantity: inventoryBatches.currentQuantity,
        })
        .from(inventoryBatches)
        .where(and(
            eq(inventoryBatches.branchId, branchId),
            inArray(inventoryBatches.itemId, ids),
            eq(inventoryBatches.status, "AVAILABLE"),
            sql`${inventoryBatches.currentQuantity} > 0`,
        ))
        .orderBy(inventoryBatches.expirationDate, inventoryBatches.createdAt);

    const cursorsByItem = new Map<string, BatchCursor[]>();
    for (const b of batches) {
        const list = cursorsByItem.get(b.itemId) ?? [];
        list.push({
            batchId: b.id,
            lotNumber: b.lotNumber,
            expirationDate: b.expirationDate,
            remaining: Number(b.currentQuantity),
        });
        cursorsByItem.set(b.itemId, list);
    }

    const itemRows = await db
        .select({ id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.companyId, companyId), inArray(inventoryItems.id, ids)));
    const itemById = new Map(itemRows.map(i => [i.id, i]));

    for (const line of openLines) {
        const leaves = leavesByLine.get(line.id) ?? [];
        for (const leaf of leaves) {
            const item = itemById.get(leaf.itemId);
            const unit = item?.unit || leaf.unit || "UNIT";
            let pending = leaf.quantity;
            const cursors = cursorsByItem.get(leaf.itemId) ?? [];

            // Un renglón de previsión POR LOTE tocado: si la línea necesita dos
            // lotes, la hoja lo dice en vez de mostrar sólo el primero.
            for (const cursor of cursors) {
                if (pending <= 0) break;
                if (cursor.remaining <= 0) continue;
                const take = Math.min(cursor.remaining, pending);
                cursor.remaining -= take;
                pending -= take;
                line.fefo.push({
                    itemId: leaf.itemId,
                    itemName: item?.name || "Insumo",
                    requiredQuantity: leaf.quantity,
                    unit,
                    batchId: cursor.batchId,
                    lotNumber: cursor.lotNumber,
                    expirationDate: cursor.expirationDate,
                    allocatedQuantity: take,
                    shortfall: 0,
                });
            }

            if (pending > 0) {
                // Faltante: se muestra como renglón sin lote. El manual no lo
                // pide, pero una prep list que dice "toma del lote X" sin decir
                // que el lote no alcanza manda al cocinero a descubrirlo solo.
                line.fefo.push({
                    itemId: leaf.itemId,
                    itemName: item?.name || "Insumo",
                    requiredQuantity: leaf.quantity,
                    unit,
                    batchId: null,
                    lotNumber: null,
                    expirationDate: null,
                    allocatedQuantity: 0,
                    shortfall: pending,
                });
            }
        }
    }
}
