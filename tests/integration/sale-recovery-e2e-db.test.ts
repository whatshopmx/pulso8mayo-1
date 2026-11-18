import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  companies,
  branches,
  recipes,
  recipeItems,
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
  ...(await original<typeof import('@/lib/db/tenant-context')>()),
  withCompanyContext: fakes.context,
}));

import { setTenantContext } from '@/lib/db/tenant-context';
import { recordRecoveryAttestation } from '@/lib/services/sale-recovery-attestations';
import { registerRecoveryProposal } from '@/lib/services/sale-recovery-proposals';
import {
  getRecoveryProposalForReview,
  recordRecoveryDecision,
} from '@/lib/services/sale-recovery-decision';
import { applySaleRecoveryProposal } from '@/lib/services/sale-recovery-apply';
import {
  applySaleConsumptionInTransaction,
  SaleConsumptionError,
} from '@/lib/services/sale-consumption-service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = {
  company: string[];
  branch: string[];
  sale: string[];
  proof: string[];
  actor: string[]; // actor[0]: requester, actor[1]: decider, actor[2]: applier
  item: string[];
  recipe: string[];
  batch: string[];
};

async function probe(work: (tx: Tx, f: Fixture) => Promise<void>) {
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
  const f: Fixture = {
    company: ids(2),
    branch: ids(2),
    sale: ids(2),
    proof: ids(3),
    actor: ids(3),
    item: ids(2),
    recipe: ids(2),
    batch: ids(2),
  };

  fakes.auth.mockReset();
  fakes.context.mockReset();
  fakes.read.mockReset();
  fakes.sign.mockReset();
  fakes.configured.mockReturnValue(true);
  fakes.read.mockResolvedValue(Buffer.from('hello'));
  fakes.sign.mockResolvedValue('https://private.test/signed');

  await db
    .transaction(
      async (tx) => {
        // Migraciones idempotentes de esquema necesarias
        for (const sqlFile of [
          'drizzle/0141_inv01b_import_recipe_name.sql',
          'drizzle/0143_inv01c_recovery_review.sql',
          'drizzle/0145_inv01c_recovery_attestations.sql',
        ]) {
          for (const statement of readFileSync(sqlFile, 'utf8')
            .split('--> statement-breakpoint')
            .filter((s) => s.trim())) {
            await tx.execute(sql.raw(statement));
          }
        }

        // Otorgar permisos DML a pulso_app sobre tablas del flujo
        const targetTables = [
          'companies',
          'branches',
          'recipes',
          'recipe_items',
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
          await tx.execute(
            sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO "pulso_app"`)
          );
        }

        await tx.insert(companies).values(
          f.company.map((id) => ({ id, name: 'Synthetic E2E Recovery Company' }))
        );
        await tx.insert(branches).values(
          f.branch.map((id, i) => ({
            id,
            companyId: f.company[i === 1 ? 1 : 0],
            name: `Branch ${i}`,
          }))
        );
        await tx.insert(inventoryItems).values(
          f.item.map((id, i) => ({
            id,
            companyId: f.company[i === 1 ? 1 : 0],
            name: `Item ${i}`,
            unit: 'KG',
          }))
        );
        await tx.insert(recipes).values(
          f.recipe.map((id, i) => ({
            id,
            companyId: f.company[i === 1 ? 1 : 0],
            name: `Recipe ${i}`,
            baseYield: '1',
            unit: 'PORTION',
          }))
        );
        await tx.insert(recipeItems).values(
          f.recipe.map((recipeId, i) => ({
            recipeId,
            itemId: f.item[i],
            quantity: '1',
            unit: 'KG',
            yieldPercent: 100,
          }))
        );

        // Lote de inventario con stock inicial disponible = 10.0000
        await tx.insert(inventoryBatches).values(
          f.batch.map((id, i) => ({
            id,
            branchId: f.branch[i],
            itemId: f.item[i],
            initialQuantity: '10.0000',
            currentQuantity: '10.0000',
            unitCost: 100,
            status: 'AVAILABLE' as const,
            expirationDate: new Date('2029-12-31T00:00:00Z'),
            receivedAt: new Date('2026-10-01T00:00:00Z'),
            createdAt: new Date('2026-10-01T00:00:00Z'),
          }))
        );

        // Venta legada inicial (sin revisión ni identidad de consumo)
        await tx.insert(salesEntries).values(
          f.sale.map((id, i) => ({
            id,
            companyId: f.company[i === 1 ? 1 : 0],
            branchId: f.branch[i],
            recipeId: f.recipe[i === 1 ? 1 : 0],
            quantitySold: '1',
            saleDate: new Date('2026-11-01'),
            totalRevenue: 2500,
          }))
        );

        // Usuarios administrativos: actor[0] = requester, actor[1] = decider, actor[2] = applier
        await tx.insert(users).values(
          f.actor.map((id, i) => ({
            id,
            name: `Admin ${i}`,
            email: `${id}@recovery-e2e.test`,
            emailVerified: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            role: 'ADMIN' as const,
            companyId: f.company[0],
          }))
        );

        // Adjuntos de evidencia para el expediente
        await tx.insert(evidence).values(
          f.proof.map((id) => {
            const key = `companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${id}`;
            return {
              id,
              companyId: f.company[0],
              branchId: f.branch[0],
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
        await tx
          .update(evidence)
          .set({ updatedAt: sql`'2026-11-01 00:00:00.123456'::timestamp` })
          .where(inArray(evidence.id, f.proof));

        // Cambiar a rol runtime no privilegiado
        await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));

        fakes.auth.mockResolvedValue({
          user: { id: f.actor[0], role: 'ADMIN', companyId: f.company[0] },
        });
        fakes.context.mockImplementation(
          (scope: { companyId: string; branchId?: string; actorId?: string }, workNested: (txNested: Tx) => Promise<unknown>) =>
            tx.transaction(async (nested) => {
              await setTenantContext(nested, scope);
              return workNested(nested as Tx);
            })
        );

        const spy = vi
          .spyOn(db, 'transaction')
          .mockImplementation((workNested: (txNested: Tx) => Promise<unknown>) =>
            tx.transaction(workNested as (txNested: Tx) => Promise<unknown>)
          );

        try {
          await work(tx, f);
        } finally {
          spy.mockRestore();
        }

        throw new Error('server e2e rollback esperado');
      },
      { isolationLevel: 'serializable' }
    )
    .catch((error) => {
      if (!(error instanceof Error) || error.message !== 'server e2e rollback esperado') {
        throw error;
      }
    });

  // Limpieza y verificación de rollback absoluto
  for (const id of f.company) {
    expect((await db.execute(sql`SELECT id FROM companies WHERE id=${id}`)).rows).toEqual([]);
  }
}

async function setupAttestations(tx: Tx, f: Fixture) {
  await setTenantContext(tx, {
    companyId: f.company[0],
    branchId: f.branch[0],
    actorId: f.actor[0],
  });
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
    recipes: [
      {
        id: sale.recipeId,
        companyId: f.company[0],
        baseYield: '1',
        unit: 'PORTION',
        items: [
          {
            id: randomUUID(),
            itemId: f.item[0],
            quantity: '1',
            unit: 'KG',
            isSubRecipe: false,
            yieldPercent: 100,
          },
        ],
      },
    ],
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
      basis: {
        system: 'POS',
        recordReference: 'Registro íntegro firmado 001',
        explanation: 'Consumo no aplicado según auditoría física',
      },
    },
  ];

  const purposes = ['SALE', 'RECIPE_VERSION', 'NO_PRIOR_CONSUMPTION'] as const;
  const attestations: string[] = [];
  const objects = new Map<string, Buffer>();
  fakes.read.mockImplementation(async (key: string) => objects.get(key) ?? null);

  for (let i = 0; i < 3; i++) {
    const proof = f.proof[i];
    const key = `companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${proof}`;
    const bytes = Buffer.from(JSON.stringify(docs[i]));
    objects.set(key, bytes);
    const fact = await recordRecoveryAttestation({
      branchId: f.branch[0],
      legacySaleId: f.sale[0],
      evidenceId: proof,
      idempotencyKey: randomUUID(),
      purpose: purposes[i],
      sourceReference: 'Corte fiscal 001',
      reason: 'Auditoría física y documental',
      expectedContentSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    attestations.push(fact.id);
  }

  return attestations;
}

describe('INV-01.c.recovery.e2e — Ciclo E2E completo en Neon Postgres aislado (pulso_app NOBYPASSRLS)', () => {
  beforeAll(async () => {
    const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, '');
    expect(host(process.env.TEST_DATABASE_URL!)).toBe(
      'ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech'
    );
    if (existsSync('.env')) {
      const url = parse(readFileSync('.env')).DATABASE_URL;
      if (url) expect(host(url)).not.toBe(host(process.env.TEST_DATABASE_URL!));
    }
    expect(
      (
        await db.execute(
          sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`
        )
      ).rows[0]
    ).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('Ciclo E2E completo: detección PENDING_RECOVERY -> propuesta -> revisión y segregación de funciones -> decisión aprobada -> aplicación auditada AUD-02 -> desbloqueo de venta ordinaria', async () => {
    await probe(async (tx, f) => {
      await setTenantContext(tx, {
        companyId: f.company[0],
        branchId: f.branch[0],
        actorId: f.actor[0],
      });

      const ordinaryInput = {
        companyId: f.company[0],
        branchId: f.branch[0],
        source: 'pos:main',
        productKey: 'SKU-01',
        saleDay: '2026-11-01',
        recipeId: f.recipe[0],
        quantitySold: '1',
        totalRevenueCents: 2500,
        userId: f.actor[0],
      };

      // 1. Estado inicial bloqueado: la venta legada en sales_entries sin revisión de consumo
      // provoca que cualquier venta ordinaria para esa receta/día sea bloqueada con PENDING_RECOVERY.
      let blockedError: unknown;
      try {
        await applySaleConsumptionInTransaction(tx, ordinaryInput);
      } catch (err) {
        blockedError = err;
      }
      expect(blockedError).toBeInstanceOf(SaleConsumptionError);
      expect((blockedError as SaleConsumptionError).code).toBe('PENDING_RECOVERY');
      expect((blockedError as SaleConsumptionError).message).toContain(
        'Venta y consumo previo no concuerdan'
      );

      // El inventario permanece intacto en 10.0000
      const [batchBefore] = await tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.id, f.batch[0]));
      expect(batchBefore.currentQuantity).toBe('10.0000');

      // 2. Preparación documental y atestaciones
      const attestations = await setupAttestations(tx, f);

      // 3. Registro de propuesta por actor solicitante (actor[0])
      fakes.auth.mockResolvedValue({
        user: { id: f.actor[0], role: 'ADMIN', companyId: f.company[0] },
      });
      const proposalResult = await registerRecoveryProposal({
        branchId: f.branch[0],
        legacySaleId: f.sale[0],
        idempotencyKey: randomUUID(),
        reason: 'Expediente preparado para recuperación histórica auditada',
        saleAttestationId: attestations[0],
        recipeAttestationId: attestations[1],
        absenceAttestationId: attestations[2],
      });
      expect(proposalResult.created).toBe(true);
      expect(proposalResult.id).toBeDefined();

      // 4. Segregación de funciones: actor[0] no puede aprobar su propio expediente
      const reviewForRequester = await getRecoveryProposalForReview({
        branchId: f.branch[0],
        proposalId: proposalResult.id,
      });
      expect(reviewForRequester.canDecide).toBe(false);

      let selfApprovalError: unknown;
      try {
        await recordRecoveryDecision({
          branchId: f.branch[0],
          proposalId: proposalResult.id,
          decision: 'APPROVED',
        });
      } catch (err) {
        selfApprovalError = err;
      }
      expect(selfApprovalError).toBeDefined();

      // Decisión emitida por un segundo administrador independiente (actor[1])
      fakes.auth.mockResolvedValue({
        user: { id: f.actor[1], role: 'ADMIN', companyId: f.company[0] },
      });
      const reviewForIndependent = await getRecoveryProposalForReview({
        branchId: f.branch[0],
        proposalId: proposalResult.id,
      });
      expect(reviewForIndependent.canDecide).toBe(true);

      const decisionResult = await recordRecoveryDecision({
        branchId: f.branch[0],
        proposalId: proposalResult.id,
        decision: 'APPROVED',
      });
      expect(decisionResult.decision).toBe('APPROVED');

      // 5. Aplicación auditada AUD-02 por actor[2]
      const applyResult = await applySaleRecoveryProposal({
        branchId: f.branch[0],
        proposalId: proposalResult.id,
        reason: 'Regularización según conciliación física y documental AUD-02',
        user: {
          id: f.actor[2],
          role: 'ADMIN',
          companyId: f.company[0],
          branchId: f.branch[0],
        },
      });
      expect(applyResult.applied).toBe(true);
      expect(applyResult.alreadyApplied).toBeUndefined();
      expect(applyResult.revisionId).toBeDefined();
      expect(applyResult.movementsCount).toBe(1);
      expect(applyResult.auditLogId).toBeDefined();

      // Verificación de descuento de stock en lotes (10 -> 9)
      const [batchAfterRecovery] = await tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.id, f.batch[0]));
      expect(batchAfterRecovery.currentQuantity).toBe('9.0000');

      // Verificación de movimiento físico USAGE con prefijo salecons:
      const movements = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.branchId, f.branch[0]));
      expect(movements.length).toBe(1);
      expect(movements[0].type).toBe('USAGE');
      expect(movements[0].quantityChange).toBe('-1.0000');
      expect(movements[0].referenceId).toMatch(/^salecons:/);

      // Verificación de bitácora AUD-02 en inventory_audit_log
      const [auditRow] = await tx
        .select()
        .from(inventoryAuditLog)
        .where(eq(inventoryAuditLog.id, applyResult.auditLogId!));
      expect(auditRow).toBeDefined();
      expect(auditRow.performedBy).toBe(f.actor[2]);
      expect((auditRow.metadata as Record<string, unknown>).subtype).toBe('SALE_RECOVERY_APPLY');

      // 6. Verificación de Desbloqueo: la venta ordinaria sobre la misma sucursal/día/receta
      // ahora reconoce la Revisión 1 y ya NO es bloqueada con PENDING_RECOVERY.
      // Se procesa un incremento (venta de 2 unidades en total: 1 legada + 1 nueva).
      const ordinaryAfterRecovery = await applySaleConsumptionInTransaction(tx, {
        ...ordinaryInput,
        quantitySold: '2',
        totalRevenueCents: 5000,
        userId: f.actor[0],
      });
      expect(ordinaryAfterRecovery.revision).toBe(2);
      expect(ordinaryAfterRecovery.applied).toBe(true);

      const [rev2] = await tx
        .select()
        .from(salesConsumptionRevisions)
        .where(
          and(
            eq(salesConsumptionRevisions.identityId, ordinaryAfterRecovery.identityId),
            eq(salesConsumptionRevisions.revision, 2)
          )
        );
      expect(rev2.quantitySold).toBe('2.00');

      // El stock se descuenta una unidad adicional (9 -> 8)
      const [batchFinal] = await tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.id, f.batch[0]));
      expect(batchFinal.currentQuantity).toBe('8.0000');
    });
  });

  it('Idempotencia secuencial: el reintento detecta alreadyApplied sin doble descuento dentro de la transacción de prueba', async () => {
    await probe(async (tx, f) => {
      const attestations = await setupAttestations(tx, f);

      // Registro de propuesta
      fakes.auth.mockResolvedValue({
        user: { id: f.actor[0], role: 'ADMIN', companyId: f.company[0] },
      });
      const proposal = await registerRecoveryProposal({
        branchId: f.branch[0],
        legacySaleId: f.sale[0],
        idempotencyKey: randomUUID(),
        reason: 'Expediente para prueba de concurrencia',
        saleAttestationId: attestations[0],
        recipeAttestationId: attestations[1],
        absenceAttestationId: attestations[2],
      });

      // Decisión aprobada por actor[1]
      fakes.auth.mockResolvedValue({
        user: { id: f.actor[1], role: 'ADMIN', companyId: f.company[0] },
      });
      await recordRecoveryDecision({
        branchId: f.branch[0],
        proposalId: proposal.id,
        decision: 'APPROVED',
      });

      // Reintento secuencial en la misma conexión. No acredita carreras entre commits.
      const first = await applySaleRecoveryProposal({
        branchId: f.branch[0],
        proposalId: proposal.id,
        reason: 'Primera aplicación válida AUD-02',
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0], branchId: f.branch[0] },
      });
      expect(first.applied).toBe(true);
      expect(first.alreadyApplied).toBeUndefined();

      const second = await applySaleRecoveryProposal({
        branchId: f.branch[0],
        proposalId: proposal.id,
        reason: 'Segunda aplicación por reintento secuencial',
        user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0], branchId: f.branch[0] },
      });
      expect(second.applied).toBe(false);
      expect(second.alreadyApplied).toBe(true);
      expect(second.revisionId).toBe(first.revisionId);
      expect(second.identityId).toBe(first.identityId);

      // Verificación estricta de NO doble descuento de stock (permanece en 9.0000)
      const [batch] = await tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.id, f.batch[0]));
      expect(batch.currentQuantity).toBe('9.0000');

      // Se generó exactamente un conjunto de movimientos
      const movements = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.branchId, f.branch[0]));
      expect(movements.length).toBe(1);
    });
  });

  it('Rechazo administrativo: propuesta REJECTED bloquea la aplicación y no afecta inventario', async () => {
    await probe(async (tx, f) => {
      const attestations = await setupAttestations(tx, f);

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[0], role: 'ADMIN', companyId: f.company[0] },
      });
      const proposal = await registerRecoveryProposal({
        branchId: f.branch[0],
        legacySaleId: f.sale[0],
        idempotencyKey: randomUUID(),
        reason: 'Expediente a rechazar',
        saleAttestationId: attestations[0],
        recipeAttestationId: attestations[1],
        absenceAttestationId: attestations[2],
      });

      // Decisión de RECHAZO
      fakes.auth.mockResolvedValue({
        user: { id: f.actor[1], role: 'ADMIN', companyId: f.company[0] },
      });
      await recordRecoveryDecision({
        branchId: f.branch[0],
        proposalId: proposal.id,
        decision: 'REJECTED',
      });

      // Intento de aplicación debe fallar con 409
      let applyError: unknown;
      try {
        await applySaleRecoveryProposal({
          branchId: f.branch[0],
          proposalId: proposal.id,
          reason: 'Intento indebido de aplicación sobre propuesta rechazada',
          user: { id: f.actor[2], role: 'ADMIN', companyId: f.company[0], branchId: f.branch[0] },
        });
      } catch (err) {
        applyError = err;
      }
      expect(applyError).toBeDefined();

      // El stock permanece intacto en 10.0000
      const [batch] = await tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.id, f.batch[0]));
      expect(batch.currentQuantity).toBe('10.0000');

      // Cero movimientos generados
      const movements = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.branchId, f.branch[0]));
      expect(movements.length).toBe(0);
    });
  });
});
