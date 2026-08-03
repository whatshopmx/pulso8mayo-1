/**
 * One-off diagnostic: check migration drift between drizzle migrations
 * recorded in the DB and objects expected from migrations 0012-0020.
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env" });

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const applied = await client.query(
    `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`,
  );
  console.log(`Applied migrations in DB: ${applied.rows.length}`);
  if (applied.rows.length > 0) {
    const last = applied.rows[applied.rows.length - 1];
    console.log(`Last applied: id=${last.id} created_at=${new Date(Number(last.created_at)).toISOString()}`);
  }

  const tables = [
    "credit_notes", "invoice_lines", "invoices", "inventory_periods",
    "supplier_claims", "inventory_knowledge_graph", "forecast_results",
    "production_ingredients", "production_orders", "production_results",
    "supplier_items",
  ];
  const tRes = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [tables],
  );
  const existing = new Set(tRes.rows.map((r) => r.table_name));
  for (const t of tables) console.log(`table ${t}: ${existing.has(t) ? "EXISTS" : "MISSING"}`);

  const enumChecks: Array<[string, string]> = [
    ["inventory_alert_type", "PRICE_INCREASE"],
    ["inventory_alert_type", "ANOMALOUS_WASTE"],
    ["inventory_alert_type", "HIGH_VARIANCE"],
    ["inventory_alert_type", "YIELD_DROP"],
  ];
  for (const [typ, label] of enumChecks) {
    const r = await client.query(
      `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 AND e.enumlabel = $2`,
      [typ, label],
    );
    console.log(`enum ${typ}.${label}: ${r.rowCount ? "EXISTS" : "MISSING"}`);
  }

  // STAFF label — which enum? search across all enums
  const staff = await client.query(
    `SELECT t.typname FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE e.enumlabel = 'STAFF'`,
  );
  console.log(`enum label STAFF present in: ${staff.rows.map((r) => r.typname).join(", ") || "NONE"}`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
