import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';

it.skipIf(process.env.RUN_SALES_RUNTIME_NEXT_BROWSER !== '1')('POS fixture provisions with runtime role and cleans up', async () => {
  const fixture = await createSalesRuntimeDatabase();
  try {
    expect(fixture.databaseName).toMatch(/^inv_sales_next_[a-f0-9]{32}$/);
    expect(Number((await fixture.owner.execute(sql`SELECT count(*) AS n FROM pg_tables WHERE schemaname='public'`)).rows[0].n)).toBeGreaterThan(190);
    expect((await fixture.owner.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=${fixture.roleName}`)).rows[0])
      .toEqual({ rolbypassrls: false, rolsuper: false });
  } finally { await fixture.close(); }
}, 150_000);
