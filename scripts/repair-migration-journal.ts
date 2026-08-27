/**
 * One-off repair: mark migrations 0032-0056 as applied in
 * drizzle.__drizzle_migrations. Their schema objects already exist in the
 * DB (verified by scripts/check-migration-drift.ts) because they were
 * applied via `db:push` instead of `db:migrate`.
 *
 * Hash = sha256 of the whole .sql file (same as drizzle's migrator).
 * created_at = journal entry `when` (folderMillis).
 */
import { config } from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

config({ path: ".env" });

const TAGS_TO_MARK = [
  "0032_arqueo-cierre-turno",
  "0035_gaps-avanzados",
  "0037_lush_malice",
  "0038_builder-settings-arrays",
  "0039_objetivos-financieros-tenant",
  "0041_supplier-bank-accounts",
  "0043_workflow-review-fields",
  "0050_step-definition-freeze",
  "0051_merma-decimal-quantities",
  "0052_supuestos-flujo-efectivo",
  "0054_produccion-cantidades-decimales",
  "0055_idempotencia-extractores",
  "0056_cfdi-nomina-timbrados",
];

async function checkColumn(client: pg.Client, table: string, column: string) {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return res.rowCount !== null && res.rowCount > 0;
}

async function checkTable(client: pg.Client, table: string) {
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return res.rowCount !== null && res.rowCount > 0;
}

async function verifyMigrationApplied(client: pg.Client, tag: string): Promise<boolean> {
  if (tag.startsWith("0032")) return checkColumn(client, "daily_sales_cuts", "cash_counted_cents");
  if (tag.startsWith("0035")) return checkTable(client, "company_subscriptions");
  if (tag.startsWith("0037")) return checkTable(client, "stock_counts");
  if (tag.startsWith("0038")) return checkColumn(client, "workflow_schedules", "assigned_roles");
  if (tag.startsWith("0039")) return checkColumn(client, "tenant_operating_config", "food_cost_target_percent");
  if (tag.startsWith("0041")) return checkTable(client, "supplier_bank_accounts");
  if (tag.startsWith("0043")) return checkColumn(client, "workflow_instances", "review_status");
  if (tag.startsWith("0050")) return checkColumn(client, "workflow_instance_steps", "step_order");
  if (tag.startsWith("0051")) {
    const res = await client.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'inventory_batches' AND column_name = 'initial_quantity'`);
    return res.rows[0]?.data_type === 'numeric';
  }
  if (tag.startsWith("0052")) return checkTable(client, "cash_flow_assumptions");
  if (tag.startsWith("0054")) {
    const res = await client.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'production_ingredients' AND column_name = 'expected_quantity'`);
    return res.rows[0]?.data_type === 'numeric';
  }
  if (tag.startsWith("0055")) return checkColumn(client, "inventory_waste", "workflow_instance_id");
  if (tag.startsWith("0056")) return checkTable(client, "cfdi_nomina_timbrados");
  
  throw new Error(`Unknown verification logic for tag ${tag}`);
}

async function main() {
  const journal = JSON.parse(
    fs.readFileSync("drizzle/meta/_journal.json", "utf8"),
  );

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const existing = await client.query(
    `SELECT hash FROM drizzle.__drizzle_migrations`,
  );
  const existingHashes = new Set(existing.rows.map((r) => r.hash));

  for (const tag of TAGS_TO_MARK) {
    const entry = journal.entries.find((e: any) => e.tag === tag);
    if (!entry) throw new Error(`Journal entry not found for ${tag}`);

    const sql = fs.readFileSync(`drizzle/${tag}.sql`, "utf8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");

    if (existingHashes.has(hash)) {
      console.log(`${tag}: already recorded, skipping`);
      continue;
    }

    const isApplied = await verifyMigrationApplied(client, tag);
    if (!isApplied) {
      console.error(`ERROR: Object for ${tag} not found in DB. Aborting.`);
      process.exit(1);
    }

    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)`,
      [hash, entry.when],
    );
    console.log(`${tag}: marked applied (when=${entry.when})`);
  }

  const last = await client.query(
    `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  if (last.rows.length > 0) {
    console.log(`New last applied created_at: ${last.rows[0].created_at}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
