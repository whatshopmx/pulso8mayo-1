import { db } from "@/lib/db";
import { employeeAuditLogs, inventoryAuditLog, configChangeLogs } from "@/lib/db/schema";
import type { DbExecutor } from "./fefo-allocator";
import { eq, and, desc, sql } from "drizzle-orm";

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW' | 'EXPORT' | 'IMPORT';
export type InventoryAuditAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type InventoryAuditEntity =
  | 'ITEM'
  | 'BATCH'
  | 'MOVEMENT'
  | 'TRANSFER'
  | 'WASTE'
  | 'RECEIVING'
  | 'ADJUSTMENT'
  | 'SUPPLIER'
  | 'PURCHASE_ORDER'
  | 'PAYEE';
// Nota S/AUD-02: 'SALE_RECOVERY_APPLY' y 'SALE_VOID' requieren migración de inventory_audit_entity en A3/INV-01.d antes de insertarse en inventory_audit_log.

export type AuditErrorCode =
  | 'AUDIT_REASON_REQUIRED'
  | 'AUDIT_TRANSACTION_REQUIRED'
  | 'AUDIT_REASON_TOO_SHORT'
  | 'AUDIT_WRITE_FAILED';

export class AuditValidationError extends Error {
  readonly code: AuditErrorCode;
  constructor(code: AuditErrorCode, message: string) {
    super(message);
    this.name = 'AuditValidationError';
    this.code = code;
  }
}

/**
 * Catálogo canónico de acciones y callers críticos del sistema (AUD-02).
 *
 * En todas estas operaciones:
 * 1. El motivo (`reason`) es ESTRICTAMENTE OBLIGATORIO (no nulo, no vacío, longitud mínima).
 * 2. La auditoría DEBE ejecutarse en la MISMA transacción (`executor !== db`).
 * 3. Si la inserción en la bitácora falla, la excepción PROPAGA y causa el ROLLBACK
 *    completo de la transacción de negocio (sin efectos parciales en saldos, estados o inventario).
 */
export interface CriticalAuditDescriptor {
  domain: 'INVENTORY' | 'LABOR' | 'FINANCE' | 'SECURITY';
  entityType: string;
  action: string;
  description: string;
  reasonRequired: true;
  transactionRequired: true;
}

export const CRITICAL_AUDIT_CATALOG: readonly CriticalAuditDescriptor[] = [
  { domain: 'INVENTORY', entityType: 'RECIPE_CONSUMPTION_POLICY', action: 'CREATE', description: 'Publicación de política de consumo por versión/vigencia (bitácora de configuración de empresa)', reasonRequired: true, transactionRequired: true },
  // Frente A / Inventario y Stock
  { domain: 'INVENTORY', entityType: 'WASTE', action: 'CREATE', description: 'Registro de merma/desecho que destruye stock físico', reasonRequired: true, transactionRequired: true },
  { domain: 'INVENTORY', entityType: 'WASTE', action: 'UPDATE', description: 'Aprobación o rechazo administrativo de merma', reasonRequired: true, transactionRequired: true },
  { domain: 'INVENTORY', entityType: 'ADJUSTMENT', action: 'CREATE', description: 'Ajuste manual de stock por varianza o conteo', reasonRequired: true, transactionRequired: true },
  { domain: 'INVENTORY', entityType: 'ADJUSTMENT', action: 'UPDATE', description: 'Corrección de ajuste de inventario', reasonRequired: true, transactionRequired: true },
  { domain: 'INVENTORY', entityType: 'BATCH', action: 'UPDATE', description: 'Inmovilización, cuarentena, reserva o liberación de lote', reasonRequired: true, transactionRequired: true },
  { domain: 'INVENTORY', entityType: 'TRANSFER', action: 'CREATE', description: 'Traspaso de inventario entre sucursales', reasonRequired: true, transactionRequired: true },
  { domain: 'INVENTORY', entityType: 'TRANSFER', action: 'UPDATE', description: 'Modificación o cancelación de traspaso', reasonRequired: true, transactionRequired: true },
  { domain: 'INVENTORY', entityType: 'SALE_RECOVERY_APPLY', action: 'CREATE', description: 'A3: Aplicación auditada de recuperación histórica sobre stock', reasonRequired: true, transactionRequired: true },
  { domain: 'INVENTORY', entityType: 'SALE_VOID', action: 'CREATE', description: 'Anulación de venta y reversa de consumo de stock', reasonRequired: true, transactionRequired: true },

  // Frente B / Laboral y Nómina
  { domain: 'LABOR', entityType: 'SALARY', action: 'CREATE', description: 'Asignación de salario o contrato salarial', reasonRequired: true, transactionRequired: true },
  { domain: 'LABOR', entityType: 'SALARY', action: 'UPDATE', description: 'Modificación de salario o deducciones (NOM-01)', reasonRequired: true, transactionRequired: true },
  { domain: 'LABOR', entityType: 'SALARY', action: 'DELETE', description: 'Baja o anulación de esquema salarial', reasonRequired: true, transactionRequired: true },
  { domain: 'LABOR', entityType: 'CONTRACT', action: 'UPDATE', description: 'Modificación de condiciones contractuales', reasonRequired: true, transactionRequired: true },
  { domain: 'LABOR', entityType: 'CONTRACT', action: 'DELETE', description: 'Rescisión o terminación contractual', reasonRequired: true, transactionRequired: true },
  { domain: 'LABOR', entityType: 'PROFILE', action: 'DELETE', description: 'Baja o desvinculación de colaborador', reasonRequired: true, transactionRequired: true },
  { domain: 'LABOR', entityType: 'IMSS_MOVEMENT', action: 'CREATE', description: 'Alta/baja/modificación salario ante IMSS', reasonRequired: true, transactionRequired: true },
  { domain: 'LABOR', entityType: 'IMSS_MOVEMENT', action: 'UPDATE', description: 'Actualización o confirmación de movimiento IMSS', reasonRequired: true, transactionRequired: true },

  // Frente C / Excepciones
  { domain: 'SECURITY', entityType: 'EXCEPTION', action: 'UPDATE', description: 'Override, resolución manual o reapertura de excepción', reasonRequired: true, transactionRequired: true },

  // Frente D / Finanzas, Bancos y Tesorería
  { domain: 'FINANCE', entityType: 'FINANCIAL_CLOSE', action: 'UPDATE', description: 'FIN-02.a: Cierre o reapertura de período financiero', reasonRequired: true, transactionRequired: true },
  { domain: 'FINANCE', entityType: 'FINANCIAL_CLOSE', action: 'APPROVE', description: 'Aprobación de cierre contable y congelamiento de P&L', reasonRequired: true, transactionRequired: true },
  { domain: 'FINANCE', entityType: 'DEPOSIT_CORRECTION', action: 'UPDATE', description: 'BAN-06.b: Corrección auditada de depósito contabilizado', reasonRequired: true, transactionRequired: true },
  { domain: 'FINANCE', entityType: 'DEPOSIT_CORRECTION', action: 'DELETE', description: 'Reversa de depósito contabilizado', reasonRequired: true, transactionRequired: true },
  { domain: 'FINANCE', entityType: 'APPROVAL_PURCHASE', action: 'APPROVE', description: 'APR-01: Aprobación de orden de compra', reasonRequired: true, transactionRequired: true },
  { domain: 'FINANCE', entityType: 'APPROVAL_INVOICE', action: 'APPROVE', description: 'APR-01: Aprobación de factura de proveedor', reasonRequired: true, transactionRequired: true },
  { domain: 'FINANCE', entityType: 'APPROVAL_EXPENSE', action: 'APPROVE', description: 'APR-01: Aprobación de gasto operativo', reasonRequired: true, transactionRequired: true },
  { domain: 'FINANCE', entityType: 'APPROVAL_PAYMENT', action: 'APPROVE', description: 'APR-01: Aprobación de solicitud/dispersión de pago', reasonRequired: true, transactionRequired: true },
  { domain: 'FINANCE', entityType: 'APPROVAL_PAYROLL', action: 'APPROVE', description: 'APR-01: Aprobación de nómina timbrada', reasonRequired: true, transactionRequired: true },
] as const;

export function isCriticalInventoryAction(entityType: string, action: string): boolean {
  return CRITICAL_AUDIT_CATALOG.some(
    (c) => c.domain === 'INVENTORY' && c.entityType === entityType && c.action === action
  );
}

export function isCriticalEmployeeAction(entityType: string, action: string): boolean {
  return CRITICAL_AUDIT_CATALOG.some(
    (c) => (c.domain === 'LABOR' || c.domain === 'SECURITY') && c.entityType === entityType && c.action === action
  );
}

export function validateAuditReason(reason?: string | null, isCritical: boolean = false): string | undefined {
  const trimmed = reason?.trim();
  if (!isCritical) {
    return trimmed || undefined;
  }
  if (!trimmed || trimmed.length < 4) {
    throw new AuditValidationError(
      'AUDIT_REASON_REQUIRED',
      'El motivo de auditoría es obligatorio para operaciones críticas y debe tener al menos 4 caracteres.'
    );
  }
  return trimmed;
}

export function assertTransactionExecutor(executor?: DbExecutor): DbExecutor {
  if (!executor || executor === db) {
    throw new AuditValidationError(
      'AUDIT_TRANSACTION_REQUIRED',
      'La auditoría crítica requiere ejecutarse dentro de una transacción activa (DbTransaction).'
    );
  }
  return executor;
}

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
    isCritical?: boolean;
}

export interface CriticalEmployeeAuditLogRequest extends AuditLogRequest {
    reason: string;
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
    isCritical?: boolean;
}

export interface CriticalInventoryAuditLogRequest extends InventoryAuditLogRequest {
    reason: string;
}

export class AuditService {

    /** Configuración de empresa: no inventa una sucursal para una política global. */
    static async logCriticalConfigChange(data: {
        companyId: string; performedBy: string; fieldName: string;
        oldValue: Record<string, unknown> | null; newValue: Record<string, unknown>; reason: string;
    }, executor: DbExecutor) {
        const tx = assertTransactionExecutor(executor);
        const reason = validateAuditReason(data.reason, true)!;
        // Drizzle incluye id/performed_at como DEFAULT en su INSERT habitual,
        // lo que exige permiso INSERT sobre esas columnas. Esta lista explícita
        // mantiene id/hora exclusivamente del servidor y el grant mínimo.
        const result = await tx.execute<{ id: string }>(sql`INSERT INTO public.${configChangeLogs}
            (company_id, user_id, field_name, old_value, new_value)
            VALUES (${data.companyId}, ${data.performedBy}, ${data.fieldName},
              ${data.oldValue === null ? null : sql`${JSON.stringify(data.oldValue)}::jsonb`},
              ${JSON.stringify({ ...data.newValue, auditReason: reason })}::jsonb)
            RETURNING id`);
        const log = result.rows[0];
        if (!log) throw new AuditValidationError('AUDIT_WRITE_FAILED', 'No se pudo registrar la auditoría de configuración.');
        return log;
    }

    /**
     * Auditoría crítica para mutaciones de personal, laboral o excepciones.
     * Exige motivo válido y transacción activa. Si la inserción falla, el error
     * se propaga para revertir la mutación en curso.
     */
    static async logCriticalEmployeeAction(data: CriticalEmployeeAuditLogRequest, executor: DbExecutor) {
        const tx = assertTransactionExecutor(executor);
        const reason = validateAuditReason(data.reason, true)!;

        const [log] = await tx.insert(employeeAuditLogs).values({
            userId: data.userId,
            action: data.action,
            entityType: data.entityType,
            entityId: data.entityId,
            fieldName: data.fieldName,
            oldValue: data.oldValue ? sql`${JSON.stringify(data.oldValue)}::jsonb` : null,
            newValue: data.newValue ? sql`${JSON.stringify(data.newValue)}::jsonb` : null,
            performedBy: data.performedBy,
            reason,
            isSensitive: data.isSensitive ?? true,
            requiresApproval: data.requiresApproval ?? false,
            ipAddress: data.ipAddress,
            userAgent: data.userAgent,
            performedAt: new Date(),
        }).returning();

        return log;
    }

    /**
     * Bitácora de empleados.
     * - Si la acción es crítica (o `data.isCritical === true`), delega en `logCriticalEmployeeAction`
     *   exigiendo motivo obligatorio y transacción activa.
     * - Si la acción no es crítica, preserva la compatibilidad hacia atrás: con `executor` ejecuta en él,
     *   y sin `executor` ejecuta en `db` de forma best-effort retornando `null` ante error.
     */
    static async logEmployeeAction(data: AuditLogRequest, executor?: DbExecutor) {
        const critical = data.isCritical === true || isCriticalEmployeeAction(data.entityType, data.action);
        if (critical) {
            return this.logCriticalEmployeeAction(data as CriticalEmployeeAuditLogRequest, executor as DbExecutor);
        }

        const run = async (q: DbExecutor) => {
            const [log] = await q.insert(employeeAuditLogs).values({
                userId: data.userId,
                action: data.action,
                entityType: data.entityType,
                entityId: data.entityId,
                fieldName: data.fieldName,
                oldValue: data.oldValue ? sql`${JSON.stringify(data.oldValue)}::jsonb` : null,
                newValue: data.newValue ? sql`${JSON.stringify(data.newValue)}::jsonb` : null,
                performedBy: data.performedBy,
                reason: validateAuditReason(data.reason, false),
                isSensitive: data.isSensitive ?? false,
                requiresApproval: data.requiresApproval ?? false,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                performedAt: new Date(),
            }).returning();

            return log;
        };

        // En una transición transaccional, fallar el audit revierte la mutación.
        // Los callers no críticos anteriores conservan su semántica best-effort.
        if (executor) return run(executor);
        try {
            return await run(db);
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

    /**
     * AUD-02: Auditoría obligatoria atómica para operaciones críticas de inventario.
     *
     * Contrato obligatorio para A3 (`INV-01.c.recovery.apply`), mermas (`WASTE`),
     * ajustes (`ADJUSTMENT`) y cambios de estado de lote (`BATCH`).
     * - Requiere `reason` no vacío (mínimo 4 caracteres).
     * - Requiere `executor` transaccional (`executor !== db`).
     * - Propaga errores para asegurar rollback atómico si la auditoría falla.
     */
    static async logCriticalInventoryAction(data: CriticalInventoryAuditLogRequest, executor: DbExecutor) {
        const tx = assertTransactionExecutor(executor);
        const reason = validateAuditReason(data.reason, true)!;

        const [log] = await tx.insert(inventoryAuditLog).values({
            companyId: data.companyId,
            branchId: data.branchId,
            action: data.action,
            entityType: data.entityType,
            entityId: data.entityId,
            oldValue: data.oldValue ? sql`${JSON.stringify(data.oldValue)}::jsonb` : null,
            newValue: data.newValue ? sql`${JSON.stringify(data.newValue)}::jsonb` : null,
            performedBy: data.performedBy,
            reason,
            metadata: data.metadata ? sql`${JSON.stringify(data.metadata)}::jsonb` : sql`'{}'::jsonb`,
            performedAt: new Date(),
        }).returning();

        return log;
    }

    /**
     * AUD-01 / AUD-02 — bitácora de inventario.
     *
     * - Si la acción es crítica (o `data.isCritical === true`), delega en `logCriticalInventoryAction`
     *   exigiendo motivo obligatorio y transacción activa.
     * - Si la acción no es crítica, preserva la compatibilidad hacia atrás: con `executor` ejecuta en él,
     *   y sin `executor` conserva el comportamiento best-effort previo (registra error y devuelve `null`).
     */
    static async logInventoryAction(data: InventoryAuditLogRequest, executor?: DbExecutor) {
        const critical = data.isCritical === true || isCriticalInventoryAction(data.entityType, data.action);
        if (critical) {
            return this.logCriticalInventoryAction(data as CriticalInventoryAuditLogRequest, executor as DbExecutor);
        }

        const run = async (q: DbExecutor) => {
            const [log] = await q.insert(inventoryAuditLog).values({
                companyId: data.companyId,
                branchId: data.branchId,
                action: data.action,
                entityType: data.entityType,
                entityId: data.entityId,
                oldValue: data.oldValue ? sql`${JSON.stringify(data.oldValue)}::jsonb` : null,
                newValue: data.newValue ? sql`${JSON.stringify(data.newValue)}::jsonb` : null,
                performedBy: data.performedBy,
                reason: validateAuditReason(data.reason, false),
                metadata: data.metadata ? sql`${JSON.stringify(data.metadata)}::jsonb` : sql`'{}'::jsonb`,
                performedAt: new Date(),
            }).returning();

            return log;
        };

        if (executor) return run(executor);

        try {
            return await run(db);
        } catch (error) {
            console.error("[AuditService] Failed to record inventory audit log:", error);
            return null;
        }
    }

    /**
     * Helper transaccional para ejecutar mutaciones de negocio con auditoría atómica.
     * Toda mutación y su registro en bitácora ocurren en la misma transacción Postgres.
     */
    static async withAuditTransaction<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
        return db.transaction(async (tx) => {
            return work(tx);
        });
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
