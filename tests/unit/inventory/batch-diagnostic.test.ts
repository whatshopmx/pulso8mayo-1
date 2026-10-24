import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BATCH_DIAGNOSTIC_SQL, parseDiagnosticArgs } from "@/scripts/diag-lotes-fefo";

const db = new PGlite();
beforeAll(async () => {
  await db.exec(`
    CREATE TABLE branches (id text PRIMARY KEY, company_id text);
    CREATE TABLE inventory_items (id text PRIMARY KEY, company_id text);
    CREATE TABLE inventory_batches (
      id text PRIMARY KEY, item_id text, branch_id text, status text,
      initial_quantity numeric(12,4), current_quantity numeric(12,4),
      expiration_date timestamp, origin text
    );
    CREATE TABLE inventory_movements (
      batch_id text, item_id text, branch_id text, type text,
      quantity_change numeric(12,4), timestamp timestamp
    );
    INSERT INTO branches VALUES ('a','company-a'),('b','company-b'),('a2','company-a');
    INSERT INTO inventory_items VALUES ('item-a','company-a'),('item-b','company-b');
    INSERT INTO inventory_batches VALUES
      ('negative','item-a','a','AVAILABLE',1,-0.125,NULL,'SALE'),
      ('expired','item-a','a','AVAILABLE',2,1.125,'2026-10-23 12:00','RECEIVING'),
      ('balanced','item-a','a','AVAILABLE',2.125,1.125,'2026-10-25','RECEIVING'),
      ('opening','item-a','a','AVAILABLE',2.125,1.125,NULL,NULL),
      ('missing','item-a','a','AVAILABLE',2,2,NULL,NULL),
      ('mismatch','item-a','a','AVAILABLE',2,1,NULL,NULL),
      ('boundary','item-a','a','AVAILABLE',1,1,'2026-10-24 12:00',NULL),
      ('other','item-b','b','AVAILABLE',1,-1,NULL,NULL),
      ('cross-company','item-b','a','AVAILABLE',1,1,NULL,NULL),
      ('other-branch','item-a','a2','AVAILABLE',1,1,NULL,NULL);
    INSERT INTO inventory_movements VALUES
      ('balanced','item-a','a','RECEIVING',2.125,'2026-10-20'),
      ('balanced','item-a','a','USAGE',-1,'2026-10-21'),
      ('opening','item-a','a','USAGE',-1,'2026-10-21'),
      ('mismatch','item-b','b','USAGE',-1,'2026-10-21');
  `);
}, 60_000);
afterAll(() => db.close());

describe('FEFO-01: diagnóstico de solo lectura', () => {
  it('clasifica sin confundir saldo inicial con ledger completo y conserva cuatro decimales', async () => {
    await db.exec('BEGIN TRANSACTION READ ONLY');
    try {
      const { rows } = await db.query<Record<string, unknown>>(BATCH_DIAGNOSTIC_SQL,
        ['company-a', 'a', '2026-10-24T12:00:00Z']);
      const byId = Object.fromEntries(rows.map(row => [row.batch_id, row]));
      expect(rows).toHaveLength(8);
      expect(byId.negative.negative).toBe(true);
      expect(byId.negative.current_quantity).toBe('-0.1250');
      expect(byId.expired.expired_available).toBe(true);
      expect(byId.boundary.expired_available).toBe(false);
      expect(byId.missing.missing_expiration).toBe(true);
      expect(byId.missing.history_class).toBe('NO_MOVEMENTS');
      expect(byId.balanced.history_class).toBe('MATCHES_LEDGER');
      expect(byId.balanced.delta_from_ledger).toBe('0.0000');
      expect(byId.opening.history_class).toBe('MATCHES_INITIAL_PLUS_LEDGER');
      expect(byId.mismatch.history_class).toBe('REVIEW_DELTA');
      expect(byId.mismatch.mismatched_movements).toBe('1');
      expect(byId['cross-company'].item_company_mismatch).toBe(true);
      expect(byId.other).toBeUndefined();
      expect(byId['other-branch']).toBeUndefined();
    } finally { await db.exec('ROLLBACK'); }
    expect((await db.query('SELECT count(*)::text AS n FROM inventory_batches')).rows).toEqual([{ n: '10' }]);
  });

  it('exige alcance y fecha explícitos y rechaza opciones de escritura', () => {
    const args = ['--company=00000000-0000-4000-8000-000000000001', '--as-of=2026-10-24T12:00:00Z'];
    expect(parseDiagnosticArgs(args).companyId).toBe('00000000-0000-4000-8000-000000000001');
    for (const invalid of [[], [...args, '--apply'], [args[0], '--as-of=2026-10-24'],
      [args[0], '--as-of=2026-02-30T12:00:00Z'], [...args, '--company=bad']]) {
      expect(() => parseDiagnosticArgs(invalid)).toThrow();
    }
  });
});
