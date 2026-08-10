import { db } from "@/lib/db";
import { employeeAuditLogs, inventoryAuditLog } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW' | 'EXPORT' | 'IMPORT';
export type InventoryAuditAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type InventoryAuditEntity = 'ITEM' | 'BATCH' | 'MOVEMENT' | 'TRANSFER' | 'WASTE' | 'RECEIVING' | 'ADJUSTMENT' | 'SUPPLIER' | 'PURCHASE_ORDER' | 'PAYEE';

export interface AuditLogRequest {
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId?: string;
    fieldName?: string;
    oldValue?: unknown;
    newValue?: unknown;
    performedBy: string;
    reason?: string;
    isSensitive?: boolean;
    requiresApproval?: boolean;
    ipAddress?: string;
    userAgent?: string;
}

export interface InventoryAuditLogRequest {
    companyId: string;
    branchId: string;
    action: InventoryAuditAction;
    entityType: InventoryAuditEntity;
    entityId?: string;
    oldValue?: unknown;
    newValue?: unknown;
    performedBy: string;
    reason?: string;
    metadata?: Record<string, unknown>;
}

export class AuditService {

    static async logEmployeeAction(data: AuditLogRequest) {
        try {
            const [log] = await db.insert(employeeAuditLogs).values({
                userId: data.userId,
                action: data.action,
                entityType: data.entityType,
                entityId: data.entityId,
                fieldName: data.fieldName,
                oldValue: data.oldValue,
                newValue: data.newValue,
                performedBy: data.performedBy,
                reason: data.reason,
                isSensitive: data.isSensitive ?? false,
                requiresApproval: data.requiresApproval ?? false,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                performedAt: new Date(),
            }).returning();

            return log;
        } catch (error) {
            console.error("[AuditService] Failed to record audit log:", error);
            return null;
        }
    }

    static async logFieldChange(
        userId: string,
        performedBy: string,
        entityType: string,
        entityId: string,
        fieldName: string,
        oldValue: unknown,
        newValue: unknown,
        isSensitive: boolean = false
    ) {
        return this.logEmployeeAction({
            userId,
            performedBy,
            action: 'UPDATE',
            entityType,
            entityId,
            fieldName,
            oldValue,
            newValue,
            isSensitive
        });
    }

    static async logInventoryAction(data: InventoryAuditLogRequest) {
        try {
            const [log] = await db.insert(inventoryAuditLog).values({
                companyId: data.companyId,
                branchId: data.branchId,
                action: data.action,
                entityType: data.entityType,
                entityId: data.entityId,
                oldValue: data.oldValue ? sql`${JSON.stringify(data.oldValue)}::jsonb` : null,
                newValue: data.newValue ? sql`${JSON.stringify(data.newValue)}::jsonb` : null,
                performedBy: data.performedBy,
                reason: data.reason,
                metadata: data.metadata ? sql`${JSON.stringify(data.metadata)}::jsonb` : sql`'{}'::jsonb`,
                performedAt: new Date(),
            }).returning();

            return log;
        } catch (error) {
            console.error("[AuditService] Failed to record inventory audit log:", error);
            return null;
        }
    }

    static async getInventoryAuditLogs(params: {
        companyId: string;
        branchId?: string;
        entityType?: InventoryAuditEntity;
        action?: InventoryAuditAction;
        entityId?: string;
        performedBy?: string;
        dateFrom?: Date;
        dateTo?: Date;
        limit?: number;
        offset?: number;
    }) {
        const conditions = [eq(inventoryAuditLog.companyId, params.companyId)];

        if (params.branchId) conditions.push(eq(inventoryAuditLog.branchId, params.branchId));
        if (params.entityType) conditions.push(eq(inventoryAuditLog.entityType, params.entityType));
        if (params.action) conditions.push(eq(inventoryAuditLog.action, params.action));
        if (params.entityId) conditions.push(eq(inventoryAuditLog.entityId, params.entityId));
        if (params.performedBy) conditions.push(eq(inventoryAuditLog.performedBy, params.performedBy));
        if (params.dateFrom) conditions.push(sql`${inventoryAuditLog.performedAt} >= ${params.dateFrom}`);
        if (params.dateTo) conditions.push(sql`${inventoryAuditLog.performedAt} <= ${params.dateTo}`);

        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;

        const logs = await db.select()
            .from(inventoryAuditLog)
            .where(and(...conditions))
            .orderBy(desc(inventoryAuditLog.performedAt))
            .limit(limit)
            .offset(offset);

        const [countResult] = await db.select({
            total: sql<number>`count(*)`
        })
            .from(inventoryAuditLog)
            .where(and(...conditions));

        return {
            logs,
            total: countResult?.total ?? 0,
            limit,
            offset,
        };
    }
}
