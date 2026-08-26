import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });
const TABLES = ["service_order_quotes","approval_matrix_rules","approval_requests","cost_centers","branch_budgets","folio_counters","service_orders","service_order_evidence","purchase_orders","invoices","inventory_batches","payment_approvals","petty_cash_funds","production_orders","forecast_results","sales_entries","daily_sales_cuts"];
async function main(){
  const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
  const r=await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,[TABLES]);
  const has=new Set(r.rows.map((x:any)=>x.table_name));
  for(const t of TABLES) console.log(`  ${has.has(t)?"OK   ":"FALTA"} ${t}`);
  const counts=["sales_entries","daily_sales_cuts","inventory_batches","service_order_quotes"];
  console.log("\nFilas:");
  for(const t of counts){ const q=await c.query(`SELECT count(*)::int n FROM "${t}"`); console.log(`  ${t}: ${q.rows[0].n}`); }
  await c.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
