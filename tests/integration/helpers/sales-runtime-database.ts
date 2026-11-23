import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '@/lib/db/schema';

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Disposable database: source copy by default, or an explicit fresh baseline.
 * Never terminates source clients or alters the source database. */
export async function createSalesRuntimeDatabase(options: { baseline?: '0158'; posFiles?: boolean } = {}) {
  const source = new URL(process.env.TEST_DATABASE_URL!);
  const operational = new URL(parse(readFileSync('.env')).DATABASE_URL);
  const host = (url: URL) => url.hostname.replace(/-pooler(?=\.)/, '');
  if (host(source) === host(operational)) throw new Error('Sales browser fixture requires an isolated endpoint');
  const sourceName = decodeURIComponent(source.pathname.slice(1));
  if (!sourceName || sourceName === 'postgres') throw new Error('Invalid fixture source database');
  const baseline = options.baseline === '0158'
    ? await (await import('./sales-runtime-baseline')).salesRuntimeBaseline0158() : undefined;
  const databaseName = `inv_sales_next_${randomUUID().replaceAll('-', '')}`;
  const roleName = `inv_sales_role_${randomUUID().replaceAll('-', '')}`;
  const password = randomUUID();
  const maintenanceUrl = new URL(source); maintenanceUrl.pathname = '/postgres';
  const ownerUrl = new URL(source); ownerUrl.pathname = `/${databaseName}`;
  const runtimeUrl = new URL(ownerUrl); runtimeUrl.username = roleName; runtimeUrl.password = password;
  neonConfig.webSocketConstructor = ws;
  const admin = new Pool({ connectionString: maintenanceUrl.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  const ownerPool = new Pool({ connectionString: ownerUrl.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  const owner = drizzle(ownerPool, { schema });
  admin.on('error', () => console.error('[sales-fixture] administrative pool error'));
  ownerPool.on('error', () => console.error('[sales-fixture] owner pool error'));
  let databaseCreated = false, roleCreated = false, closed = false;
  mkdirSync('.tmp', { recursive: true });
  const record = () => writeFileSync('.tmp/sales-runtime-database-fixture.json', JSON.stringify({ databaseName, roleName, databaseCreated, roleCreated, closed, baseline: options.baseline ?? 'source', posFiles: options.posFiles === true }));
  record(); // Recovery identifiers only; never persist either connection URI.

  async function close() {
    if (closed) return;
    try {
      await ownerPool.end();
      if (databaseCreated) {
        // Only this generated database, on the already checked isolated host.
        // FORCE may close this fixture's own clients; never the source's.
        if (!/^inv_sales_next_[a-f0-9]{32}$/.test(databaseName) || databaseName === sourceName) throw new Error('Unsafe fixture cleanup target');
        const owned = await admin.query('SELECT pg_get_userbyid(datdba)=current_user AS owned FROM pg_database WHERE datname=$1', [databaseName]);
        if (owned.rows[0]?.owned !== true) throw new Error('Disposable database ownership changed; refusing cleanup');
        await admin.query(`DROP DATABASE ${quote(databaseName)} WITH (FORCE)`);
        databaseCreated = false;
        if ((await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [databaseName])).rows.length) throw new Error('Disposable database still exists');
      }
      if (roleCreated) {
        // Dropping the sole fixture database removed all grants of this fresh
        // role. No DROP OWNED, shared-role mutation or elevated membership.
        await admin.query(`DROP ROLE ${quote(roleName)}`);
        roleCreated = false;
        if ((await admin.query('SELECT rolname FROM pg_roles WHERE rolname=$1', [roleName])).rows.length) throw new Error('Disposable runtime role still exists');
      }
      closed = true;
      record();
    } finally { await admin.end(); }
  }

  try {
    if (baseline) {
      // No connection to/cloning of the source database. This avoids its
      // Timescale scheduler while keeping the same explicitly isolated host.
      await admin.query(`CREATE DATABASE ${quote(databaseName)} TEMPLATE template0`);
      databaseCreated = true;
      record();
    }
    // CREATE DATABASE cannot run inside a transaction. A source client can
    // race the preflight; retry only 55006, with a bound, without killing it.
    const deadline = Date.now() + 90_000;
    let lastConflict = 'active clients';
    while (!databaseCreated) {
      const active = await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [sourceName]);
      if (active.rows[0].n === 0) {
        try {
          await admin.query(`CREATE DATABASE ${quote(databaseName)} TEMPLATE ${quote(sourceName)}`);
          databaseCreated = true;
          record();
        } catch (error) {
          const conflict = error as { code?: string; detail?: string; message?: string };
          if (conflict.code !== '55006') throw error;
          lastConflict = conflict.detail ?? conflict.message ?? 'source unavailable';
        }
      }
      if (!databaseCreated) {
        if (Date.now() >= deadline) throw new Error(`Source database is in use (${active.rows[0].n} clients; ${lastConflict}); no clients were terminated`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    try {
      await admin.query(`CREATE ROLE ${quote(roleName)} LOGIN PASSWORD '${password}' NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB`);
      roleCreated = true;
      record();
    } catch { throw new Error('Could not create the synthetic browser runtime role'); }
    const client = await ownerPool.connect();
    try {
      await client.query('BEGIN');
      if (baseline) {
        await client.query("SET LOCAL statement_timeout='120s'");
        await client.query(baseline.join('\n'));
      }
      for (const file of ['0137_inv01a_sale_consumption_identity.sql', '0138_inv01b_recipe_reader.sql',
        '0139_inv01b_application_scope.sql', '0141_inv01b_import_recipe_name.sql']) {
        const grants = readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').at(-1)!;
        if (!grants.includes('DO $$ BEGIN')) throw new Error('Missing declared runtime grants');
        await client.query(grants.replaceAll('pulso_app', roleName));
      }
      if (options.posFiles) {
        // Candidate 0155 is installed only in this generated database. Drop its
        // named policy here so both an older source and an already migrated
        // source exercise the same checked-in candidate and fresh role grants.
        await client.query('DROP POLICY IF EXISTS "daily_sales_cut_tenant" ON public.daily_sales_cuts');
        for (const statement of readFileSync('drizzle/0155_pos_storage_rls.sql', 'utf8').split('--> statement-breakpoint')) {
          await client.query(statement.replaceAll('pulso_app', roleName));
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return { owner, ownerUrl: ownerUrl.toString(), runtimeUrl: runtimeUrl.toString(),
      posFileRuntimeUrl: options.posFiles ? runtimeUrl.toString() : undefined, databaseName, roleName, close };
  } catch (error) {
    await close();
    throw error;
  }
}
