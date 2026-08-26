import { config } from "dotenv";
import pg from "pg";
import fs from "node:fs";
import crypto from "node:crypto";

config({ path: ".env" });

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
  const applied = await client.query(
    `SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY created_at`,
  );
  const appliedHashes = new Set(applied.rows.map((r: any) => String(r.hash)));

  const pending: string[] = [];
  for (const e of journal.entries) {
    const sql = fs.readFileSync(`drizzle/${e.tag}.sql`, "utf8");
    const sha = crypto.createHash("sha256").update(sql).digest("hex");
    // Algunas filas del journal de la DB guardan el TAG en la columna `hash`
    // (las que repair-migration-journal.ts rellenó a mano). Se acepta cualquiera.
    if (!appliedHashes.has(sha) && !appliedHashes.has(e.tag)) pending.push(e.tag);
  }

  console.log(`journal: ${journal.entries.length} · filas en DB: ${applied.rows.length}`);
  console.log(`\nSIN CONSTANCIA DE APLICACIÓN (${pending.length}):`);
  pending.forEach((t) => console.log("  -", t));

  // Verdad de campo: ¿existen los objetos que esas migraciones crean?
  const probes: Array<[string, string, string]> = [
    ["0032_arqueo-cierre-turno", "columna", "shift_sessions.closing_notes"],
    ["0035_gaps-avanzados", "tabla", "remediation_actions"],
    ["0038_builder-settings-arrays", "tabla", "workflow_templates"],
    ["0039_objetivos-financieros-tenant", "tabla", "tenant_operating_config"],
    ["0041_supplier-bank-accounts", "tabla", "supplier_bank_accounts"],
    ["0050_step-definition-freeze", "columna", "workflow_instance_steps.definition"],
    ["0051_merma-decimal-quantities", "tipo", "inventory_waste.quantity"],
    ["0052_supuestos-flujo-efectivo", "tabla", "cost_records"],
    ["0054_produccion-cantidades-decimales", "tipo", "production_ingredients.actual_quantity"],
    ["0055_idempotencia-extractores", "índice", "stock_count_instance_item_unique"],
    ["0056_cfdi-nomina-timbrados", "columna", "payroll_payslips.cfdi_uuid"],
  ];

  console.log(`\n¿ESTÁN SUS OBJETOS EN LA BASE?`);
  for (const [tag, kind, target] of probes) {
    let ok = false;
    let detail = "";
    if (kind === "tabla") {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [target]);
      ok = r.rowCount! > 0;
    } else if (kind === "columna" || kind === "tipo") {
      const [t, c] = target.split(".");
      const r = await client.query(
        `SELECT data_type, numeric_scale FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, c]);
      ok = r.rowCount! > 0;
      if (ok && kind === "tipo") detail = ` (${r.rows[0].data_type}${r.rows[0].numeric_scale != null ? `, escala ${r.rows[0].numeric_scale}` : ""})`;
    } else {
      const r = await client.query(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [target]);
      ok = r.rowCount! > 0;
    }
    console.log(`  ${ok ? "OK  " : "FALTA"} ${tag} → ${kind} ${target}${detail}`);
  }

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
