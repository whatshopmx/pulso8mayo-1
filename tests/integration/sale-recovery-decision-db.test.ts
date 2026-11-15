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
  saleRecoveryProposals,
  saleRecoveryDecisions,
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
import { recordRecoveryDecision, getRecoveryProposalForReview } from '@/lib/services/sale-recovery-decision';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = {
  company: string[];
  branch: string[];
  sale: string[];
  proof: string[];
  actor: string[];
  item: string[];
};

const digest = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

const attestationBody = (f: Fixture) => ({
  branchId: f.branch[0],
  legacySaleId: f.sale[0],
  evidenceId: f.proof[0],
  idempotencyKey: randomUUID(),
  purpose: 'SALE' as const,
  sourceReference: 'Corte original 001',
  reason: 'Inspección documental por administrador',
  expectedContentSha256: digest,
});

async function probe(work: (tx: Tx, f: Fixture) => Promise<void>) {
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
  const f: Fixture = {
    company: ids(2),
    branch: ids(3),
    sale: ids(3),
    proof: ids(3),
    actor: ids(4), // actor[0]: requester, actor[1]: decider, actor[2]: third actor, actor[3]: other
    item: ids(2),
  };

  fakes.auth.mockReset();
  fakes.context.mockReset();
  fakes.read.mockReset();
  fakes.sign.mockReset();
  fakes.configured.mockReturnValue(true);
  fakes.read.mockResolvedValue(Buffer.from('hello'));
  fakes.sign.mockResolvedValue('https://private.test/signed');

  await db.transaction(async (tx) => {
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

    await tx.insert(companies).values(f.company.map((id) => ({ id, name: 'Synthetic decision company' })));
    await tx.insert(inventoryItems).values(
      f.item.map((id, i) => ({ id, companyId: f.company[i], name: 'Synthetic recovery item', unit: 'KG' }))
    );
    await tx.insert(branches).values(
      f.branch.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], name: 'Synthetic branch' }))
    );
    const recipe = ids(2);
    await tx.insert(recipes).values(
      recipe.map((id, i) => ({ id, companyId: f.company[i], name: 'Synthetic recipe' }))
    );
    await tx.insert(salesEntries).values(
      f.sale.map((id, i) => ({
        id,
        companyId: f.company[i === 2 ? 1 : 0],
        branchId: f.branch[i],
        recipeId: recipe[i === 2 ? 1 : 0],
        quantitySold: '1',
        saleDate: new Date('2026-11-01'),
        totalRevenue: 0,
      }))
    );
    await tx.insert(users).values(
      f.actor.map((id, i) => ({
        id,
        name: `Admin ${i}`,
        email: `${id}@decision.test`,
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
    throw new Error('server decision rollback esperado');
  }, { isolationLevel: 'serializable' }).catch((error) => {
    if (!(error instanceof Error) || error.message !== 'server decision rollback esperado') throw error;
  });

  expect((await db.execute(sql`SELECT to_regclass('public.sale_recovery_decisions') AS relation`)).rows[0].relation).toBeNull();
  expect((await db.execute(sql`SELECT to_regclass('public.sale_recovery_proposals') AS relation`)).rows[0].relation).toBeNull();
  for (const id of f.company) {
    expect((await db.execute(sql`SELECT id FROM companies WHERE id=${id}`)).rows).toEqual([]);
  }
}

async function prepareProposal(tx: Tx, f: Fixture) {
  await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0], actorId: f.actor[0] });
  const [sale] = await tx.select().from(salesEntries).where(eq(salesEntries.id, f.sale[0]));
  const subject = {
    companyId: f.company[0],
    branchId: f.branch[0],
    legacySaleId: f.sale[0],
    recipeId: sale.recipeId,
    sourceReference: 'Corte original 001',
  };
  const core = {
    schemaVersion: 1,
    ...subject,
    source: 'pos:main',
    productKey: 'SKU-01',
    saleDay: '2026-11-01',
    quantitySold: '1',
    totalRevenueCents: null,
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
      basis: { system: 'POS', recordReference: 'Registro íntegro firmado 001', explanation: 'Inventario no aplicado según auditoría' },
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
    reason: 'Expediente preparado para revisión administrativa',
    saleAttestationId: facts[0],
    recipeAttestationId: facts[1],
    absenceAttestationId: facts[2],
  };

  const registered = await registerRecoveryProposal(proposalInput);
  return { registered, proposalInput };
}

describe('decisión administrativa independiente runtime en Neon Postgres aislado (pulso_app NOBYPASSRLS)', () => {
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

  it('aprueba legítimamente por revisor independiente, persiste hashes y es idempotente', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposal(tx, f);

      // Revisor independiente: actor[1] distinto a actor[0] (solicitante)
      fakes.auth.mockResolvedValue({
        user: { id: f.actor[1], role: 'ADMIN', companyId: f.company[0] },
      });

      // Consulta de revisión previa
      const review = await getRecoveryProposalForReview({
        branchId: f.branch[0],
        proposalId: registered.id,
      });
      expect(review.canDecide).toBe(true);
      expect(review.decision).toBeNull();
      expect(review.proposal.proposalHash).toBe(registered.proposalHash);

      // Registro de decisión APPROVED
      const decisionResult = await recordRecoveryDecision({
        branchId: f.branch[0],
        proposalId: registered.id,
        decision: 'APPROVED',
      });

      expect(decisionResult).toMatchObject({
        created: true,
        proposalId: registered.id,
        decision: 'APPROVED',
        decidedBy: f.actor[1],
        approverRole: 'ADMIN',
      });

      // Verificación en tabla de base de datos
      const [dbRow] = await tx.select().from(saleRecoveryDecisions).where(
        eq(saleRecoveryDecisions.proposalId, registered.id)
      );
      expect(dbRow).toBeDefined();
      expect(dbRow.decidedBy).toBe(f.actor[1]);
      expect(dbRow.requestedBy).toBe(f.actor[0]);
      expect(dbRow.proposalHash).toBe(registered.proposalHash);
      expect(dbRow.stateHash).toBe(registered.stateHash);

      // Idempotencia: reenvío idéntico del mismo actor retorna created=false
      const repeat = await recordRecoveryDecision({
        branchId: f.branch[0],
        proposalId: registered.id,
        decision: 'APPROVED',
      });
      expect(repeat).toMatchObject({
        id: decisionResult.id,
        created: false,
        decision: 'APPROVED',
        decidedBy: f.actor[1],
      });
    });
  });

  it('exige segregación de funciones tanto en servicio como en constraint DB (decided_by <> requested_by)', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposal(tx, f);

      // Intento de autoaprobación por actor[0] (solicitante) debe ser rechazado con 403
      fakes.auth.mockResolvedValue({
        user: { id: f.actor[0], role: 'ADMIN', companyId: f.company[0] },
      });

      await expect(
        recordRecoveryDecision({
          branchId: f.branch[0],
          proposalId: registered.id,
          decision: 'APPROVED',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        message: 'La decisión administrativa requiere un actor independiente distinto al solicitante',
      });

      // Intento directo en motor SQL con decided_by = requested_by debe violar el check constraint
      await expect(
        tx.transaction(async (nested) => {
          await nested.execute(sql`
            INSERT INTO sale_recovery_decisions (
              proposal_id, company_id, branch_id, proposal_hash, state_hash, requested_by, decision, decided_by, approver_role
            ) VALUES (
              ${registered.id}, ${f.company[0]}, ${f.branch[0]}, ${registered.proposalHash}, ${registered.stateHash},
              ${f.actor[0]}, 'APPROVED', ${f.actor[0]}, 'ADMIN'
            )
          `);
        })
      ).rejects.toThrow();

      // Verificar que no se insertó ninguna decisión
      const decisions = await tx.select().from(saleRecoveryDecisions);
      expect(decisions).toHaveLength(0);
    });
  });

  it('hace valer inmutabilidad y timeline de decisiones mediante triggers de base de datos', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposal(tx, f);

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[1], role: 'ADMIN', companyId: f.company[0] },
      });

      const decisionResult = await recordRecoveryDecision({
        branchId: f.branch[0],
        proposalId: registered.id,
        decision: 'APPROVED',
      });

      // Intento de UPDATE directo en sale_recovery_decisions debe disparar excepción de inmutabilidad (23514)
      await expect(
        tx.transaction(async (nested) => {
          await nested.execute(sql`UPDATE sale_recovery_decisions SET decision = 'REJECTED' WHERE id = ${decisionResult.id}`);
        })
      ).rejects.toThrow();

      // Intento de DELETE directo en sale_recovery_decisions debe disparar excepción de inmutabilidad (23514)
      await expect(
        tx.transaction(async (nested) => {
          await nested.execute(sql`DELETE FROM sale_recovery_decisions WHERE id = ${decisionResult.id}`);
        })
      ).rejects.toThrow();
    });
  });

  it('detecta obsolescencia ante alteración de venta o retiro de evidencia documental', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposal(tx, f);

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[1], role: 'ADMIN', companyId: f.company[0] },
      });

      // Modificar venta legada (avanzar updatedAt en un microsegundo)
      await tx.execute(sql.raw('RESET ROLE'));
      await tx.execute(sql`UPDATE sales_entries SET updated_at = updated_at + interval '0.000001 second' WHERE id = ${f.sale[0]}`);
      await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));

      await expect(
        recordRecoveryDecision({
          branchId: f.branch[0],
          proposalId: registered.id,
          decision: 'APPROVED',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'La venta legada fue modificada con posterioridad a la propuesta',
      });

      // Restaurar updatedAt de la venta y retirar un adjunto (soft-delete)
      await tx.execute(sql.raw('RESET ROLE'));
      const [proposal] = await tx.select().from(saleRecoveryProposals).where(eq(saleRecoveryProposals.id, registered.id));
      const proposalLegacy = (proposal.proposal as { legacy: { updatedAt: string } }).legacy;
      await tx.execute(sql`UPDATE sales_entries SET updated_at = ${proposalLegacy.updatedAt}::timestamptz WHERE id = ${f.sale[0]}`);
      await tx.execute(sql`UPDATE evidence SET deleted_at = clock_timestamp() WHERE id = ${f.proof[0]}`);
      await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));

      await expect(
        recordRecoveryDecision({
          branchId: f.branch[0],
          proposalId: registered.id,
          decision: 'APPROVED',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'La evidencia documental de la propuesta fue retirada',
      });
    });
  });

  it('permite rechazo administrativo legítimo (REJECTED) por revisor independiente', async () => {
    await probe(async (tx, f) => {
      const { registered } = await prepareProposal(tx, f);

      fakes.auth.mockResolvedValue({
        user: { id: f.actor[1], role: 'ADMIN', companyId: f.company[0] },
      });

      const rejectedResult = await recordRecoveryDecision({
        branchId: f.branch[0],
        proposalId: registered.id,
        decision: 'REJECTED',
      });

      expect(rejectedResult).toMatchObject({
        created: true,
        proposalId: registered.id,
        decision: 'REJECTED',
        decidedBy: f.actor[1],
        approverRole: 'ADMIN',
      });

      const [stored] = await tx.select().from(saleRecoveryDecisions).where(
        eq(saleRecoveryDecisions.proposalId, registered.id)
      );
      expect(stored.decision).toBe('REJECTED');
      expect(stored.decidedBy).toBe(f.actor[1]);
      expect(stored.requestedBy).toBe(f.actor[0]);
    });
  });
});
