import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function q(label: string, statement: string) {
  try {
    const r = await db.execute(sql.raw(statement));
    console.log(`\n### ${label}`);
    console.table((r as unknown as { rows: unknown[] }).rows ?? r);
  } catch (e) {
    console.log(`\n### ${label} -> ERROR: ${(e as Error).message}`);
  }
}

async function main() {
  await q(
    "movement sign by type",
    "select type::text as type, min(quantity_change) as min_q, max(quantity_change) as max_q, count(*) filter (where quantity_change < 0)::int as negatives from inventory_movements group by type",
  );
  await q("branches costing method", "select name, costing_method from branches");
  await q("company costing method", "select name, costing_method from companies");
  await q(
    "sessions sample",
    "select started_at, ended_at, total_work_minutes, overtime_minutes, status from shift_sessions order by started_at limit 5",
  );
  process.exit(0);
}
main();
