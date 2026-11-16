import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  companies,
  branches,
  recipes,
  salesEntries,
  users,
  evidence,
  inventoryItems,
  inventoryBatches,
  inventoryMovements,
  inventoryAuditLog,
  salesConsumptionRevisions,
} from '@/lib/db/schema';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  context: vi.fn(),
  read: vi.fn(),
  sign: vi.fn(),
  configured: vi.fn(),
}));

vi.mock('@/lib/tenant-context', () => ({ requireAuth: fakes.auth }));
vi.mock('@/lib/storage/r2-client', () => ({
  getFromR2: fakes.read,
  generatePresignedUrl: fakes.sign,
  isR2Configured: fakes.configured,
}));
vi.mock('@/lib/db/tenant-context', async (original) => ({
  ...await original<typeof import('@/lib/db/tenant-context')>(),
  withCompanyContext: fakes.context,
}));

import { setTenantContext } from '@/lib/db/tenant-context';
import { recordRecoveryAttestation } from '@/lib/services/sale-recovery-attestations';
import { registerRecoveryProposal } from '@/lib/services/sale-recovery-proposals';
import { recordRecoveryDecision } from '@/lib/services/sale-recovery-decision';
import { applySaleRecoveryProposal } from '@/lib/services/sale-recovery-apply';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = {
  company: string[];
  branch: string[];
  sale: string[];
  proof: string[];
  actor: string[]; // actor[0]: requester, actor[1]: decider, actor[2]: applier, actor[3]: third
  item: string[];
  batch: string[];
};

const digest = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

const attestationBody = (f: Fixture) => ({
  branchId: f.branch[0],
  legacySaleId: f.sale[0],
  evidenceId: f.proof[0],
  idempotencyKey: randomUUID(),
  purpose: 'SALE' as const,
  sourceReference: 'Corte fiscal 001',
  reason: 'Auditoría física y documental',
  expectedContentSha256: digest,
});

async function probe(work: (tx: Tx, f: Fixture) => Promise<void>) {
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
  const f: Fixture = {
    company: ids(2),
    branch: ids(3),
    sale: ids(3),
    proof: ids(3),
    actor: ids(4),
    item: ids(2),
    batch: ids(2),
  };

  fakes.auth.mockReset();
  fakes.context.mockReset();
  fakes.read.mockReset();
  fakes.sign.mockReset();
  fakes.configured.mockReturnValue(true);
  fakes.read.mockResolvedValue(Buffer.from('hello'));
  fakes.sign.mockResolvedValue('https://private.test/signed');

  await db.transaction(async (tx) => {
    // Aplicar migraciones idempotentes de esquema necesarias
    for (const statement of readFileSync('drizzle/0143_inv01c_recovery_review.sql', 'utf8')
      .split('--> statement-breakpoint')
      .filter((s) => s.trim())) {
      await tx.execute(sql.raw(statement));
    }
    for (const statement of readFileSync('drizzle/0145_inv01c_recovery_attestations.sql', 'utf8')
      .split('--> statement-breakpoint')
      .filter((s) => s.trim())) {
      await tx.execute(sql.raw(statement));
    }

    // Permisos DML a pulso_app sobre tablas del flujo
    const targetTables = [
      'companies',
      'branches',
      'recipes',
      'sales_entries',
      'users',
      'evidence',
      'inventory_items',
      'inventory_batches',
      'inventory_movements',
      'inventory_audit_log',
      'sale_recovery_proposals',
      'sale_recovery_decisions',
      'sale_recovery_attestations',
      'sales_consumption_identities',
      'sales_consumption_revisions',
    ];
    for (const table of targetTables) {
      await tx.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO "pulso_app"`));
    }

    await tx.insert(companies).values(f.company.map((id) => ({ id, name: 'Synthetic apply company' })));
    await tx.insert(inventoryItems).values(
      f.item.map((id, i) => ({ id, companyId: f.company[i], name: 'Synthetic ingredient', unit: 'KG' }))
    );
    await tx.insert(branches).values(
      f.branch.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], name: 'Synthetic branch' }))
    );

    // Lotes de inventario iniciales con stock disponible y fecha de caducidad futura
    await tx.insert(inventoryBatches).values(
      f.batch.map((id, i) => ({
        id,
        branchId: f.branch[i],
        itemId: f.item[i],
        initialQuantity: '10.0000',
        currentQuantity: '10.0000',
        unitCost: 100,
        status: 'AVAILABLE' as const,
        expirationDate: new Date('2027-12-31T00:00:00Z'),
        receivedAt: new Date('2026-10-01T00:00:00Z'),
        createdAt: new Date('2026-10-01T00:00:00Z'),
      }))
    );

    const recipe = ids(2);
    await tx.insert(recipes).values(
      recipe.map((id, i) => ({ id, companyId: f.company[i], name: 'Synthetic recipe' }))
    );

    // Venta legada inicial (sin revisiones de consumo)
    await tx.insert(salesEntries).values(
      f.sale.map((id, i) => ({
        id,
        companyId: f.company[i === 2 ? 1 : 0],
        branchId: f.branch[i],
        recipeId: recipe[i === 2 ? 1 : 0],
        quantitySold: '1',
        saleDate: new Date('2026-11-01'),
        totalRevenue: 2500,
      }))
    );

    await tx.insert(users).values(
      f.actor.map((id, i) => ({
        id,
        name: `Admin ${i}`,
        email: `${id}@apply.test`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'ADMIN' as const,
        companyId: f.company[i === 3 ? 1 : 0],
      }))
    );

    await tx.insert(evidence).values(
      f.proof.map((id) => {
        const companyId = f.company[0];
        const branchId = f.branch[0];
        const key = `companies/${companyId}/branches/${branchId}/sales-recovery/${f.sale[0]}/${id}`;
        return {
          id,
          companyId,
          branchId,
          entityType: 'SALE_RECOVERY' as const,
          entityId: f.sale[0],
          url: key,
          storageKey: key,
          kind: 'FILE' as const,
          createdAt: new Date('2026-11-01'),
          createdBy: f.actor[0],
        };
      })
    );
    await tx.update(evidence).set({ updatedAt: sql`'2026-11-01 00:00:00.123456'::timestamp` }).where(inArray(evidence.id, f.proof));

    // Cambiar a rol de runtime no privilegiado
    await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
    fakes.auth.mockResolvedValue({ user: { id: f.actor[0], role: 'ADMIN', companyId: f.company[0] } });
    fakes.context.mockImplementation((scope: { companyId: string; branchId?: string; actorId?: string }, work: (tx: Tx) => Promise<unknown>) =>
      tx.transaction(async (nested) => {
        await setTenantContext(nested, scope);
        return work(nested as Tx);
      })
    );
    const spy = vi.spyOn(db, 'transaction').mockImplementation((work: (tx: Tx) => Promise<unknown>) => tx.transaction(work as (tx: Tx) => Promise<unknown>));

    try {
      await work(tx, f);
    } finally {
      spy.mockRestore();
    }

    throw new Error('server apply rollback esperado');
  }, { isolationLevel: 'serializable' }).catch((error) => {
    if (!(error instanceof Error) || error.message !== 'server apply rollback esperado') throw error;
  });

  // Limpieza y verificación de rollback absoluto
  for (const id of f.company) {
    expect((await db.execute(sql`SELECT id FROM companies WHERE id=${id}`)).rows).toEqual([]);
  }
}

async function prepareProposalAndDecision(tx: Tx, f: Fixture, decisionType: 'APPROVED' | 'REJECTED' = 'APPROVED', deciderIndex = 1) {
  await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0], actorId: f.actor[0] });
  const [sale] = await tx.select().from(salesEntries).where(eq(salesEntries.id, f.sale[0]));

  const subject = {
    companyId: f.company[0],
    branchId: f.branch[0],
    legacySaleId: f.sale[0],
    recipeId: sale.recipeId,
    sourceReference: 'Corte fiscal 001',
  };

  const core = {
    schemaVersion: 1,
    ...subject,
    source: 'pos:main',
    productKey: 'SKU-01',
    saleDay: '2026-11-01',
    quantitySold: '1',
    totalRevenueCents: 2500,
  };

  const recipe = {
    schemaVersion: 1,
    kind: 'SALE_RECOVERY_RECIPE',
    ...subject,
    saleDay: '2026-11-01',
    validFrom: '2026-10-01',
    validThrough: '2026-11-30',
    recipes: [{
      id: sale.recipeId,
      companyId: f.company[0],
      baseYield: '1',
      unit: 'PORTION',
      items: [{ id: randomUUID(), itemId: f.item[0], quantity: '1', unit: 'KG', isSubRecipe: false, yieldPercent: 100 }],
    }],
    ingredients: [{ id: f.item[0], companyId: f.company[0], unit: 'KG' }],
    conversions: [],
  };

  const docs = [
    { ...core, kind: 'SALE_RECOVERY_SALE' },
    recipe,
    {
      ...core,
      kind: 'SALE_RECOVERY_NO_PRIOR_CONSUMPTION',
      consumptionState: 'NOT_APPLIED',
      basis: { system: 'POS', recordReference: 'Registro íntegro firmado 001', explanation: 'Consumo no aplicado según auditoría' },
    },
  ];

  const purposes = ['SALE', 'RECIPE_VERSION', 'NO_PRIOR_CONSUMPTION'] as const;
  const facts: string[] = [];
  const objects = new Map<string, Buffer>();
  fakes.read.mockImplementation(async (key: string) => objects.get(key) ?? null);

  for (let i = 0; i < 3; i++) {
    const proof = f.proof[i];
    const key = `companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${proof}`;
    const bytes = Buffer.from(JSON.stringify(docs[i]));
    objects.set(key, bytes);
    const fact = await recordRecoveryAttestation({
      ...attestationBody(f),
      evidenceId: proof,
      purpose: purposes[i],
      expectedContentSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    facts.push(fact.id);
  }

  const proposalInput = {
    branchId: f.branch[0],
    legacySaleId: f.sale[0],
    idempotencyKey: randomUUID(),
    reason: 'Expediente preparado para aplicación histórica auditada',
    saleAttestationId: facts[0],
    recipeAttestationId: facts[1],
    absenceAttestationId: facts[2],
  };

  fakes.auth.mockResolvedValue({ user: { id: f.actor[0], role: 'ADMIN', companyId: f.company[0] } });
  const registered = await registerRecoveryProposal(proposalInput);

  // Registro de decisión por actor decider
  fakes.auth.mockResolvedValue({ user: { id: f.actor[deciderIndex], role: 'ADMIN', companyId: f.company[0] } });
  const decisionResult = await recordRecoveryDecision({
    branchId: f.branch[0],
    proposalId: registered.id,
    decision: decisionType,
  });

  return { registered, decisionResult };
}

describe('INV-01.c.recovery.apply — Aplicación auditada runtime en Neon Postgres aislado (pulso_app NOBYPASSRLS)', () => {
  beforeAll(async () => {
    const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, '');
    expect(host(process.env.TEST_DATABASE_URL!)).toBe('ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech');
    if (existsSync('.env')) {
      const url = parse(readFileSync('.env')).DATABASE_URL;
      if (url) expect(host(url)).not.toBe(host(process.env.TEST_DATABASE_URL!));
    }
    expect(
      (await db.execute(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`)).rows[0]
    ).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('aplica exitosamente propuesta aprobada: genera revisión 1, movimientos USAGE (salecons), descuenta lote y registra bitácora AUD-02', async () => {
    await probe(async (tx, f) => {
      const { registered, decisionResult } = await prepareProposalAndDecision(tx, f, 'APPROVED', 1);

      // Actor aplicador: actor[2]
      fakes.auth.mockResolvedValue({
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
      });

      const applyResult = await applySaleRecoveryProposal({
        branchId: f.branch[0],
        proposalId: registered.id,
        reason: 'Aplicación autorizada de recuperación histórica por inventario físico comprobado',
        user: {
          id: f.actor[2],
          role: 'ADMIN',
          companyId: f.company[0],
        },
      });

      expect(applyResult.applied).toBe(true);
      expect(applyResult.alreadyApplied).toBeUndefined();
      expect(applyResult.revisionId).toBeDefined();
      expect(applyResult.identityId).toBeDefined();
      expect(applyResult.movementsCount).toBe(1);
      expect(applyResult.auditLogId).toBeDefined();

      // 1. Verificación de revisión en sales_consumption_revisions
      const [revRow] = await tx.select().from(salesConsumptionRevisions).where(
        eq(salesConsumptionRevisions.id, applyResult.revisionId!)
      );
      expect(revRow).toBeDefined();
      expect(revRow.revision).toBe(1);
      expect(revRow.previousRevision).toBeNull();
      expect(revRow.previousQuantitySold).toBe('0.00');
      expect(revRow.quantitySold).toBe('1.00');
      expect(revRow.totalRevenue).toBe(2500);
      expect(revRow.recordedBy).toBe(f.actor[2]);
      expect(revRow.allocations.length).toBe(1);

      // 2. Verificación de movimientos en inventory_movements
      const movements = await tx.select().from(inventoryMovements).where(
        eq(inventoryMovements.referenceId, `salecons:${applyResult.identityId}`)
      );
      expect(movements.length).toBe(1);
      const move = movements[0];
      expect(move.type).toBe('USAGE');
      expect(Number(move.quantityChange)).toBe(-1.0000);
      expect(move.batchId).toBe(f.batch[0]);
      expect(move.itemId).toBe(f.item[0]);
      expect(move.reason).toBe('Venta revisión 1');

      // 3. Verificación de descuento de stock en inventory_batches
      const [batchRow] = await tx.select().from(inventoryBatches).where(
        eq(inventoryBatches.id, f.batch[0])
      );
      expect(Number(batchRow.currentQuantity)).toBe(9.0000);

      // 4. Verificación de bitácora AUD-02 en inventory_audit_log
      const [auditRow] = await tx.select().from(inventoryAuditLog).where(
        eq(inventoryAuditLog.id, applyResult.auditLogId!)
      );
      expect(auditRow).toBeDefined();
      expect(auditRow.entityType).toBe('ADJUSTMENT');
      expect(auditRow.action).toBe('CREATE');
      expect(auditRow.entityId).toBe(applyResult.revisionId);
      expect(auditRow.performedBy).toBe(f.actor[2]);
      expect(auditRow.reason).toBe('Aplicación autorizada de recuperación histórica por inventario físico comprobado');
      const meta = auditRow.metadata as Record<string, unknown>;
      expect(meta.subtype).toBe('SALE_RECOVERY_APPLY');
      expect(meta.proposalId).toBe(registered.id);
      expect(meta.decisionId).toBe(decisionResult.id);
      expect(meta.identityId).toBe(applyResult.identityId);
      expect(meta.movementsCount).toBe(1);
    });
  });

  it('reintento idempotente devuelve alreadyApplied: true sin duplicar revisión ni movimientos ni descontar stock adicional', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposalAndDecision(tx, f, 'APPROVED', 1);

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
      });

      const firstApply = await applySaleRecoveryProposal({
        branchId: f.branch[0],
        proposalId: registered.id,
        reason: 'Primera aplicación válida de recuperación',
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
      });
      expect(firstApply.applied).toBe(true);

      // Reintento idéntico o por otro actor administrativo
      const secondApply = await applySaleRecoveryProposal({
        branchId: f.branch[0],
        proposalId: registered.id,
        reason: 'Reintento de aplicación de la misma propuesta',
        user: { id: f.actor[1], role: 'ADMIN', companyId: f.company[0] },
      });

      expect(secondApply.applied).toBe(false);
      expect(secondApply.alreadyApplied).toBe(true);
      expect(secondApply.revisionId).toBe(firstApply.revisionId);
      expect(secondApply.identityId).toBe(firstApply.identityId);

      // Verificar que el saldo no se descontó dos veces
      const [batchRow] = await tx.select().from(inventoryBatches).where(
        eq(inventoryBatches.id, f.batch[0])
      );
      expect(Number(batchRow.currentQuantity)).toBe(9.0000);

      // Verificar que los movimientos siguen siendo exactamente 1
      const movements = await tx.select().from(inventoryMovements).where(
        eq(inventoryMovements.referenceId, `salecons:${firstApply.identityId}`)
      );
      expect(movements.length).toBe(1);
    });
  });

  it('reversión atómica y rollback ante stock insuficiente', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposalAndDecision(tx, f, 'APPROVED', 1);

      // Vaciar stock del lote antes de la aplicación
      await tx.update(inventoryBatches)
        .set({ currentQuantity: '0.0000' })
        .where(eq(inventoryBatches.id, f.batch[0]));

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
      });

      await expect(
        applySaleRecoveryProposal({
          branchId: f.branch[0],
          proposalId: registered.id,
          reason: 'Aplicación que debe fallar por stock agotado',
          user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'Stock insuficiente para aplicar recuperación histórica',
      });

      // Verificar que NO se crearon revisiones ni movimientos ni bitácoras
      const revs = await tx.select().from(salesConsumptionRevisions).where(
        eq(salesConsumptionRevisions.companyId, f.company[0])
      );
      expect(revs.length).toBe(0);

      const moves = await tx.select().from(inventoryMovements).where(
        eq(inventoryMovements.branchId, f.branch[0])
      );
      expect(moves.length).toBe(0);
    });
  });

  it('rechaza con 409 si la decisión administrativa fue REJECTED', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposalAndDecision(tx, f, 'REJECTED', 1);

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
      });

      await expect(
        applySaleRecoveryProposal({
          branchId: f.branch[0],
          proposalId: registered.id,
          reason: 'Intento de aplicar propuesta rechazada',
          user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'La propuesta no ha sido aprobada',
      });
    });
  });

  it('rechaza con 400 si el motivo de auditoría tiene menos de 4 caracteres (regla AUD-02)', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposalAndDecision(tx, f, 'APPROVED', 1);

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
      });

      await expect(
        applySaleRecoveryProposal({
          branchId: f.branch[0],
          proposalId: registered.id,
          reason: 'abc', // < 4 caracteres
          user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'El motivo de auditoría debe tener al menos 4 caracteres',
      });
    });
  });

  it('rechaza con 409 si la venta legada fue alterada posteriormente (frescura documental)', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposalAndDecision(tx, f, 'APPROVED', 1);

      // Alterar la venta legada en sales_entries
      await tx.update(salesEntries)
        .set({ quantitySold: '2.00', updatedAt: new Date() })
        .where(eq(salesEntries.id, f.sale[0]));

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
      });

      await expect(
        applySaleRecoveryProposal({
          branchId: f.branch[0],
          proposalId: registered.id,
          reason: 'Intento de aplicar venta legada alterada',
          user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0] },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'La venta legada fue modificada con posterioridad a la propuesta',
      });
    });
  });
});
