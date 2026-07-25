import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const EXCLUDED_TABLES = new Set([
  "account", "session", "sessions", "verifications",
]);

export async function cleanupAll(): Promise<void> {
  console.log("Cleaning up all seed data (FK-safe order)...");

  const tablesResult = await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const allTables = (tablesResult.rows as any[])
    .map((r) => r.table_name as string)
    .filter((t) => !EXCLUDED_TABLES.has(t));

  const fksResult = await db.execute(sql`
    SELECT
      tc.table_name AS child,
      ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `);
  const fkRows = fksResult.rows as Array<{ child: string; parent: string }>;

  const childrenOf = new Map<string, string[]>();
  for (const fk of fkRows) {
    if (!childrenOf.has(fk.parent)) childrenOf.set(fk.parent, []);
    childrenOf.get(fk.parent)!.push(fk.child);
  }

  const outDegree = new Map<string, number>();
  for (const t of allTables) outDegree.set(t, 0);
  for (const fk of fkRows) {
    outDegree.set(fk.child, (outDegree.get(fk.child) ?? 0) + 1);
  }

  const queue: string[] = [];
  const order: string[] = [];

  for (const [tbl, deg] of outDegree) {
    if (deg === 0) queue.push(tbl);
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const child of childrenOf.get(node) ?? []) {
      const d = outDegree.get(child)! - 1;
      outDegree.set(child, d);
      if (d === 0) queue.push(child);
    }
  }

  order.reverse();

  const raw = (sql as any).raw as (s: string) => any;

  for (const table of order) {
    if (EXCLUDED_TABLES.has(table)) continue;
    try {
      const result = await db.execute(raw(`DELETE FROM "${table}"`));
      const count = (result as any).rowCount ?? 0;
      if (count > 0) {
        console.log(`  ${table}: ${count} rows`);
      }
    } catch {
      // skip if table doesn't exist (schema may have changed)
    }
  }

  console.log("  Cleanup complete.");
}
