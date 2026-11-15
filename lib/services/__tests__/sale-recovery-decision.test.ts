import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const f = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  context: vi.fn(),
  select: vi.fn(),
  execute: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/tenant-context', () => ({ requireAuth: f.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    select: f.select,
    transaction: f.transaction,
    execute: f.execute,
  },
}));
vi.mock('@/lib/db/tenant-context', () => ({
  setTenantContext: vi.fn(),
  withCompanyContext: f.context,
}));

import { getRecoveryProposalForReview, recordRecoveryDecision } from '../sale-recovery-decision';
import { prepareSaleRecoveryReview, type PreparedSaleRecoveryReview } from '../sale-recovery-review';
import { buildSaleRecipeSnapshot } from '../sale-consumption-snapshot';

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
    reason: 'Recuperación de venta no procesada',
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
      totalRevenueCents: null,
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
      reason: 'Recuperación de venta no procesada',
      proposal: prepared.proposal,
      createdAt: new Date('2026-11-01T02:00:00Z'),
    },
    prepared,
  };
}

interface MockTxOptions {
  proposalRow?: SampleProposalRow;
  existingDecision?: Record<string, unknown> | null;
  legacySale?: Record<string, unknown> | null;
  proofRows?: Array<{ id: string; deletedAt: Date | null; updatedAt: string }>;
  revisions?: Array<{ id: string }>;
  inserted?: Array<Record<string, unknown>>;
}

function mockTx(opts: MockTxOptions) {
  const proposalRow = opts.proposalRow;
  const existingDecision = opts.existingDecision ?? null;
  const legacySale = opts.legacySale !== undefined
    ? opts.legacySale
    : (proposalRow ? {
        id: proposalRow.legacySaleId,
        recipeId: proposalRow.proposal.legacy.recipeId,
        quantitySold: proposalRow.proposal.legacy.quantitySold,
        updatedAt: proposalRow.proposal.legacy.updatedAt,
      } : null);
  const proofRows = opts.proofRows !== undefined
    ? opts.proofRows
    : (proposalRow ? proposalRow.proposal.evidence.map((p) => ({
        id: p.id,
        deletedAt: null,
        updatedAt: p.evidenceUpdatedAt,
      })) : []);
  const revisions = opts.revisions ?? [];
  const inserted = opts.inserted ?? [];

  let selectCallCount = 0;
  f.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCallCount++;
            const getResult = () => {
              if (selectCallCount === 1) return proposalRow ? [proposalRow] : [];
              if (selectCallCount === 2) return existingDecision ? [existingDecision] : [];
              if (selectCallCount === 3) return legacySale ? [legacySale] : [];
              if (selectCallCount === 4) return proofRows;
              return [];
            };
            if (selectCallCount === 2) {
              return Promise.resolve(getResult());
            }
            return {
              for: vi.fn(() => Promise.resolve(getResult())),
              then: (resolve: (val: unknown) => void) => resolve(getResult()),
            };
          }),
        })),
      })),
      execute: vi.fn().mockResolvedValue({ rows: revisions }),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(inserted),
          })),
        })),
      })),
    };
    return callback(tx);
  });
}

describe('sale-recovery-decision unit tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    f.auth.mockResolvedValue({
      user: {
        id: 'independent-admin',
        role: 'ADMIN',
        companyId: id(1),
        branchId: null,
      },
    });
  });

  describe('getRecoveryProposalForReview', () => {
    it('rechaza consultas sin autenticación o con roles no administrativos', async () => {
      f.auth.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
      await expect(
        getRecoveryProposalForReview({ branchId: id(2), proposalId: id(40) })
      ).rejects.toMatchObject({ statusCode: 401 });

      for (const role of ['GERENTE', 'SUPERVISOR', 'EMPLEADO']) {
        f.auth.mockResolvedValue({ user: { id: 'user', role, companyId: id(1) } });
        await expect(
          getRecoveryProposalForReview({ branchId: id(2), proposalId: id(40) })
        ).rejects.toMatchObject({ statusCode: 403 });
      }
    });

    it('rechaza consulta con parámetros inválidos (extra fields o no UUID)', async () => {
      await expect(
        getRecoveryProposalForReview({ branchId: 'invalid-uuid', proposalId: id(40) })
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        getRecoveryProposalForReview({ branchId: id(2), proposalId: id(40), extra: true })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza 404 cuando el expediente no existe en la empresa y sucursal', async () => {
      f.context.mockImplementation(async (_scope: unknown, callback: (q: unknown) => Promise<unknown>) => {
        const queryMock = {
          select: () => ({
            from: () => ({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return callback(queryMock);
      });

      await expect(
        getRecoveryProposalForReview({ branchId: id(2), proposalId: id(40) })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('retorna propuesta con canDecide=true para revisor independiente sin decisión previa', async () => {
      const { proposalRow, prepared } = await createSampleProposal();

      f.context.mockImplementation(async (_scope: unknown, callback: (q: unknown) => Promise<unknown>) => {
        const queryMock = {
          select: vi.fn().mockReturnValueOnce({
            from: () => ({
              where: vi.fn().mockResolvedValue([proposalRow]),
            }),
          }).mockReturnValueOnce({
            from: () => ({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return callback(queryMock);
      });

      const result = await getRecoveryProposalForReview({ branchId: id(2), proposalId: proposalRow.id });
      expect(result.canDecide).toBe(true);
      expect(result.decision).toBeNull();
      expect(result.proposal.proposalHash).toBe(prepared.proposalHash);
      expect(result.proposal.evidenceSummary).toHaveLength(3);
    });

    it('retorna canDecide=false cuando el consultante es el solicitante', async () => {
      const { proposalRow } = await createSampleProposal();
      f.auth.mockResolvedValue({
        user: { id: 'requester-admin', role: 'ADMIN', companyId: id(1) },
      });

      f.context.mockImplementation(async (_scope: unknown, callback: (q: unknown) => Promise<unknown>) => {
        const queryMock = {
          select: vi.fn().mockReturnValueOnce({
            from: () => ({
              where: vi.fn().mockResolvedValue([proposalRow]),
            }),
          }).mockReturnValueOnce({
            from: () => ({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return callback(queryMock);
      });

      const result = await getRecoveryProposalForReview({ branchId: id(2), proposalId: proposalRow.id });
      expect(result.canDecide).toBe(false);
    });
  });

  describe('recordRecoveryDecision', () => {
    it('rechaza payloads con campos declarados por el cliente fuera del contrato estricto', async () => {
      const base = { branchId: id(2), proposalId: id(40), decision: 'APPROVED' };
      for (const extra of [
        { proposalHash: digest('x') },
        { stateHash: digest('y') },
        { requestedBy: 'user' },
        { decidedBy: 'user' },
        { decidedAt: new Date().toISOString() },
        { companyId: id(1) },
        { role: 'ADMIN' },
      ]) {
        await expect(recordRecoveryDecision({ ...base, ...extra })).rejects.toMatchObject({
          statusCode: 400,
        });
      }
      expect(f.transaction).not.toHaveBeenCalled();
    });

    it('rechaza autoaprobación (segregación de funciones: actorId === requestedBy)', async () => {
      const { proposalRow } = await createSampleProposal();
      f.auth.mockResolvedValue({
        user: { id: 'requester-admin', role: 'ADMIN', companyId: id(1) },
      });

      mockTx({ proposalRow });

      await expect(
        recordRecoveryDecision({
          branchId: id(2),
          proposalId: proposalRow.id,
          decision: 'APPROVED',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        message: 'La decisión administrativa requiere un actor independiente distinto al solicitante',
      });
    });

    it('rechaza cuando la venta legada fue modificada posteriormente (obsolescencia)', async () => {
      const { proposalRow } = await createSampleProposal();

      mockTx({
        proposalRow,
        legacySale: {
          id: proposalRow.legacySaleId,
          recipeId: proposalRow.proposal.legacy.recipeId,
          quantitySold: proposalRow.proposal.legacy.quantitySold,
          updatedAt: '2026-11-02T10:00:00.000000Z',
        },
      });

      await expect(
        recordRecoveryDecision({
          branchId: id(2),
          proposalId: proposalRow.id,
          decision: 'APPROVED',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'La venta legada fue modificada con posterioridad a la propuesta',
      });
    });

    it('rechaza cuando la evidencia fue retirada o alterada (deletedAt != null o updatedAt divergente)', async () => {
      const { proposalRow } = await createSampleProposal();

      // Prueba con evidencia retirada (deletedAt !== null)
      mockTx({
        proposalRow,
        proofRows: proposalRow.proposal.evidence.map((p, idx) => ({
          id: p.id,
          deletedAt: idx === 0 ? new Date() : null,
          updatedAt: p.evidenceUpdatedAt,
        })),
      });

      await expect(
        recordRecoveryDecision({
          branchId: id(2),
          proposalId: proposalRow.id,
          decision: 'APPROVED',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'La evidencia documental de la propuesta fue retirada',
      });
    });

    it('rechaza cuando existen revisiones de consumo intermedias para el producto/receta', async () => {
      const { proposalRow } = await createSampleProposal();

      mockTx({
        proposalRow,
        revisions: [{ id: id(99) }],
      });

      await expect(
        recordRecoveryDecision({
          branchId: id(2),
          proposalId: proposalRow.id,
          decision: 'APPROVED',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'La venta o proyección ya tiene revisiones; la propuesta es obsoleta',
      });
    });

    it('aprueba legítimamente una propuesta válida por un administrador independiente', async () => {
      const { proposalRow } = await createSampleProposal();
      const decisionId = id(50);

      mockTx({
        proposalRow,
        inserted: [{
          id: decisionId,
          proposalId: proposalRow.id,
          decision: 'APPROVED',
          decidedBy: 'independent-admin',
          approverRole: 'ADMIN',
          decidedAt: new Date(),
        }],
      });

      const result = await recordRecoveryDecision({
        branchId: id(2),
        proposalId: proposalRow.id,
        decision: 'APPROVED',
      });

      expect(result).toMatchObject({
        id: decisionId,
        created: true,
        proposalId: proposalRow.id,
        decision: 'APPROVED',
        decidedBy: 'independent-admin',
        approverRole: 'ADMIN',
      });
    });

    it('registra rechazo legítimo (REJECTED) por un administrador independiente', async () => {
      const { proposalRow } = await createSampleProposal();
      const decisionId = id(51);

      mockTx({
        proposalRow,
        inserted: [{
          id: decisionId,
          proposalId: proposalRow.id,
          decision: 'REJECTED',
          decidedBy: 'independent-admin',
          approverRole: 'ADMIN',
          decidedAt: new Date(),
        }],
      });

      const result = await recordRecoveryDecision({
        branchId: id(2),
        proposalId: proposalRow.id,
        decision: 'REJECTED',
      });

      expect(result).toMatchObject({
        id: decisionId,
        created: true,
        decision: 'REJECTED',
      });
    });

    it('reintento idéntico del mismo decisor devuelve registro existente con created=false', async () => {
      const { proposalRow } = await createSampleProposal();
      const existingRecord = {
        id: id(52),
        proposalId: proposalRow.id,
        decision: 'APPROVED',
        decidedBy: 'independent-admin',
        approverRole: 'ADMIN',
        decidedAt: new Date(),
      };

      mockTx({
        proposalRow,
        existingDecision: existingRecord,
      });

      const result = await recordRecoveryDecision({
        branchId: id(2),
        proposalId: proposalRow.id,
        decision: 'APPROVED',
      });

      expect(result).toEqual({
        id: existingRecord.id,
        created: false,
        proposalId: existingRecord.proposalId,
        decision: 'APPROVED',
        decidedBy: 'independent-admin',
        approverRole: 'ADMIN',
        decidedAt: existingRecord.decidedAt,
      });
    });

    it('reintento con decisión distinta o distinto decisor lanza 409 Conflict', async () => {
      const { proposalRow } = await createSampleProposal();
      const existingRecord = {
        id: id(53),
        proposalId: proposalRow.id,
        decision: 'APPROVED',
        decidedBy: 'independent-admin',
        approverRole: 'ADMIN',
        decidedAt: new Date(),
      };

      mockTx({
        proposalRow,
        existingDecision: existingRecord,
      });

      // Misma persona pero quiere cambiar a REJECTED -> 409
      await expect(
        recordRecoveryDecision({
          branchId: id(2),
          proposalId: proposalRow.id,
          decision: 'REJECTED',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'La propuesta ya cuenta con una decisión administrativa registrada',
      });
    });
  });
});
