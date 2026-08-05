import "dotenv/config";
// Read-only probe: what data actually exists for the P&L ladders?
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
  await q("sales_entries", "select count(*)::int as n from sales_entries");
  await q("daily_sales_cuts", "select count(*)::int as n, min(business_date) as min_d, max(business_date) as max_d from daily_sales_cuts");
  await q(
    "inventory_movements by type",
    "select type::text as type, count(*)::int as n, min(timestamp)::date as min_ts, max(timestamp)::date as max_ts from inventory_movements group by type order by n desc",
  );
  await q(
    "inventory_items cost coverage",
    "select count(*)::int as items, count(last_cost)::int as with_last, count(average_cost)::int as with_avg, count(standard_cost)::int as with_std from inventory_items",
  );
  await q("employee_contracts", "select status, count(*)::int as n, count(branch_id)::int as with_branch, count(work_days)::int as with_workdays, count(work_start_time)::int as with_hours from employee_contracts group by status");
  await q("shift_sessions by status", "select status, count(*)::int as n, min(started_at)::date as min_d, max(started_at)::date as max_d from shift_sessions group by status order by n desc");
  await q("salary_history", "select count(*)::int as n from salary_history");
  await q("holidays", "select count(*)::int as n from holidays");
  await q("operating_expenses", "select count(*)::int as n, min(created_at)::date as min_d, max(created_at)::date as max_d, count(paid_at)::int as with_paid, count(due_date)::int as with_due from operating_expenses");
  await q("branches", "select count(*)::int as n, count(distinct company_id)::int as companies from branches");
  process.exit(0);
}

main();
