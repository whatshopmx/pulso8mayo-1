import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const f = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  select: vi.fn(),
  execute: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  allocateBatches: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('@/lib/tenant-context', () => ({ requireAuth: f.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    select: f.select,
    transaction: f.transaction,
    execute: f.execute,
    insert: f.insert,
    update: f.update,
  },
}));
vi.mock('@/lib/db/tenant-context', () => ({
  setTenantContext: vi.fn(),
}));
vi.mock('../fefo-allocator', () => ({
  allocateScopedBatches: f.allocateBatches,
}));
vi.mock('../audit-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../audit-service')>();
  return {
    ...actual,
    AuditService: {
      ...actual.AuditService,
      logCriticalInventoryAction: f.auditLog,
    },
  };
});

import { applySaleRecoveryProposal } from '../sale-recovery-apply';
import { prepareSaleRecoveryReview, type PreparedSaleRecoveryReview } from '../sale-recovery-review';
import { buildSaleRecipeSnapshot } from '../sale-consumption-snapshot';
import { ApiError } from '@/lib/api/error';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

interface SampleProposalRow {
  id: string;
  companyId: string;
  branchId: string;
  legacySaleId: string;
  idempotencyKey: string;
  proposalHash: string;
  stateHash: string;
  requestedBy: string;
  reason: string;
  proposal: PreparedSaleRecoveryReview['proposal'];
  createdAt: Date;
}

async function createSampleProposal(patch: Record<string, unknown> = {}): Promise<{
  proposalRow: SampleProposalRow;
  prepared: PreparedSaleRecoveryReview;
}> {
  const companyId = id(1);
  const branchId = id(2);
  const legacySaleId = id(3);
  const recipeId = id(4);
  const itemId = id(5);
  const proofs = [id(10), id(11), id(12)];
  const attestations = [id(20), id(21), id(22)];
  const purposes = ['SALE', 'RECIPE_VERSION', 'NO_PRIOR_CONSUMPTION'] as const;

  const snapshot = await buildSaleRecipeSnapshot(companyId, recipeId, {
    recipe: async () => ({
      id: recipeId,
      companyId,
      baseYield: '1',
      unit: 'PORTION',
      items: [{ id: id(15), itemId, quantity: '1', unit: 'KG', isSubRecipe: false, yieldPercent: 100 }],
    }),
    ingredient: async () => ({ id: itemId, companyId, unit: 'KG' }),
    conversions: async () => [],
  });

  const evidenceItems = proofs.map((proofId, i) => ({
    id: proofId,
    attestationId: attestations[i],
    companyId,
    branchId,
    legacySaleId,
    purpose: purposes[i],
    storageKey: `companies/${companyId}/branches/${branchId}/sales-recovery/${legacySaleId}/${proofId}`,
    contentSha256: digest(`evidence-${i}`),
    byteLength: 1024,
    sourceReference: `Ref-${i}`,
    verificationReason: 'Auditoría verificada',
    verifiedRole: 'ADMIN' as const,
    verifiedBy: 'requester-admin',
    evidenceUpdatedAt: '2026-11-01T00:00:00.123456Z',
    createdAt: '2026-11-01T00:00:00.000000Z',
    verifiedAt: '2026-11-01T01:00:00.000000Z',
    deletedAt: null,
  }));

  const proposalEnvelope = {
    schemaVersion: 2 as const,
    idempotencyKey: id(30),
    requestedBy: 'requester-admin',
    reason: 'Recuperación de venta histórica no aplicada',
    identity: {
      companyId,
      branchId,
      source: 'pos:main',
      productKey: 'SKU-01',
      saleDay: '2026-11-01',
    },
    legacy: {
      id: legacySaleId,
      companyId,
      branchId,
      recipeId,
      saleDay: '2026-11-01',
      quantitySold: '1',
      totalRevenueCents: 1500,
      updatedAt: '2026-11-01T00:00:00.123456Z',
    },
    observedHeadId: null,
    consumptionState: 'NOT_APPLIED' as const,
    observedMovementIds: [],
    recipeSnapshot: snapshot,
    evidence: evidenceItems,
    ...patch,
  };

  const prepared = prepareSaleRecoveryReview(proposalEnvelope);
  return {
    proposalRow: {
      id: id(40),
      companyId,
      branchId,
      legacySaleId,
      idempotencyKey: id(30),
      proposalHash: prepared.proposalHash,
      stateHash: prepared.stateHash,
      requestedBy: 'requester-admin',
      reason: 'Recuperación de venta histórica no aplicada',
      proposal: prepared.proposal,
      createdAt: new Date('2026-11-01T02:00:00Z'),
    },
    prepared,
  };
}

interface MockTxOptions {
  proposalRow?: SampleProposalRow;
  decision?: Record<string, unknown> | null;
  legacySale?: Record<string, unknown> | null;
  proofRows?: Array<{ id: string; deletedAt: Date | null; updatedAt: string }>;
  identityRecord?: Record<string, unknown> | null;
  existingRevision?: Record<string, unknown> | null;
  batchAllocations?: Array<{ batchId: string; quantity: number; unitCost: number | null }>;
  shortfallQuantity?: number;
  batchUpdateSuccess?: boolean;
}

function setupMockTx(opts: MockTxOptions) {
  const proposalRow = opts.proposalRow;
  const decision = opts.decision !== undefined
    ? opts.decision
    : (proposalRow ? {
        id: id(50),
        proposalId: proposalRow.id,
        companyId: proposalRow.companyId,
        branchId: proposalRow.branchId,
        proposalHash: proposalRow.proposalHash,
        stateHash: proposalRow.stateHash,
        requestedBy: proposalRow.requestedBy,
        decision: 'APPROVED',
        decidedBy: 'decider-admin',
        approverRole: 'ADMIN',
        decidedAt: new Date('2026-11-01T03:00:00Z'),
      } : null);

  const legacySale = opts.legacySale !== undefined
    ? opts.legacySale
    : (proposalRow ? {
        id: proposalRow.legacySaleId,
        recipeId: proposalRow.proposal.legacy.recipeId,
        quantitySold: proposalRow.proposal.legacy.quantitySold,
        totalRevenue: proposalRow.proposal.legacy.totalRevenueCents,
        updatedAt: proposalRow.proposal.legacy.updatedAt,
      } : null);

  const proofRows = opts.proofRows !== undefined
    ? opts.proofRows
    : (proposalRow ? proposalRow.proposal.evidence.map(p => ({
        id: p.id,
        deletedAt: null,
        updatedAt: p.evidenceUpdatedAt,
      })) : []);

  const identityRecord = opts.identityRecord !== undefined
    ? opts.identityRecord
    : (proposalRow ? {
        id: id(60),
        companyId: proposalRow.companyId,
        branchId: proposalRow.branchId,
        source: proposalRow.proposal.identity.source,
        productKey: proposalRow.proposal.identity.productKey,
        saleDay: proposalRow.proposal.identity.saleDay,
      } : null);

  const existingRevision = opts.existingRevision ?? null;

  f.allocateBatches.mockResolvedValue({
    allocations: opts.batchAllocations ?? [{ batchId: id(70), quantity: 1, unitCost: 100 }],
    requestedQuantity: 1,
    allocatedQuantity: opts.batchAllocations ? opts.batchAllocations.reduce((s, a) => s + a.quantity, 0) : 1,
    shortfallQuantity: opts.shortfallQuantity ?? 0,
  });

  f.auditLog.mockResolvedValue({ id: id(99) });

  let selectCallCount = 0;

  const mockTxInstance = {
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      return {
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            const baseQuery = {
              for: vi.fn().mockReturnValue(
                selectCallCount === 3
                  ? (legacySale ? [legacySale] : [])
                  : selectCallCount === 4
                  ? proofRows
                  : []
              ),
              orderBy: vi.fn().mockImplementation(() => ({
                limit: vi.fn().mockReturnValue(existingRevision ? [existingRevision] : []),
              })),
            };

            // 1. saleRecoveryProposals
            if (selectCallCount === 1) {
              return Object.assign(Promise.resolve(proposalRow ? [proposalRow] : []), baseQuery);
            }
            // 2. saleRecoveryDecisions
            if (selectCallCount === 2) {
              return Object.assign(Promise.resolve(decision ? [decision] : []), baseQuery);
            }
            // 3. salesEntries
            if (selectCallCount === 3) {
              return Object.assign(Promise.resolve(legacySale ? [legacySale] : []), baseQuery);
            }
            // 4. evidence
            if (selectCallCount === 4) {
              return Object.assign(Promise.resolve(proofRows), baseQuery);
            }
            // 5. salesConsumptionIdentities
            if (selectCallCount === 5) {
              return Object.assign(Promise.resolve(identityRecord ? [identityRecord] : []), baseQuery);
            }
            // 6. salesConsumptionRevisions
            if (selectCallCount === 6) {
              return Object.assign(Promise.resolve(existingRevision ? [existingRevision] : []), baseQuery);
            }

            return Object.assign(Promise.resolve([]), baseQuery);
          }),
        })),
      };
    }),
    execute: vi.fn().mockImplementation(() => Promise.resolve({ rows: [{ id: id(80) }] })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(() => ({
        onConflictDoNothing: vi.fn().mockReturnValue(Promise.resolve()),
        returning: vi.fn().mockReturnValue(Promise.resolve([{ id: id(90) }])),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          returning: vi.fn().mockReturnValue(
            opts.batchUpdateSuccess === false ? Promise.resolve([]) : Promise.resolve([{ id: id(70) }])
          ),
        })),
      })),
    })),
  };

  f.transaction.mockImplementation((work: (tx: typeof mockTxInstance) => Promise<unknown>) =>
    work(mockTxInstance)
  );

  return mockTxInstance;
}

describe('sale-recovery-apply (unit tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aplica exitosamente un expediente aprobado con asignación de stock, revisión 1 y auditoría AUD-02', async () => {
    const { proposalRow } = await createSampleProposal();
    const tx = setupMockTx({ proposalRow });

    const result = await applySaleRecoveryProposal({
      branchId: proposalRow.branchId,
      proposalId: proposalRow.id,
      reason: 'Aplicación autorizada de recuperación histórica por inventario físico comprobado',
      user: {
        id: 'admin-applier',
        role: 'ADMIN',
        companyId: proposalRow.companyId,
      },
    });

    expect(result.applied).toBe(true);
    expect(result.alreadyApplied).toBeUndefined();
    expect(result.revisionId).toBe(id(90));
    expect(result.identityId).toBe(id(60));
    expect(result.movementsCount).toBe(1);
    expect(result.auditLogId).toBe(id(99));

    // Verificar llamada a AUD-02
    expect(f.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: proposalRow.companyId,
        branchId: proposalRow.branchId,
        action: 'CREATE',
        entityType: 'ADJUSTMENT',
        entityId: id(90),
        performedBy: 'admin-applier',
        isCritical: true,
        metadata: expect.objectContaining({
          subtype: 'SALE_RECOVERY_APPLY',
          proposalId: proposalRow.id,
          legacySaleId: proposalRow.legacySaleId,
          identityId: id(60),
          revisionId: id(90),
          movementsCount: 1,
        }),
      }),
      tx
    );

    // Verificar inserción de movimientos
    expect(tx.execute).toHaveBeenCalled();
  });

  it('reintento idempotente devuelve alreadyApplied: true sin duplicar movimientos ni revisión', async () => {
    const { proposalRow } = await createSampleProposal();
    const existingRevision = {
      id: id(90),
      identityId: id(60),
      revision: 1,
      quantitySold: '1.00',
    };
    setupMockTx({ proposalRow, existingRevision });

    const result = await applySaleRecoveryProposal({
      branchId: proposalRow.branchId,
      proposalId: proposalRow.id,
      reason: 'Reintento de aplicación de recuperación histórica',
      user: {
        id: 'admin-applier',
        role: 'ADMIN',
        companyId: proposalRow.companyId,
      },
    });

    expect(result.applied).toBe(false);
    expect(result.alreadyApplied).toBe(true);
    expect(result.revisionId).toBe(id(90));
    expect(result.identityId).toBe(id(60));
    expect(f.allocateBatches).not.toHaveBeenCalled();
    expect(f.auditLog).not.toHaveBeenCalled();
  });

  it('rechaza con 404 si el expediente no existe', async () => {
    setupMockTx({ proposalRow: undefined });

    await expect(
      applySaleRecoveryProposal({
        branchId: id(2),
        proposalId: id(40),
        reason: 'Motivo válido de auditoría',
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: id(1),
        },
      })
    ).rejects.toThrow(ApiError);

    await expect(
      applySaleRecoveryProposal({
        branchId: id(2),
        proposalId: id(40),
        reason: 'Motivo válido de auditoría',
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: id(1),
        },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 409 si la decisión administrativa no existe', async () => {
    const { proposalRow } = await createSampleProposal();
    setupMockTx({ proposalRow, decision: null });

    await expect(
      applySaleRecoveryProposal({
        branchId: proposalRow.branchId,
        proposalId: proposalRow.id,
        reason: 'Motivo válido de auditoría',
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: proposalRow.companyId,
        },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rechaza con 409 si la decisión administrativa fue REJECTED', async () => {
    const { proposalRow } = await createSampleProposal();
    setupMockTx({
      proposalRow,
      decision: {
        id: id(50),
        proposalId: proposalRow.id,
        companyId: proposalRow.companyId,
        branchId: proposalRow.branchId,
        decision: 'REJECTED',
        decidedBy: 'decider-admin',
        approverRole: 'ADMIN',
      },
    });

    await expect(
      applySaleRecoveryProposal({
        branchId: proposalRow.branchId,
        proposalId: proposalRow.id,
        reason: 'Motivo válido de auditoría',
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: proposalRow.companyId,
        },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rechaza con 400 si el motivo de auditoría tiene menos de 4 caracteres (regla AUD-02)', async () => {
    const { proposalRow } = await createSampleProposal();
    setupMockTx({ proposalRow });

    await expect(
      applySaleRecoveryProposal({
        branchId: proposalRow.branchId,
        proposalId: proposalRow.id,
        reason: 'abc', // < 4 caracteres
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: proposalRow.companyId,
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rechaza con 403 si la decisión no cumple segregación de funciones (decidedBy === requestedBy)', async () => {
    const { proposalRow } = await createSampleProposal();
    setupMockTx({
      proposalRow,
      decision: {
        id: id(50),
        proposalId: proposalRow.id,
        companyId: proposalRow.companyId,
        branchId: proposalRow.branchId,
        proposalHash: proposalRow.proposalHash,
        stateHash: proposalRow.stateHash,
        requestedBy: proposalRow.requestedBy,
        decision: 'APPROVED',
        decidedBy: proposalRow.requestedBy, // Mismo actor
        approverRole: 'ADMIN',
        decidedAt: new Date(),
      },
    });

    await expect(
      applySaleRecoveryProposal({
        branchId: proposalRow.branchId,
        proposalId: proposalRow.id,
        reason: 'Motivo válido de auditoría',
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: proposalRow.companyId,
        },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rechaza con 409 si la venta legada fue modificada posteriormente (frescura documental)', async () => {
    const { proposalRow } = await createSampleProposal();
    setupMockTx({
      proposalRow,
      legacySale: {
        id: proposalRow.legacySaleId,
        recipeId: proposalRow.proposal.legacy.recipeId,
        quantitySold: '2.00', // Modificado respecto a la propuesta
        updatedAt: '2026-11-02T00:00:00.000000Z',
      },
    });

    await expect(
      applySaleRecoveryProposal({
        branchId: proposalRow.branchId,
        proposalId: proposalRow.id,
        reason: 'Motivo válido de auditoría',
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: proposalRow.companyId,
        },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rechaza con 409 si una de las evidencias fue retirada (deletedAt no nulo)', async () => {
    const { proposalRow } = await createSampleProposal();
    const proofRows = proposalRow.proposal.evidence.map((p, i) => ({
      id: p.id,
      deletedAt: i === 0 ? new Date() : null, // Evidencia retirada
      updatedAt: p.evidenceUpdatedAt,
    }));
    setupMockTx({ proposalRow, proofRows });

    await expect(
      applySaleRecoveryProposal({
        branchId: proposalRow.branchId,
        proposalId: proposalRow.id,
        reason: 'Motivo válido de auditoría',
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: proposalRow.companyId,
        },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('revierte y arroja 409 si el stock disponible es insuficiente', async () => {
    const { proposalRow } = await createSampleProposal();
    setupMockTx({
      proposalRow,
      shortfallQuantity: 0.5, // Stock insuficiente
    });

    await expect(
      applySaleRecoveryProposal({
        branchId: proposalRow.branchId,
        proposalId: proposalRow.id,
        reason: 'Motivo válido de auditoría',
        user: {
          id: 'admin-applier',
          role: 'ADMIN',
          companyId: proposalRow.companyId,
        },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
