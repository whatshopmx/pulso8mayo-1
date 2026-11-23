import { readFileSync } from 'node:fs';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';

/** Fresh schema, not a copy of shared data. Custom SQL is restored separately. */
export async function salesRuntimeBaseline0158(): Promise<string[]> {
  const snapshot = JSON.parse(readFileSync('drizzle/meta/0158_snapshot.json', 'utf8'));
  if (snapshot.version !== '7' || snapshot.dialect !== 'postgresql'
    || snapshot.tables['public.recipe_consumption_policies']
    || !snapshot.tables['public.sales_consumption_revisions']) throw new Error('Unexpected sales baseline snapshot');
  const statements = await generateMigration(generateDrizzleJson({}), snapshot);
  // Snapshots model table DDL/RLS, but not handwritten immutability triggers
  // or FORCE. Preserve those actual statements instead of reimplementing them.
  const custom = readFileSync('drizzle/0137_inv01a_sale_consumption_identity.sql', 'utf8')
    .split('--> statement-breakpoint').filter(statement =>
      /\bFORCE ROW LEVEL SECURITY\b|\bCREATE FUNCTION\b|\bCREATE TRIGGER\b/.test(statement));
  if (custom.length !== 5) throw new Error('Sales baseline custom SQL changed; review required');
  return [...statements, ...custom];
}
