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
  await q("holidays sample", "select name, date from holidays order by date limit 5");
  await q("contracts sample", "select contract_type::text as ctype, work_regime::text as regime, base_salary, monthly_salary, weekly_salary, break_duration_minutes, work_days, start_date::date as start, end_date::date as fin from employee_contracts limit 7");
  await q("contract users branch", "select c.user_id, u.branch_id, u.company_id, b.name as branch from employee_contracts c join users u on u.id = c.user_id left join branches b on b.id = u.branch_id limit 10");
  await q("expenses status", "select status::text, category::text, amount, created_at::date, due_date from operating_expenses");
  await q("movements branch spread", "select b.name, m.type::text as type, count(*)::int as n, sum(abs(m.quantity_change))::int as qty from inventory_movements m join branches b on b.id=m.branch_id group by b.name, m.type order by b.name");
  await q("shift sessions branch", "select b.name, count(*)::int as n, sum(s.total_work_minutes)::int as mins from shift_sessions s join branches b on b.id=s.branch_id group by b.name");
  await q("last_cost range", "select min(last_cost) as min_c, max(last_cost) as max_c, avg(last_cost)::int as avg_c, unit from inventory_items group by unit");
  process.exit(0);
}
main();
