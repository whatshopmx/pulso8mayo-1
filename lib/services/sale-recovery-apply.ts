import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  salesEntries,
  evidence,
  saleRecoveryProposals,
  saleRecoveryDecisions,
  salesConsumptionIdentities,
  salesConsumptionRevisions,
  inventoryBatches,
} from '@/lib/db/schema';
import { setTenantContext } from '@/lib/db/tenant-context';
import { requireAuth } from '@/lib/tenant-context';
import { resolveBranchScope } from '@/lib/branch-scope';
import { hasPermission, type Role } from '@/lib/permissions';
import { ApiError, isApiError } from '@/lib/api/error';
import { AuditService, AuditValidationError } from './audit-service';
import {
  prepareSaleRecoveryReview,
  SaleRecoveryReviewError,
} from './sale-recovery-review';
import {
  normalizeSaleConsumptionIdentity,
  soldQuantity,
  type AppliedSaleAllocation,
  type SaleConsumptionMovement,
} from './sale-consumption-contract';
import { allocateScopedBatches } from './fefo-allocator';

const uuid = z.string().uuid().toLowerCase();

const applyRecoveryInputSchema = z.object({
  branchId: uuid,
  proposalId: uuid,
  reason: z.string().trim().min(4, 'El motivo de auditoría debe tener al menos 4 caracteres').max(2000),
  user: z.object({
    id: z.string().trim().min(1).max(256),
    role: z.enum(['ADMIN', 'OWNER', 'SUPER_ADMIN']),
    companyId: uuid,
    branchId: uuid.nullable().optional(),
  }).optional(),
}).strict();

export type ApplySaleRecoveryInput = z.infer<typeof applyRecoveryInputSchema>;

export interface ApplySaleRecoveryResult {
  applied: boolean;
  alreadyApplied?: boolean;
  revisionId?: string;
  identityId?: string;
  movementsCount?: number;
  auditLogId?: string;
}

type ResolvedActor = {
  id: string;
  role: 'ADMIN' | 'OWNER' | 'SUPER_ADMIN';
  companyId: string;
  branchId: string | null;
};

async function resolveActor(inputUser?: ApplySaleRecoveryInput['user']): Promise<ResolvedActor> {
  if (inputUser) {
    if (
      !inputUser.id ||
      typeof inputUser.id !== 'string' ||
      !inputUser.id.trim() ||
      inputUser.id !== inputUser.id.trim() ||
      inputUser.id.length > 256 ||
      !uuid.safeParse(inputUser.companyId).success ||
      !['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(inputUser.role) ||
      !hasPermission(inputUser.role as Role, 'inventory', 'manage')
    ) {
      throw ApiError.forbidden('La aplicación requiere una sesión administrativa con permisos de inventario');
    }
    return {
      id: inputUser.id,
      role: inputUser.role as 'ADMIN' | 'OWNER' | 'SUPER_ADMIN',
      companyId: uuid.parse(inputUser.companyId),
      branchId: typeof inputUser.branchId === 'string' ? inputUser.branchId.toLowerCase() : null,
    };
  }

  const { user } = await requireAuth();
  if (
    !user ||
    typeof user.id !== 'string' ||
    !user.id.trim() ||
    user.id !== user.id.trim() ||
    user.id.length > 256 ||
    !uuid.safeParse(user.companyId).success ||
    !['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(user.role) ||
    !hasPermission(user.role as Role, 'inventory', 'manage')
  ) {
    throw ApiError.forbidden('La aplicación requiere una sesión administrativa con permisos de inventario');
  }
  return {
    id: user.id,
    role: user.role as 'ADMIN' | 'OWNER' | 'SUPER_ADMIN',
    companyId: uuid.parse(user.companyId),
    branchId: typeof user.branchId === 'string' ? user.branchId.toLowerCase() : null,
  };
}

/**
 * INV-01.c.recovery.apply: Aplica un expediente de recuperación histórica aprobado.
 *
 * Ejecuta en transacción serializable con advisory lock:
 * 1. Revalida propuesta, hashes y decisión aprobada (exigiendo segregación de funciones).
 * 2. Comprueba frescura documental de la venta legada y sus evidencias asociadas.
 * 3. Comprueba idempotencia: si ya existe revisión 1 para la identidad, devuelve alreadyApplied: true.
 * 4. Deduce stock de lotes AVAILABLE mediante allocateScopedBatches (FEFO).
 * 5. Inserta movimientos de tipo USAGE con reference_id = salecons:${identityId}.
 * 6. Inserta revisión 1 en sales_consumption_revisions con previousRevision: null.
 * 7. Registra bitácora de auditoría crítica AUD-02 (ADJUSTMENT / CREATE con metadata subtype SALE_RECOVERY_APPLY).
 */
export async function applySaleRecoveryProposal(input: unknown): Promise<ApplySaleRecoveryResult> {
  const parsed = applyRecoveryInputSchema.safeParse(input);
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.find(i => i.path.includes('reason'));
    if (reasonIssue) {
      throw ApiError.badRequest('El motivo de auditoría debe tener al menos 4 caracteres');
    }
    throw ApiError.badRequest('Datos de aplicación de recuperación inválidos');
  }

  const data = parsed.data;
  const user = await resolveActor(data.user);

  const branchScope = resolveBranchScope(user.role, user.branchId, data.branchId);
  if (branchScope.kind !== 'BRANCH' || branchScope.branchId !== data.branchId) {
    throw ApiError.forbidden('Sucursal fuera del alcance autorizado');
  }

  const scope = { companyId: user.companyId, branchId: data.branchId, actorId: user.id };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async tx => {
        await setTenantContext(tx, scope);

        // 1. Cargar propuesta almacenada (sin FOR SHARE / FOR UPDATE en tablas inmutables para pulso_app)
        const [storedProposal] = await tx.select().from(saleRecoveryProposals).where(and(
          eq(saleRecoveryProposals.id, data.proposalId),
          eq(saleRecoveryProposals.companyId, scope.companyId),
          eq(saleRecoveryProposals.branchId, scope.branchId),
        ));
        if (!storedProposal) {
          throw ApiError.notFound('Expediente de recuperación no encontrado');
        }

        // 2. Cargar decisión administrativa (sin FOR SHARE / FOR UPDATE para evitar PG 42501)
        const [decision] = await tx.select().from(saleRecoveryDecisions).where(
          eq(saleRecoveryDecisions.proposalId, storedProposal.id)
        );
        if (!decision) {
          throw ApiError.conflict('La propuesta no cuenta con una decisión administrativa registrada');
        }
        if (decision.decision !== 'APPROVED') {
          throw ApiError.conflict('La propuesta no ha sido aprobada');
        }

        // Segregación de funciones: quien decidió debe ser distinto al solicitante
        if (decision.decidedBy === storedProposal.requestedBy) {
          throw ApiError.forbidden('La decisión no cumple con la segregación de funciones');
        }

        // Rol del aprobador
        if (
          !['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(decision.approverRole) ||
          !hasPermission(decision.approverRole as Role, 'inventory', 'manage')
        ) {
          throw ApiError.forbidden('El aprobador carece de autoridad administrativa de inventario');
        }

        const proposalData = storedProposal.proposal;
        const saleDay = proposalData.identity.saleDay;

        // 3. Tomar advisory locks para serializar operaciones sobre el día y sucursal
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.companyId} || ':' || ${scope.branchId} || ':' || ${saleDay}, 0))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([scope.companyId, scope.branchId, saleDay])}, 0))`);

        // 4. Comprobar frescura de la venta legada en sales_entries
        const [legacy] = await tx.select({
          id: salesEntries.id,
          recipeId: salesEntries.recipeId,
          quantitySold: salesEntries.quantitySold,
          totalRevenue: salesEntries.totalRevenue,
          updatedAt: sql<string>`to_char(${salesEntries.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        }).from(salesEntries).where(and(
          eq(salesEntries.id, storedProposal.legacySaleId),
          eq(salesEntries.companyId, scope.companyId),
          eq(salesEntries.branchId, scope.branchId),
        )).for('share', { of: salesEntries });

        if (!legacy) {
          throw ApiError.conflict('La venta legada asociada a la propuesta ya no existe');
        }
        if (
          legacy.recipeId !== proposalData.legacy.recipeId ||
          legacy.quantitySold !== proposalData.legacy.quantitySold ||
          legacy.updatedAt !== proposalData.legacy.updatedAt
        ) {
          throw ApiError.conflict('La venta legada fue modificada con posterioridad a la propuesta');
        }

        // 5. Comprobar frescura de los adjuntos de evidencia
        const proofIds = proposalData.evidence.map(p => p.id);
        const proofRows = await tx.select({
          id: evidence.id,
          deletedAt: evidence.deletedAt,
          updatedAt: sql<string>`to_char(${evidence.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        }).from(evidence).where(and(
          inArray(evidence.id, proofIds),
          eq(evidence.companyId, scope.companyId),
          eq(evidence.branchId, scope.branchId),
        )).for('share', { of: evidence });

        if (proofRows.length !== proofIds.length) {
          throw ApiError.conflict('La evidencia documental de la propuesta no está disponible');
        }
        const proofMap = new Map(proofRows.map(r => [r.id, r]));
        for (const proof of proposalData.evidence) {
          const row = proofMap.get(proof.id);
          if (!row || row.deletedAt !== null) {
            throw ApiError.conflict('La evidencia documental de la propuesta fue retirada');
          }
          if (row.updatedAt !== proof.evidenceUpdatedAt) {
            throw ApiError.conflict('La evidencia documental fue alterada con posterioridad a la propuesta');
          }
        }

        // 6. Re-verificación de integridad de hashes
        const prepared = prepareSaleRecoveryReview(storedProposal.proposal);
        if (
          prepared.proposalHash !== storedProposal.proposalHash ||
          prepared.stateHash !== storedProposal.stateHash ||
          prepared.proposalHash !== decision.proposalHash ||
          prepared.stateHash !== decision.stateHash
        ) {
          throw ApiError.conflict('El expediente persistido es incompatible o sus hashes no coinciden');
        }

        // 7. Resolver identidad de consumo
        const identityData = normalizeSaleConsumptionIdentity(proposalData.identity);
        await tx.insert(salesConsumptionIdentities).values(identityData).onConflictDoNothing();
        const [identityRecord] = await tx.select().from(salesConsumptionIdentities).where(and(
          eq(salesConsumptionIdentities.companyId, identityData.companyId),
          eq(salesConsumptionIdentities.branchId, identityData.branchId),
          eq(salesConsumptionIdentities.source, identityData.source),
          eq(salesConsumptionIdentities.productKey, identityData.productKey),
          eq(salesConsumptionIdentities.saleDay, identityData.saleDay),
        ));
        if (!identityRecord) {
          throw ApiError.internal('No fue posible resolver la identidad de consumo');
        }

        // 8. Comprobación de idempotencia: si ya existe revisión 1 para esta identidad
        const [existingRevision] = await tx.select().from(salesConsumptionRevisions).where(and(
          eq(salesConsumptionRevisions.companyId, scope.companyId),
          eq(salesConsumptionRevisions.branchId, scope.branchId),
          eq(salesConsumptionRevisions.identityId, identityRecord.id),
        )).orderBy(salesConsumptionRevisions.revision).limit(1);

        if (existingRevision) {
          return {
            applied: false,
            alreadyApplied: true,
            revisionId: existingRevision.id,
            identityId: identityRecord.id,
          };
        }

        // 9. Descuento de stock y generación de movimientos
        const demand = prepared.demand;
        const allocations: AppliedSaleAllocation[] = [];
        const movementRefs: SaleConsumptionMovement[] = [];

        // Orden determinista por itemId para evitar deadlocks
        const sortedDemand = [...demand].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

        for (const req of sortedDemand) {
          const plan = await allocateScopedBatches(tx, {
            companyId: scope.companyId,
            branchId: scope.branchId,
            itemId: req.itemId,
            quantity: req.quantity,
          });

          if (plan.shortfallQuantity > 0) {
            throw ApiError.conflict('Stock insuficiente para aplicar recuperación histórica');
          }

          for (const alloc of plan.allocations) {
            const amountStr = alloc.quantity.toFixed(4);

            const updated = await tx.update(inventoryBatches)
              .set({
                currentQuantity: sql`${inventoryBatches.currentQuantity} - ${amountStr}::numeric`,
                updatedAt: new Date(),
              })
              .where(and(
                eq(inventoryBatches.id, alloc.batchId),
                eq(inventoryBatches.branchId, scope.branchId),
                eq(inventoryBatches.itemId, req.itemId),
                sql`${inventoryBatches.currentQuantity} >= ${amountStr}::numeric`,
              ))
              .returning({ id: inventoryBatches.id });

            if (!updated.length) {
              throw ApiError.conflict('Stock insuficiente para aplicar recuperación histórica');
            }

            const movementRows = (await tx.execute<{ id: string }>(sql`
              INSERT INTO public.inventory_movements
                (branch_id, item_id, batch_id, type, quantity_change, reference_id, performed_by, reason)
              VALUES
                (${scope.branchId}, ${req.itemId}, ${alloc.batchId}, 'USAGE', -${amountStr}::numeric,
                 ${'salecons:' + identityRecord.id}, ${user.id}, 'Venta revisión 1')
              RETURNING id
            `)).rows;

            const movementId = movementRows[0].id;

            allocations.push({
              itemId: req.itemId,
              batchId: alloc.batchId,
              unit: req.unit,
              movementId,
              remainingQuantity: amountStr,
            });

            movementRefs.push({
              movementId,
              itemId: req.itemId,
              batchId: alloc.batchId,
              unit: req.unit,
              quantityChange: `-${amountStr}`,
              reversesMovementId: null,
            });
          }
        }

        // 10. Crear revisión 1 en sales_consumption_revisions
        const [revision] = await tx.insert(salesConsumptionRevisions).values({
          identityId: identityRecord.id,
          companyId: scope.companyId,
          branchId: scope.branchId,
          revision: 1,
          previousRevision: null,
          previousQuantitySold: '0.00',
          quantitySold: soldQuantity(proposalData.legacy.quantitySold),
          totalRevenue: proposalData.legacy.totalRevenueCents,
          recipeId: proposalData.legacy.recipeId,
          recipeSnapshot: proposalData.recipeSnapshot,
          allocations,
          movementRefs,
          recordedBy: user.id,
          recordedAt: new Date(),
        }).returning({ id: salesConsumptionRevisions.id });

        // 11. Registrar bitácora de auditoría crítica AUD-02
        const auditLog = await AuditService.logCriticalInventoryAction({
          companyId: scope.companyId,
          branchId: scope.branchId,
          action: 'CREATE',
          entityType: 'ADJUSTMENT',
          entityId: revision.id,
          performedBy: user.id,
          reason: data.reason,
          isCritical: true,
          metadata: {
            subtype: 'SALE_RECOVERY_APPLY',
            proposalId: storedProposal.id,
            proposalHash: storedProposal.proposalHash,
            stateHash: storedProposal.stateHash,
            decisionId: decision.id,
            legacySaleId: storedProposal.legacySaleId,
            identityId: identityRecord.id,
            revisionId: revision.id,
            movementsCount: movementRefs.length,
          },
        }, tx);

        return {
          applied: true,
          revisionId: revision.id,
          identityId: identityRecord.id,
          movementsCount: movementRefs.length,
          auditLogId: auditLog?.id,
        };
      }, { isolationLevel: 'serializable' });
    } catch (error) {
      if (isApiError(error)) throw error;
      if (error instanceof AuditValidationError) {
        throw ApiError.badRequest(error.message);
      }
      if (error instanceof SaleRecoveryReviewError) {
        throw ApiError.conflict(error.message);
      }
      const failure = error as { code?: string; cause?: { code?: string }; message?: string };
      const pgCode = failure.cause?.code ?? failure.code;
      if (attempt < 2 && ['40001', '40P01'].includes(pgCode ?? '')) {
        continue;
      }
      if (['40001', '40P01'].includes(pgCode ?? '')) {
        throw ApiError.conflict('El estado cambió durante la aplicación; reintenta la operación');
      }
      throw ApiError.internal(failure.message || 'No fue posible aplicar la propuesta de recuperación');
    }
  }

  throw ApiError.conflict('La aplicación de recuperación no pudo completarse tras varios reintentos');
}
