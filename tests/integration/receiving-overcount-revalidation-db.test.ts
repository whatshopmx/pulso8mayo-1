import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';

/**
 * REC-03A (V2 PostgreSQL nativo): revalidación por lote de la anomalía H01 en
 * una base desechable del endpoint aislado. Los lotes históricos se siembran
 * con la forma exacta que dejaba el código previo a REC-01 (lote nacido con
 * qty + movimiento RECEIVING +qty) y con las variantes que impiden atribuirlo.
 */
type Service = typeof import('@/lib/services/receiving-overcount-service');
type Owner = Awaited<ReturnType<typeof createSalesRuntimeDatabase>>['owner'];

const previous = process.env.DATABASE_URL;
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let service: Service;
let secondPool: Pool | undefined;

const PRE = '2026-09-01T12:00:00Z';
const POST = '2026-11-01T12:00:00Z';
const actor = `rec03a-actor-${randomUUID().slice(0, 8)}`;
const REASON = 'REC-03A copia aislada: doble incremento H01 verificado por lote';

const companyA = randomUUID(), companyB = randomUUID();
const branchA = randomUUID(), branchA2 = randomUUID(), branchB = randomUUID();
const itemA = randomUUID(), itemB = randomUUID();
const ids = Object.fromEntries(['S1', 'S2', 'S3', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'OK1', 'N1', 'B1']
  .map(key => [key, randomUUID()])) as Record<string, string>;

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;

async function report(owner: Owner, branchId: string, companyId: string, itemId: string, lines: number[]) {
  const id = randomUUID();
  await owner.execute(sql`INSERT INTO receiving_reports (id, company_id, branch_id, received_by, received_at)
    VALUES (${id}::uuid, ${companyId}::uuid, ${branchId}::uuid, ${actor}, ${PRE}::timestamp)`);
  for (const quantity of lines) {
    await owner.execute(sql`INSERT INTO receiving_report_items (receiving_report_id, item_id, received_quantity)
      VALUES (${id}::uuid, ${itemId}::uuid, ${quantity})`);
  }
  return id;
}

/** Lote + movimientos tal como quedaron guardados (saldo observado explícito). */
async function batch(owner: Owner, input: {
  id: string; branchId: string; itemId: string; createdAt: string; initial: number; current: number;
  reportRef: string | null; movements: Array<{ type: string; qty: number }>;
}) {
  const info = input.reportRef === null ? null : JSON.stringify({ receivingReportId: input.reportRef });
  await owner.execute(sql`INSERT INTO inventory_batches
      (id, item_id, branch_id, initial_quantity, current_quantity, status, supplier_batch_info, origin, created_at, updated_at)
    VALUES (${input.id}::uuid, ${input.itemId}::uuid, ${input.branchId}::uuid, ${String(input.initial)}::numeric,
      ${String(input.current)}::numeric, 'AVAILABLE', ${info}::jsonb, ${input.reportRef ? 'RECEIVING' : 'PURCHASE'},
      ${input.createdAt}::timestamp, ${input.createdAt}::timestamp)`);
  for (const movement of input.movements) {
    await owner.execute(sql`INSERT INTO inventory_movements
        (branch_id, item_id, batch_id, type, quantity_change, reason, performed_by, timestamp)
      VALUES (${input.branchId}::uuid, ${input.itemId}::uuid, ${input.id}::uuid,
        ${movement.type}::inventory_transaction_type, ${String(movement.qty)}::numeric, 'seed', ${actor},
        ${input.createdAt}::timestamp)`);
  }
}

/** Huella de todo lo que el dry-run no debe tocar. */
async function fingerprint(owner: Owner) {
  const [row] = rows<Record<string, string>>(await owner.execute(sql`SELECT
    (SELECT count(*) FROM inventory_movements)::text AS movements,
    (SELECT count(*) FROM inventory_audit_log)::text AS audits,
    (SELECT md5(string_agg(id::text || ':' || current_quantity::text || ':' || updated_at::text, ',' ORDER BY id))
       FROM inventory_batches) AS batches`));
  return row;
}

async function batchState(owner: Owner, id: string) {
  const [row] = rows<{ current: string; ledger: string; markers: number; audits: number }>(await owner.execute(sql`
    SELECT b.current_quantity::text AS current,
      COALESCE((SELECT SUM(quantity_change) FROM inventory_movements WHERE batch_id = b.id), 0)::text AS ledger,
      (SELECT count(*)::int FROM inventory_movements WHERE batch_id = b.id AND type = 'ADJUSTMENT'
         AND reference_id = 'REC-03:H01:' || b.id::text) AS markers,
      (SELECT count(*)::int FROM inventory_audit_log a WHERE a.entity_type = 'ADJUSTMENT'
         AND a.metadata->>'reference' = 'REC-03:H01:' || b.id::text) AS audits
    FROM inventory_batches b WHERE b.id = ${id}::uuid`));
  return { current: Number(row.current), ledger: Number(row.ledger), markers: row.markers, audits: row.audits };
}

describe('REC-03A (V2 PostgreSQL nativo): dry-run por lote y ajuste preparado en copia aislada', () => {
  beforeAll(async () => {
    fixture = await createSalesRuntimeDatabase({ baseline: '0158' });
    process.env.DATABASE_URL = fixture.ownerUrl;
    service = await import('@/lib/services/receiving-overcount-service');
    neonConfig.webSocketConstructor = ws;
    secondPool = new Pool({ connectionString: fixture.ownerUrl, max: 1, connectionTimeoutMillis: 10_000 });
    secondPool.on('error', () => console.error('[rec03a] second pool error'));

    const owner = fixture.owner;
    await owner.execute(sql`INSERT INTO companies (id, name) VALUES (${companyA}::uuid, 'Empresa REC-03A'), (${companyB}::uuid, 'Empresa B')`);
    await owner.execute(sql`INSERT INTO branches (id, company_id, name, timezone) VALUES
      (${branchA}::uuid, ${companyA}::uuid, 'Centro', 'America/Mexico_City'),
      (${branchA2}::uuid, ${companyA}::uuid, 'Norte', 'America/Mexico_City'),
      (${branchB}::uuid, ${companyB}::uuid, 'Otra', 'America/Mexico_City')`);
    await owner.execute(sql`INSERT INTO inventory_items (id, company_id, name, unit) VALUES
      (${itemA}::uuid, ${companyA}::uuid, 'Pechuga', 'KG'), (${itemB}::uuid, ${companyB}::uuid, 'Queso', 'KG')`);

    const r = (lines: number[], branchId = branchA, companyId = companyA, itemId = itemA) =>
      report(owner, branchId, companyId, itemId, lines);
    // SUFFICIENT: intacto, y consumido después con movimientos.
    await batch(owner, { id: ids.S1, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 10, current: 20,
      reportRef: await r([10]), movements: [{ type: 'RECEIVING', qty: 10 }] });
    await batch(owner, { id: ids.S2, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 8, current: 13,
      reportRef: await r([8]), movements: [{ type: 'RECEIVING', qty: 8 }, { type: 'USAGE', qty: -3 }] });
    await batch(owner, { id: ids.S3, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 4, current: 8,
      reportRef: await r([4]), movements: [{ type: 'RECEIVING', qty: 4 }] });
    // AMBIGUOUS: cada variante impide atribuir el delta a H01.
    await batch(owner, { id: ids.A1, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 50, current: 98.49,
      reportRef: await r([50]), movements: [{ type: 'RECEIVING', qty: 50 }] });
    await batch(owner, { id: ids.A2, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 10, current: 5,
      reportRef: await r([10]), movements: [{ type: 'RECEIVING', qty: 10 }, { type: 'USAGE', qty: -15 }] });
    await batch(owner, { id: ids.A3, branchId: branchA, itemId: itemA, createdAt: POST, initial: 6, current: 12,
      reportRef: await r([6]), movements: [{ type: 'RECEIVING', qty: 6 }] });
    await batch(owner, { id: ids.A4, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 7, current: 14,
      reportRef: 'legacy-sin-uuid', movements: [{ type: 'RECEIVING', qty: 7 }] });
    await batch(owner, { id: ids.A5, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 5, current: 15,
      reportRef: await r([5, 5]), movements: [{ type: 'RECEIVING', qty: 5 }, { type: 'RECEIVING', qty: 5 }] });
    await batch(owner, { id: ids.A6, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 9, current: 18,
      reportRef: await r([9], branchA2), movements: [{ type: 'RECEIVING', qty: 9 }] });
    // Fuera de candidatos: recepción post-REC-01 que cuadra; lote sin recepción con diferencia.
    await batch(owner, { id: ids.OK1, branchId: branchA, itemId: itemA, createdAt: POST, initial: 7, current: 7,
      reportRef: await r([7]), movements: [{ type: 'RECEIVING', qty: 7 }] });
    await batch(owner, { id: ids.N1, branchId: branchA, itemId: itemA, createdAt: PRE, initial: 9, current: 9,
      reportRef: null, movements: [] });
    // Otra empresa, SUFFICIENT: sólo visible sin filtro de empresa.
    await batch(owner, { id: ids.B1, branchId: branchB, itemId: itemB, createdAt: PRE, initial: 3, current: 6,
      reportRef: await r([3], branchB, companyB, itemB), movements: [{ type: 'RECEIVING', qty: 3 }] });
  }, 240_000);

  afterAll(async () => {
    try {
      await secondPool?.end();
      await fixture?.close();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  }, 90_000);

  it('dry-run READ ONLY clasifica cada lote por su evidencia, cuenta lo encontrado y no escribe', async () => {
    const owner = fixture!.owner;
    const before = await fingerprint(owner);
    const scoped = await owner.transaction(tx => service.readReceivingOvercountRevalidation(tx, { companyId: companyA }),
      { accessMode: 'read only' });
    const byId = Object.fromEntries(scoped.batches.map(row => [row.batchId, row]));

    expect(Object.keys(byId).sort()).toEqual([ids.S1, ids.S2, ids.S3, ids.A1, ids.A2, ids.A3, ids.A4, ids.A5, ids.A6].sort());
    expect(byId[ids.S1]).toMatchObject({ evidence: 'SUFFICIENT', delta: 10, proposedAdjustment: -10, correctedBalance: 10 });
    expect(byId[ids.S2]).toMatchObject({ evidence: 'SUFFICIENT', delta: 8, proposedAdjustment: -8, correctedBalance: 5,
      laterMovementCount: 1 });
    expect(byId[ids.S3]).toMatchObject({ evidence: 'SUFFICIENT', delta: 4 });
    expect(byId[ids.A1].reasons).toEqual(['DELTA_NOT_RECEIVED_QUANTITY']);
    expect(byId[ids.A2].reasons).toEqual(['CORRECTED_BALANCE_NEGATIVE']);
    expect(byId[ids.A3].reasons).toEqual(['CREATED_AFTER_FIX']);
    expect(byId[ids.A4].reasons).toEqual(['REPORT_MISSING']);
    expect(byId[ids.A5].reasons).toEqual(expect.arrayContaining(['MULTIPLE_RECEIVING_MOVEMENTS']));
    expect(byId[ids.A6].reasons).toEqual(['REPORT_SCOPE_MISMATCH']);
    for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      expect(byId[ids[key]]).toMatchObject({ evidence: 'AMBIGUOUS', proposedAdjustment: null, correctedBalance: null,
        action: 'RETAIN_FOR_PHYSICAL_COUNT' });
    }
    expect(scoped.summary).toMatchObject({ candidates: 9, sufficient: 3, ambiguous: 6, alreadyCorrected: 0,
      nonReceivingMismatches: 1 });

    const all = await owner.transaction(tx => service.readReceivingOvercountRevalidation(tx), { accessMode: 'read only' });
    expect(all.batches.map(row => row.batchId)).toContain(ids.B1);
    expect(all.summary.candidates).toBe(10);

    // La transacción del dry-run es de sólo lectura: una escritura dentro de ella falla.
    await expect(owner.transaction(async tx => {
      await service.readReceivingOvercountRevalidation(tx, { companyId: companyA });
      await tx.execute(sql`UPDATE inventory_batches SET current_quantity = 0 WHERE id = ${ids.S1}::uuid`);
    }, { accessMode: 'read only' })).rejects.toThrow();
    expect(await fingerprint(owner)).toEqual(before);
    mkdirSync('.tmp', { recursive: true });
    writeFileSync('.tmp/rec03a-dry-run-fixture.json', `${JSON.stringify(scoped, null, 2)}\n`);
  });

  it('ajusta solo SUFFICIENT: antes/después igual al ledger, un ADJUSTMENT marcado y auditoría en la misma transacción', async () => {
    const owner = fixture!.owner;
    const ambiguousBefore = await Promise.all(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map(key => batchState(owner, ids[key])));
    expect(await batchState(owner, ids.S1)).toEqual({ current: 20, ledger: 10, markers: 0, audits: 0 });
    expect(await batchState(owner, ids.S2)).toEqual({ current: 13, ledger: 5, markers: 0, audits: 0 });

    const s1 = await owner.transaction(tx => service.applyReceivingOvercountAdjustment(tx,
      { batchId: ids.S1, expectedDelta: 10, actorId: actor, reason: REASON }));
    const s2 = await owner.transaction(tx => service.applyReceivingOvercountAdjustment(tx,
      { batchId: ids.S2, expectedDelta: 8, actorId: actor, reason: REASON }));
    expect(s1).toMatchObject({ status: 'APPLIED', adjustment: -10, before: 20, after: 10 });
    expect(s2).toMatchObject({ status: 'APPLIED', adjustment: -8, before: 13, after: 5 });
    expect(await batchState(owner, ids.S1)).toEqual({ current: 10, ledger: 10, markers: 1, audits: 1 });
    expect(await batchState(owner, ids.S2)).toEqual({ current: 5, ledger: 5, markers: 1, audits: 1 });

    // Movimientos originales intactos (no se reescribe el ledger).
    const original = rows<{ n: number }>(await owner.execute(sql`SELECT count(*)::int AS n FROM inventory_movements
      WHERE batch_id = ${ids.S2}::uuid AND reason = 'seed'`));
    expect(original[0].n).toBe(2);
    const [audit] = rows<{ performed_by: string; reason: string; protocol: string; new_value: { currentQuantity: number } }>(
      await owner.execute(sql`SELECT performed_by, reason, metadata->>'protocol' AS protocol, new_value
        FROM inventory_audit_log WHERE metadata->>'reference' = ${`REC-03:H01:${ids.S1}`}`));
    expect(audit).toMatchObject({ performed_by: actor, reason: REASON, protocol: 'REC-03A', new_value: { currentQuantity: 10 } });

    expect(await Promise.all(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map(key => batchState(owner, ids[key]))))
      .toEqual(ambiguousBefore);
    const after = await owner.transaction(tx => service.readReceivingOvercountRevalidation(tx, { companyId: companyA }),
      { accessMode: 'read only' });
    const byId = Object.fromEntries(after.batches.map(row => [row.batchId, row]));
    expect(byId[ids.S1]).toMatchObject({ evidence: 'ALREADY_CORRECTED', proposedAdjustment: null });
    expect(byId[ids.S2]).toMatchObject({ evidence: 'ALREADY_CORRECTED' });
    expect(after.summary).toMatchObject({ candidates: 9, sufficient: 1, ambiguous: 6, alreadyCorrected: 2 });
  });

  it('repetir el ajuste no duplica movimiento ni auditoría', async () => {
    const owner = fixture!.owner;
    const before = await fingerprint(owner);
    const again = await owner.transaction(tx => service.applyReceivingOvercountAdjustment(tx,
      { batchId: ids.S1, expectedDelta: 10, actorId: actor, reason: REASON }));
    expect(again).toEqual({ status: 'ALREADY_CORRECTED', batchId: ids.S1 });
    expect(await fingerprint(owner)).toEqual(before);
    expect(await batchState(owner, ids.S1)).toEqual({ current: 10, ledger: 10, markers: 1, audits: 1 });
  });

  it('dos conexiones simultáneas sobre el mismo lote producen un único ajuste', async () => {
    const owner = fixture!.owner;
    const second = drizzle(secondPool!, { schema });
    const input = { batchId: ids.B1, expectedDelta: 3, actorId: actor, reason: REASON };
    const results = await Promise.all([
      owner.transaction(tx => service.applyReceivingOvercountAdjustment(tx, input)),
      second.transaction(tx => service.applyReceivingOvercountAdjustment(tx, input)),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(['ALREADY_CORRECTED', 'APPLIED']);
    expect(await batchState(owner, ids.B1)).toEqual({ current: 3, ledger: 3, markers: 1, audits: 1 });
  });

  it('rechaza ambiguos, planes obsoletos y entradas inválidas sin efectos', async () => {
    const owner = fixture!.owner;
    const before = await fingerprint(owner);
    const attempt = (input: Parameters<Service['applyReceivingOvercountAdjustment']>[1]) =>
      owner.transaction(tx => service.applyReceivingOvercountAdjustment(tx, input));

    await expect(attempt({ batchId: ids.A1, expectedDelta: 48.49, actorId: actor, reason: REASON }))
      .rejects.toMatchObject({ code: 'NOT_SUFFICIENT', reasons: ['DELTA_NOT_RECEIVED_QUANTITY'] });
    await expect(attempt({ batchId: ids.A3, expectedDelta: 6, actorId: actor, reason: REASON }))
      .rejects.toMatchObject({ code: 'NOT_SUFFICIENT', reasons: ['CREATED_AFTER_FIX'] });
    await expect(attempt({ batchId: ids.S3, expectedDelta: 5, actorId: actor, reason: REASON }))
      .rejects.toMatchObject({ code: 'STALE_PLAN' });
    await expect(attempt({ batchId: ids.OK1, expectedDelta: 7, actorId: actor, reason: REASON }))
      .rejects.toMatchObject({ code: 'NOT_SUFFICIENT' });
    await expect(attempt({ batchId: randomUUID(), expectedDelta: 1, actorId: actor, reason: REASON }))
      .rejects.toMatchObject({ code: 'BATCH_NOT_FOUND' });
    await expect(attempt({ batchId: ids.S3, expectedDelta: 4, actorId: '', reason: REASON }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(attempt({ batchId: ids.S3, expectedDelta: 4, actorId: actor, reason: 'corto' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await fingerprint(owner)).toEqual(before);
    expect(await batchState(owner, ids.S3)).toEqual({ current: 8, ledger: 4, markers: 0, audits: 0 });
  });
});

describe.runIf(process.env.RUN_REC03A_SOURCE_COPY === '1')('REC-03A dry-run sobre copia de la base aislada', () => {
  let copy: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
  afterAll(async () => { await copy?.close(); }, 90_000);

  it('cuenta los lotes que existan en la copia, sin asumir un número y sin escribir', async () => {
    copy = await createSalesRuntimeDatabase();
    const owner = copy.owner;
    process.env.DATABASE_URL = copy.ownerUrl;
    const svc = await import('@/lib/services/receiving-overcount-service');
    const before = await fingerprint(owner);
    const result = await owner.transaction(tx => svc.readReceivingOvercountRevalidation(tx), { accessMode: 'read only' });
    expect(await fingerprint(owner)).toEqual(before);
    const { summary } = result;
    expect(summary.sufficient + summary.ambiguous + summary.alreadyCorrected).toBe(summary.candidates);
    for (const row of result.batches.filter(batch => batch.evidence !== 'SUFFICIENT')) {
      expect(row.proposedAdjustment).toBeNull();
    }
    mkdirSync('.tmp', { recursive: true });
    writeFileSync('.tmp/rec03a-source-copy.json', `${JSON.stringify({ summary, batches: result.batches.length }, null, 2)}\n`);
  }, 240_000);
});
