import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  salesEntries,
  evidence,
  saleRecoveryProposals,
  saleRecoveryDecisions,
} from '@/lib/db/schema';
import { setTenantContext, withCompanyContext } from '@/lib/db/tenant-context';
import { requireAuth } from '@/lib/tenant-context';
import { resolveBranchScope } from '@/lib/branch-scope';
import { hasPermission } from '@/lib/permissions';
import { ApiError, isApiError } from '@/lib/api/error';
import {
  prepareSaleRecoveryReview,
  assertRecoveryReviewMatches,
  SaleRecoveryReviewError,
} from './sale-recovery-review';

const uuid = z.string().uuid().toLowerCase();

const decisionRefSchema = z.object({
  branchId: uuid,
  proposalId: uuid,
}).strict();

const decisionInputSchema = decisionRefSchema.extend({
  decision: z.enum(['APPROVED', 'REJECTED']),
}).strict();

export type DecisionRef = z.infer<typeof decisionRefSchema>;
export type DecisionInput = z.infer<typeof decisionInputSchema>;

type Scope = { companyId: string; branchId: string; actorId: string };

async function actor() {
  const { user } = await requireAuth();
  if (
    !user ||
    typeof user.id !== 'string' ||
    !user.id.trim() ||
    user.id !== user.id.trim() ||
    user.id.length > 256 ||
    !uuid.safeParse(user.companyId).success ||
    !['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(user.role) ||
    !hasPermission(user.role, 'inventory', 'manage')
  ) {
    throw ApiError.forbidden('La decisión requiere una sesión administrativa de la empresa');
  }
  return {
    id: user.id,
    role: user.role as 'ADMIN' | 'OWNER' | 'SUPER_ADMIN',
    companyId: uuid.parse(user.companyId),
    branchId: typeof user.branchId === 'string' ? user.branchId.toLowerCase() : null,
  };
}

function scopeFor(user: Awaited<ReturnType<typeof actor>>, branchId: string): Scope {
  const scope = resolveBranchScope(user.role, user.branchId, branchId);
  if (scope.kind !== 'BRANCH' || scope.branchId !== branchId) {
    throw ApiError.forbidden('Sucursal fuera del alcance autorizado');
  }
  return { companyId: user.companyId, branchId, actorId: user.id };
}

/**
 * Consulta un expediente preparado para revisión administrativa independiente.
 * El servidor carga el estado desde la base de datos y calcula la demanda y elegibilidad del actor.
 */
export async function getRecoveryProposalForReview(input: unknown) {
  const parsed = decisionRefSchema.safeParse(input);
  if (!parsed.success) throw ApiError.badRequest('Parámetros de consulta de expediente inválidos');
  const user = await actor();
  const scope = scopeFor(user, parsed.data.branchId);

  return withCompanyContext(scope, async q => {
    const [proposalRow] = await q.select().from(saleRecoveryProposals).where(and(
      eq(saleRecoveryProposals.id, parsed.data.proposalId),
      eq(saleRecoveryProposals.companyId, scope.companyId),
      eq(saleRecoveryProposals.branchId, scope.branchId),
    ));
    if (!proposalRow) throw ApiError.notFound('Expediente de recuperación no encontrado');

    const prepared = prepareSaleRecoveryReview(proposalRow.proposal);
    if (prepared.proposalHash !== proposalRow.proposalHash || prepared.stateHash !== proposalRow.stateHash) {
      throw ApiError.conflict('El expediente persistido es incompatible o ha sido alterado');
    }

    const [existingDecision] = await q.select().from(saleRecoveryDecisions).where(
      eq(saleRecoveryDecisions.proposalId, proposalRow.id)
    );

    const proposalEnvelope = proposalRow.proposal as {
      identity: unknown;
      legacy: unknown;
      evidence: Array<{
        id: string;
        attestationId: string;
        purpose: string;
        verifiedBy: string;
        verifiedRole: string;
        verifiedAt: string;
      }>;
    };

    return {
      proposal: {
        id: proposalRow.id,
        companyId: proposalRow.companyId,
        branchId: proposalRow.branchId,
        legacySaleId: proposalRow.legacySaleId,
        requestedBy: proposalRow.requestedBy,
        reason: proposalRow.reason,
        createdAt: proposalRow.createdAt,
        proposalHash: proposalRow.proposalHash,
        stateHash: proposalRow.stateHash,
        identity: proposalEnvelope.identity,
        legacy: proposalEnvelope.legacy,
        demand: prepared.demand,
        evidenceSummary: proposalEnvelope.evidence.map(p => ({
          id: p.id,
          attestationId: p.attestationId,
          purpose: p.purpose,
          verifiedBy: p.verifiedBy,
          verifiedRole: p.verifiedRole,
          verifiedAt: p.verifiedAt,
        })),
      },
      decision: existingDecision ? {
        id: existingDecision.id,
        decision: existingDecision.decision,
        decidedBy: existingDecision.decidedBy,
        approverRole: existingDecision.approverRole,
        decidedAt: existingDecision.decidedAt,
      } : null,
      canDecide: user.id !== proposalRow.requestedBy && !existingDecision,
    };
  });
}

/**
 * Registra una decisión administrativa independiente (APPROVED o REJECTED).
 * Carga el estado del servidor a partir de { branchId, proposalId, decision }.
 * Exige segregación de funciones (actor != requestedBy) y valida frescura de estado.
 */
export async function recordRecoveryDecision(input: unknown) {
  const parsed = decisionInputSchema.safeParse(input);
  if (!parsed.success) throw ApiError.badRequest('Datos de decisión inválidos');
  const data = parsed.data;
  const user = await actor();
  const scope = scopeFor(user, data.branchId);

  try {
    return await db.transaction(async tx => {
      await setTenantContext(tx, scope);

      const [storedProposal] = await tx.select().from(saleRecoveryProposals).where(and(
        eq(saleRecoveryProposals.id, data.proposalId),
        eq(saleRecoveryProposals.companyId, scope.companyId),
        eq(saleRecoveryProposals.branchId, scope.branchId),
      ));
      if (!storedProposal) throw ApiError.notFound('Expediente de recuperación no encontrado');

      // Segregación de funciones: el revisor debe ser un actor distinto al solicitante
      if (storedProposal.requestedBy === user.id) {
        throw ApiError.forbidden('La decisión administrativa requiere un actor independiente distinto al solicitante');
      }

      // Verificación de integridad de hashes del expediente almacenado
      const prepared = prepareSaleRecoveryReview(storedProposal.proposal);
      if (prepared.proposalHash !== storedProposal.proposalHash || prepared.stateHash !== storedProposal.stateHash) {
        throw ApiError.conflict('El expediente persistido es incompatible o ha sido alterado');
      }

      // Verificación de idempotencia
      const [existing] = await tx.select().from(saleRecoveryDecisions).where(
        eq(saleRecoveryDecisions.proposalId, storedProposal.id)
      );
      if (existing) {
        if (existing.decidedBy === user.id && existing.decision === data.decision) {
          return {
            id: existing.id,
            created: false,
            proposalId: existing.proposalId,
            decision: existing.decision,
            decidedBy: existing.decidedBy,
            approverRole: existing.approverRole,
            decidedAt: existing.decidedAt,
          };
        }
        throw ApiError.conflict('La propuesta ya cuenta con una decisión administrativa registrada');
      }

      // Comprobar frescura de la venta legada (no modificada)
      const [legacy] = await tx.select({
        id: salesEntries.id,
        recipeId: salesEntries.recipeId,
        quantitySold: salesEntries.quantitySold,
        updatedAt: sql<string>`to_char(${salesEntries.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      }).from(salesEntries).where(and(
        eq(salesEntries.id, storedProposal.legacySaleId),
        eq(salesEntries.companyId, scope.companyId),
        eq(salesEntries.branchId, scope.branchId),
      )).for('share', { of: salesEntries });

      const proposalData = prepared.proposal;
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

      // Comprobar frescura de los adjuntos de evidencia (no retirados ni alterados)
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

      // Comprobar que no existan revisiones de consumo intermedias para el producto/receta y día
      const sale = proposalData.identity;
      const revisions = await tx.execute(sql`
        SELECT r.id FROM sales_consumption_revisions r
        JOIN sales_consumption_identities i ON i.id = r.identity_id
        WHERE r.company_id = ${scope.companyId} AND r.branch_id = ${scope.branchId}
          AND i.company_id = ${scope.companyId} AND i.branch_id = ${scope.branchId}
          AND i.sale_day = ${sale.saleDay}::date
          AND (r.recipe_id = ${legacy.recipeId}::uuid OR (i.source = ${sale.source} AND i.product_key = ${sale.productKey}))
        LIMIT 1
      `);
      if (revisions.rows.length) {
        throw ApiError.conflict('La venta o proyección ya tiene revisiones; la propuesta es obsoleta');
      }

      // Validación canónica para decisiones de aprobación
      if (data.decision === 'APPROVED') {
        const decisionRecord = {
          companyId: scope.companyId,
          branchId: scope.branchId,
          proposalHash: storedProposal.proposalHash,
          stateHash: storedProposal.stateHash,
          decision: 'APPROVED',
          approvedBy: user.id,
          approverRole: user.role,
          approvedAt: new Date().toISOString(),
        };
        assertRecoveryReviewMatches(prepared, decisionRecord, storedProposal.proposal);
      }

      // Inserción inmutable de la decisión
      const values = {
        proposalId: storedProposal.id,
        companyId: scope.companyId,
        branchId: scope.branchId,
        proposalHash: storedProposal.proposalHash,
        stateHash: storedProposal.stateHash,
        requestedBy: storedProposal.requestedBy,
        decision: data.decision,
        decidedBy: user.id,
        approverRole: user.role,
        decidedAt: sql`clock_timestamp()`,
      };

      const inserted = await tx.insert(saleRecoveryDecisions)
        .values(values)
        .onConflictDoNothing({ target: [saleRecoveryDecisions.proposalId] })
        .returning();

      if (inserted.length === 0) {
        const [concurrent] = await tx.select().from(saleRecoveryDecisions).where(
          eq(saleRecoveryDecisions.proposalId, storedProposal.id)
        );
        if (concurrent && concurrent.decidedBy === user.id && concurrent.decision === data.decision) {
          return {
            id: concurrent.id,
            created: false,
            proposalId: concurrent.proposalId,
            decision: concurrent.decision,
            decidedBy: concurrent.decidedBy,
            approverRole: concurrent.approverRole,
            decidedAt: concurrent.decidedAt,
          };
        }
        throw ApiError.conflict('La propuesta ya cuenta con una decisión administrativa registrada');
      }

      const stored = inserted[0];
      return {
        id: stored.id,
        created: true,
        proposalId: stored.proposalId,
        decision: stored.decision,
        decidedBy: stored.decidedBy,
        approverRole: stored.approverRole,
        decidedAt: stored.decidedAt,
      };
    }, { isolationLevel: 'serializable' });
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof SaleRecoveryReviewError) throw ApiError.conflict(error.message);
    const failure = error as { code?: string; cause?: { code?: string } };
    const code = failure?.cause?.code ?? failure?.code;
    if (typeof code === 'string' && ['40001', '40P01'].includes(code)) {
      throw ApiError.conflict('El estado cambió durante la decisión; reintenta la operación');
    }
    if (code === '23514') {
      throw ApiError.conflict('Violación de restricción de integridad en la decisión');
    }
    console.error('[sale-recovery-decision] Database operation failed', {
      code: typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'UNKNOWN',
    });
    throw ApiError.internal('No fue posible registrar la decisión administrativa');
  }
}
