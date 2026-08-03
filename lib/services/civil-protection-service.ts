/**
 * Civil Protection Service (Fase 7 — T20)
 *
 * CRUD tenant-scoped para tres bitacoras de proteccion civil:
 *  - Simulacros (drills)
 *  - Inspeccion de extintores (con OCR de fechas)
 *  - Checklist fotografico de salidas de emergencia
 *
 * Normativa: NOM-002-STPS-2010 (extintores) + Codigo Nacional de Proteccion Civil.
 * TODA lectura/escritura se scope-a por companyId (tenantId de sesion).
 * Nunca se filtran por companyId del body.
 */

import { db } from "@/lib/db";
import {
    civilProtectionDrills,
    extinguisherInspections,
    exitChecklistItems,
} from "@/lib/db/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";

// ============================================
// Tipos derivados
// ============================================

export type Drill = typeof civilProtectionDrills.$inferSelect;
export type ExtinguisherInspection = typeof extinguisherInspections.$inferSelect;
export type ExitChecklistItem = typeof exitChecklistItems.$inferSelect;

export type NewDrillInput = Omit<
    typeof civilProtectionDrills.$inferInsert,
    "id" | "companyId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"
>;
export type NewExtinguisherInput = Omit<
    typeof extinguisherInspections.$inferInsert,
    "id" | "companyId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"
>;
export type NewExitChecklistInput = Omit<
    typeof exitChecklistItems.$inferInsert,
    "id" | "companyId" | "createdAt" | "updatedAt" | "inspectedBy"
>;

interface ListFilters {
    branchId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
}

// ============================================
// SIMULACROS
// ============================================

export async function listDrills(
    companyId: string,
    filters: ListFilters = {}
): Promise<Drill[]> {
    const conditions = [eq(civilProtectionDrills.companyId, companyId)];
    if (filters.branchId) {
        conditions.push(eq(civilProtectionDrills.branchId, filters.branchId));
    }
    if (filters.startDate) {
        conditions.push(gte(civilProtectionDrills.drillDate, filters.startDate));
    }
    if (filters.endDate) {
        conditions.push(lte(civilProtectionDrills.drillDate, filters.endDate));
    }

    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    return await db
        .select()
        .from(civilProtectionDrills)
        .where(and(...conditions))
        .orderBy(desc(civilProtectionDrills.drillDate))
        .limit(limit)
        .offset(offset);
}

export async function getDrillById(companyId: string, id: string): Promise<Drill> {
    const [drill] = await db
        .select()
        .from(civilProtectionDrills)
        .where(
            and(
                eq(civilProtectionDrills.id, id),
                eq(civilProtectionDrills.companyId, companyId)
            )
        )
        .limit(1);

    if (!drill) {
        throw ApiError.notFound("Simulacro no encontrado.");
    }
    return drill;
}

export async function createDrill(
    companyId: string,
    userId: string,
    input: NewDrillInput
): Promise<Drill> {
    const [drill] = await db
        .insert(civilProtectionDrills)
        .values({
            ...input,
            companyId,
            createdBy: userId,
        })
        .returning();
    return drill;
}

export async function updateDrill(
    companyId: string,
    userId: string,
    id: string,
    patch: Partial<NewDrillInput>
): Promise<Drill> {
    const [updated] = await db
        .update(civilProtectionDrills)
        .set({ ...patch, updatedBy: userId, updatedAt: new Date() })
        .where(
            and(
                eq(civilProtectionDrills.id, id),
                eq(civilProtectionDrills.companyId, companyId)
            )
        )
        .returning();

    if (!updated) {
        throw ApiError.notFound("Simulacro no encontrado.");
    }
    return updated;
}

export async function deleteDrill(companyId: string, id: string): Promise<void> {
    const [deleted] = await db
        .delete(civilProtectionDrills)
        .where(
            and(
                eq(civilProtectionDrills.id, id),
                eq(civilProtectionDrills.companyId, companyId)
            )
        )
        .returning({ id: civilProtectionDrills.id });

    if (!deleted) {
        throw ApiError.notFound("Simulacro no encontrado.");
    }
}

// ============================================
// EXTINTORES
// ============================================

export async function listExtinguishers(
    companyId: string,
    filters: ListFilters = {}
): Promise<ExtinguisherInspection[]> {
    const conditions = [eq(extinguisherInspections.companyId, companyId)];
    if (filters.branchId) {
        conditions.push(eq(extinguisherInspections.branchId, filters.branchId));
    }
    if (filters.startDate) {
        conditions.push(gte(extinguisherInspections.inspectionDate, filters.startDate));
    }
    if (filters.endDate) {
        conditions.push(lte(extinguisherInspections.inspectionDate, filters.endDate));
    }

    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    return await db
        .select()
        .from(extinguisherInspections)
        .where(and(...conditions))
        .orderBy(desc(extinguisherInspections.inspectionDate))
        .limit(limit)
        .offset(offset);
}

/**
 * Extintores cuya proxima inspeccion/recarga vence dentro de `withinDays` dias.
 * Usado para alertas proactivas (futuro cron Inngest) y widgets del dashboard.
 */
export async function listExpiringExtinguishers(
    companyId: string,
    withinDays: number = 30
): Promise<ExtinguisherInspection[]> {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + withinDays);

    return await db
        .select()
        .from(extinguisherInspections)
        .where(
            and(
                eq(extinguisherInspections.companyId, companyId),
                lte(extinguisherInspections.nextInspectionDate, horizon)
            )
        )
        .orderBy(extinguisherInspections.nextInspectionDate);
}

export async function getExtinguisherById(
    companyId: string,
    id: string
): Promise<ExtinguisherInspection> {
    const [row] = await db
        .select()
        .from(extinguisherInspections)
        .where(
            and(
                eq(extinguisherInspections.id, id),
                eq(extinguisherInspections.companyId, companyId)
            )
        )
        .limit(1);

    if (!row) {
        throw ApiError.notFound("Inspeccion de extintor no encontrada.");
    }
    return row;
}

export async function createExtinguisher(
    companyId: string,
    userId: string,
    input: NewExtinguisherInput
): Promise<ExtinguisherInspection> {
    const [row] = await db
        .insert(extinguisherInspections)
        .values({
            ...input,
            companyId,
            createdBy: userId,
        })
        .returning();
    return row;
}

export async function updateExtinguisher(
    companyId: string,
    userId: string,
    id: string,
    patch: Partial<NewExtinguisherInput>
): Promise<ExtinguisherInspection> {
    const [updated] = await db
        .update(extinguisherInspections)
        .set({ ...patch, updatedBy: userId, updatedAt: new Date() })
        .where(
            and(
                eq(extinguisherInspections.id, id),
                eq(extinguisherInspections.companyId, companyId)
            )
        )
        .returning();

    if (!updated) {
        throw ApiError.notFound("Inspeccion de extintor no encontrada.");
    }
    return updated;
}

export async function deleteExtinguisher(companyId: string, id: string): Promise<void> {
    const [deleted] = await db
        .delete(extinguisherInspections)
        .where(
            and(
                eq(extinguisherInspections.id, id),
                eq(extinguisherInspections.companyId, companyId)
            )
        )
        .returning({ id: extinguisherInspections.id });

    if (!deleted) {
        throw ApiError.notFound("Inspeccion de extintor no encontrada.");
    }
}

/**
 * Persistir el resultado del OCR sobre una inspeccion de extintor existente.
 * Recibe las fechas detectadas y el raw text/confidence del motor OCR.
 */
export async function recordExtinguisherOcr(
    companyId: string,
    userId: string,
    id: string,
    ocr: {
        rawText?: string;
        fullText?: string;
        extractedDates?: Record<string, string>;
        confidence?: number;
        expirationDate?: Date;
        lastRechargeDate?: Date;
        nextInspectionDate?: Date;
    }
): Promise<ExtinguisherInspection> {
    return updateExtinguisher(companyId, userId, id, {
        ocrRawData: ocr,
        ocrProcessedAt: new Date(),
        expirationDate: ocr.expirationDate,
        lastRechargeDate: ocr.lastRechargeDate,
        nextInspectionDate: ocr.nextInspectionDate,
    });
}

// ============================================
// SALIDAS DE EMERGENCIA (checklist fotografico)
// ============================================

export async function listExitChecklist(
    companyId: string,
    filters: ListFilters = {}
): Promise<ExitChecklistItem[]> {
    const conditions = [eq(exitChecklistItems.companyId, companyId)];
    if (filters.branchId) {
        conditions.push(eq(exitChecklistItems.branchId, filters.branchId));
    }
    if (filters.startDate) {
        conditions.push(gte(exitChecklistItems.inspectedAt, filters.startDate));
    }
    if (filters.endDate) {
        conditions.push(lte(exitChecklistItems.inspectedAt, filters.endDate));
    }

    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    return await db
        .select()
        .from(exitChecklistItems)
        .where(and(...conditions))
        .orderBy(desc(exitChecklistItems.inspectedAt))
        .limit(limit)
        .offset(offset);
}

export async function getExitChecklistItemById(
    companyId: string,
    id: string
): Promise<ExitChecklistItem> {
    const [row] = await db
        .select()
        .from(exitChecklistItems)
        .where(
            and(
                eq(exitChecklistItems.id, id),
                eq(exitChecklistItems.companyId, companyId)
            )
        )
        .limit(1);

    if (!row) {
        throw ApiError.notFound("Registro de salida no encontrado.");
    }
    return row;
}

export async function createExitChecklistItem(
    companyId: string,
    userId: string,
    input: NewExitChecklistInput
): Promise<ExitChecklistItem> {
    const [row] = await db
        .insert(exitChecklistItems)
        .values({
            ...input,
            companyId,
            inspectedBy: userId,
        })
        .returning();
    return row;
}

export async function updateExitChecklistItem(
    companyId: string,
    id: string,
    patch: Partial<NewExitChecklistInput>
): Promise<ExitChecklistItem> {
    const [updated] = await db
        .update(exitChecklistItems)
        .set({ ...patch, updatedAt: new Date() })
        .where(
            and(
                eq(exitChecklistItems.id, id),
                eq(exitChecklistItems.companyId, companyId)
            )
        )
        .returning();

    if (!updated) {
        throw ApiError.notFound("Registro de salida no encontrado.");
    }
    return updated;
}

export async function deleteExitChecklistItem(companyId: string, id: string): Promise<void> {
    const [deleted] = await db
        .delete(exitChecklistItems)
        .where(
            and(
                eq(exitChecklistItems.id, id),
                eq(exitChecklistItems.companyId, companyId)
            )
        )
        .returning({ id: exitChecklistItems.id });

    if (!deleted) {
        throw ApiError.notFound("Registro de salida no encontrado.");
    }
}

// ============================================
// KPIs agregados por tenant
// ============================================

export interface CivilProtectionKpis {
    drillsTotal: number;
    drillsLastDate: Date | null;
    extinguishersTotal: number;
    extinguishersExpiringSoon: number; // proximos 30 dias
    extinguishersExpired: number;
    exitsLastInspection: Date | null;
    exitsWithIssues: number; // registros donde algun check falla
}

export async function getCivilProtectionKpis(
    companyId: string,
    branchId?: string
): Promise<CivilProtectionKpis> {
    const drillCond = [eq(civilProtectionDrills.companyId, companyId)];
    const extCond = [eq(extinguisherInspections.companyId, companyId)];
    const exitCond = [eq(exitChecklistItems.companyId, companyId)];
    if (branchId) {
        drillCond.push(eq(civilProtectionDrills.branchId, branchId));
        extCond.push(eq(extinguisherInspections.branchId, branchId));
        exitCond.push(eq(exitChecklistItems.branchId, branchId));
    }

    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);

    const [drillCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(civilProtectionDrills)
        .where(and(...drillCond));

    const lastDrill = await db
        .select({ drillDate: civilProtectionDrills.drillDate })
        .from(civilProtectionDrills)
        .where(and(...drillCond))
        .orderBy(desc(civilProtectionDrills.drillDate))
        .limit(1);

    const [extCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(extinguisherInspections)
        .where(and(...extCond));

    const [extExpiring] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(extinguisherInspections)
        .where(
            and(
                ...extCond,
                lte(extinguisherInspections.nextInspectionDate, horizon),
                gte(extinguisherInspections.nextInspectionDate, now)
            )
        );

    const [extExpired] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(extinguisherInspections)
        .where(
            and(
                ...extCond,
                lte(extinguisherInspections.nextInspectionDate, now)
            )
        );

    const lastExit = await db
        .select({ inspectedAt: exitChecklistItems.inspectedAt })
        .from(exitChecklistItems)
        .where(and(...exitCond))
        .orderBy(desc(exitChecklistItems.inspectedAt))
        .limit(1);

    const [exitIssues] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(exitChecklistItems)
        .where(
            and(
                ...exitCond,
                sql`(${exitChecklistItems.isClear} = false OR ${exitChecklistItems.signageOk} = false OR ${exitChecklistItems.emergencyLightOk} = false OR ${exitChecklistItems.doorOpensOk} = false)`
            )
        );

    return {
        drillsTotal: drillCount?.count ?? 0,
        drillsLastDate: lastDrill[0]?.drillDate ?? null,
        extinguishersTotal: extCount?.count ?? 0,
        extinguishersExpiringSoon: extExpiring?.count ?? 0,
        extinguishersExpired: extExpired?.count ?? 0,
        exitsLastInspection: lastExit[0]?.inspectedAt ?? null,
        exitsWithIssues: exitIssues?.count ?? 0,
    };
}
