import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COLS: Array<[string, string, string]> = [
  ["0032_arqueo-cierre-turno", "daily_sales_cuts", "cash_counted_cents"],
  ["0032_arqueo-cierre-turno", "daily_sales_cuts", "deposited_cents"],
  ["0043_workflow-review-fields", "workflow_instances", "review_status"],
  ["0043_workflow-review-fields", "workflow_instances", "reviewed_by"],
  ["0055_idempotencia-extractores", "inventory_waste", "workflow_instance_id"],
  ["0055_idempotencia-extractores", "inventory_waste", "origin"],
  ["0055_idempotencia-extractores", "production_results", "workflow_instance_id"],
];
const TABLES: Array<[string, string]> = [["0037_lush_malice", "stock_counts"]];
const IDX: Array<[string, string]> = [
  ["0055_idempotencia-extractores", "inventory_waste_instance_item_origin_unique"],
  ["0055_idempotencia-extractores", "production_results_instance_recipe_unique"],
];

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  for (const [tag, t, col] of COLS) {
    const r = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, col]);
    console.log(`  ${r.rowCount ? "OK   " : "FALTA"} ${tag} → ${t}.${col}`);
  }
  for (const [tag, t] of TABLES) {
    const r = await c.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]);
    console.log(`  ${r.rowCount ? "OK   " : "FALTA"} ${tag} → tabla ${t}`);
  }
  for (const [tag, i] of IDX) {
    const r = await c.query(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [i]);
    console.log(`  ${r.rowCount ? "OK   " : "FALTA"} ${tag} → índice ${i}`);
  }
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
