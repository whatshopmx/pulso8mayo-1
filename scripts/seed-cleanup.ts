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
    .filter((t) => !EXCLUDED_TABLES.has(t) && !t.startsWith("_"));

  if (allTables.length > 0) {
    const raw = (sql as any).raw as (s: string) => any;
    const tableList = allTables.map((t) => `"${t}"`).join(", ");
    try {
      await db.execute(raw(`TRUNCATE TABLE ${tableList} CASCADE`));
      console.log(`  Truncated ${allTables.length} tables with CASCADE.`);
    } catch (err) {
      console.warn("  TRUNCATE CASCADE failed, falling back to individual deletes:", err);
      for (const table of allTables) {
        try {
          await db.execute(raw(`DELETE FROM "${table}"`));
        } catch {}
      }
    }
  }

  console.log("  Cleanup complete.");
}
